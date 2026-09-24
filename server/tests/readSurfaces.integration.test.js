const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/config/db");
const {
  COURIER_BASE_FEE,
  COURIER_RATE,
  PLATFORM_COMMISSION_RATE,
} = require("../src/queries/orderQueries");
const { createAuthToken } = require("../src/utils/authToken");

// The read surfaces added for the tables nobody could reach, and the two columns
// they made stop being always-zero: orders.platform_commission and
// delivery_personnel.earnings.
//
// Two things are being proven, and they are different in kind. The first is
// arithmetic: a commission is the sum of its lines and a courier is paid base
// plus a share, and neither is a number a reader can check by eye. The second is
// scope: every one of these endpoints is keyed on the caller's own identity, and
// the checks below are mostly about what a caller must NOT see — a vendor's
// neighbour's takings, another customer's payments, an unearned review.
//
// Every check runs inside a savepoint that is rolled back, so each sees the same
// seeded starting point even though several of them move stock and money.
test("the money columns and the role-scoped read surfaces", async (t) => {
  pool.options.connectionTimeoutMillis = 10000;
  let client;
  let server;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const namespace = `shopsphere_reads_check_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(await fs.readFile("sql/schema.sql", "utf8"));
    await client.query(
      await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"),
    );
    pool.query = (...args) => client.query(...args);
    // transaction() calls pool.connect(), which would hand back a different
    // pooled connection — outside this schema and outside this transaction, so an
    // order would be written to the real remote database. Route it back here,
    // turning BEGIN/COMMIT/ROLLBACK into savepoints so the nesting keeps real
    // semantics while the outer transaction still discards everything at the end.
    let transactionDepth = 0;
    pool.connect = async () => {
      const savepoint = `reads_tx_${++transactionDepth}`;
      return {
        query: async (text, values) => {
          const statement = String(text).trim().toUpperCase();
          if (statement === "BEGIN")
            return client.query(`SAVEPOINT ${savepoint}`);
          if (statement === "COMMIT")
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (statement === "ROLLBACK")
            return client
              .query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
              .then(() => client.query(`RELEASE SAVEPOINT ${savepoint}`));
          return client.query(text, values);
        },
        release: () => {},
      };
    };
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;

    const accounts = (await client.query("SELECT * FROM users ORDER BY user_id"))
      .rows;
    const account = (email) => accounts.find((user) => user.email === email);
    const customer = account("customer@shopsphere.test");
    const customer2 = account("customer2@shopsphere.test");
    const vendor = account("vendor@shopsphere.test");
    const vendor2 = account("vendor2@shopsphere.test");
    const courier = account("delivery@shopsphere.test");
    const admin = account("admin@shopsphere.test");

    async function request(path, { user = admin, method = "GET", body } = {}) {
      const headers = { "Content-Type": "application/json" };
      // A null user means "no session at all".
      if (user) headers.Cookie = `shopsphere_token=${createAuthToken(user)}`;
      const response = await fetch(origin + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        data: response.status === 204 ? null : await response.json(),
      };
    }

    const shopId = async (name) =>
      (await client.query("SELECT shop_id FROM shops WHERE name = $1", [name]))
        .rows[0].shop_id;
    const listingId = async (shop, master) =>
      (
        await client.query(
          `SELECT p.prod_id FROM products p
           JOIN shops s ON s.shop_id = p.shop_id
           JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
           WHERE s.name = $1 AND mp.name = $2`,
          [shop, master],
        )
      ).rows[0].prod_id;
    const orderId = async (userId, status) =>
      (
        await client.query(
          `SELECT order_id FROM orders
           WHERE user_id = $1 AND order_status = $2
             AND created_at = TIMESTAMP '2026-09-01 10:00:00'`,
          [userId, status],
        )
      ).rows[0].order_id;

    const techCorner = await shopId("Demo Tech Corner");
    const gadgetHouse = await shopId("Demo Gadget House");
    const keyboard = await listingId("Demo Tech Corner", "Demo Wireless Keyboard");
    const headphones = await listingId(
      "Demo Tech Corner",
      "Demo Bluetooth Headphones",
    );

    const setStock = (prodId, quantity) =>
      client.query("UPDATE products SET in_stock = $2 WHERE prod_id = $1", [
        prodId,
        quantity,
      ]);
    const setPrice = (prodId, price) =>
      client.query("UPDATE products SET unit_price = $2 WHERE prod_id = $1", [
        prodId,
        price,
      ]);
    const setCart = async (userId, lines) => {
      await client.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
      for (const [prodId, quantity] of lines)
        await client.query(
          "INSERT INTO cart_items (user_id, prod_id, quantity) VALUES ($1, $2, $3)",
          [userId, prodId, quantity],
        );
    };
    const one = async (text, values) => (await client.query(text, values)).rows[0];

    const placeOrder = (user, body = {}) =>
      request("/api/orders", { user, method: "POST", body });

    // The route a courier actually walks: shipped, then delivered.
    const deliver = async (user, id) => {
      const shipped = await request(`/api/delivery/orders/${id}/status`, {
        user,
        method: "PUT",
        body: { order_status: "shipped" },
      });
      assert.equal(shipped.status, 200, shipped.data.message);
      return request(`/api/delivery/orders/${id}/status`, {
        user,
        method: "PUT",
        body: { order_status: "delivered" },
      });
    };

    const commissionOf = async (id) =>
      Number(
        (
          await one(
            "SELECT platform_commission FROM orders WHERE order_id = $1",
            [id],
          )
        ).platform_commission,
      );
    const lineCommissionOf = async (id) =>
      (
        await client.query(
          "SELECT platform_commission FROM order_items WHERE order_id = $1",
          [id],
        )
      ).rows.map((row) => Number(row.platform_commission));
    const deliveryEarnings = async () =>
      Number(
        (
          await one(
            "SELECT earnings FROM delivery_personnel WHERE delivery_person_id = $1",
            [courier.user_id],
          )
        ).earnings,
      );
    const shopEarnings = async (id) =>
      Number(
        (await one("SELECT earnings FROM shops WHERE shop_id = $1", [id]))
          .earnings,
      );
    // Two decimals, the way the database rounds it, so a float artefact in the
    // test's own arithmetic cannot fail a correct implementation.
    const cents = (value) => Number(value.toFixed(2));

    async function check(name, run) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT reads_case");
        try {
          await run();
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT reads_case");
        }
      });
    }

    await check(
      "an order records the commission on every line, and on itself",
      async () => {
        // Two lines of three units at 10.10. Each line's commission is
        // ROUND(30.30 * 0.05) = 1.52, so the order is 3.04 — while the same rate
        // applied to the order's 60.60 total would give 3.03. The gap is the
        // whole reason the lines are summed rather than the total multiplied, and
        // a seeded price that rounded evenly would not show it.
        await setPrice(keyboard, "10.10");
        await setPrice(headphones, "10.10");
        await setStock(keyboard, 10);
        await setStock(headphones, 10);
        await setCart(customer.user_id, [
          [keyboard, 3],
          [headphones, 3],
        ]);

        const placed = await placeOrder(customer);
        assert.equal(placed.status, 201, placed.data.message);
        const id = placed.data.order.order_id;

        assert.deepEqual(await lineCommissionOf(id), [1.52, 1.52]);
        assert.equal(await commissionOf(id), 3.04);
        assert.notEqual(await commissionOf(id), cents(60.6 * PLATFORM_COMMISSION_RATE));
        assert.equal(Number(placed.data.order.total_amount), 60.6);

        // The margin is not the buyer's business, so it is not in the checkout
        // response either.
        assert.equal("platform_commission" in placed.data.order, false);
      },
    );

    await check("delivering an order pays the courier exactly once", async () => {
      const before = await deliveryEarnings();
      await setStock(keyboard, 5);
      await setCart(customer.user_id, [[keyboard, 2]]);
      const placed = await placeOrder(customer);
      const id = placed.data.order.order_id;
      const total = Number(placed.data.order.total_amount);
      assert.equal(placed.data.order.delivery_person_id, courier.user_id);

      const delivered = await deliver(courier, id);
      assert.equal(delivered.status, 200, delivered.data.message);
      const expected = cents(COURIER_BASE_FEE + COURIER_RATE * total);
      assert.equal(await deliveryEarnings(), cents(before + expected));
      assert.equal(
        Number(delivered.data.order.courier_earnings.earnings),
        cents(before + expected),
      );

      // The compare-and-set in ADVANCE_ORDER_STATUS is what makes the delivery
      // happen once; the pay rides on it, so a second tap cannot double-credit.
      const again = await request(`/api/delivery/orders/${id}/status`, {
        user: courier,
        method: "PUT",
        body: { order_status: "delivered" },
      });
      assert.equal(again.status, 409, again.data.message);
      assert.equal(await deliveryEarnings(), cents(before + expected));
    });

    await check("cancelling an order voids the commission it recorded", async () => {
      await setStock(keyboard, 5);
      await setCart(customer.user_id, [[keyboard, 2]]);
      const placed = await placeOrder(customer);
      const id = placed.data.order.order_id;
      assert.ok(await commissionOf(id) > 0);

      const cancelled = await request(`/api/orders/${id}/cancel`, {
        user: customer,
        method: "PUT",
      });
      assert.equal(cancelled.status, 200, cancelled.data.message);

      // A cancelled order earned the platform nothing, and the admin payments
      // screen shows commission per payment — a positive figure beside a failed
      // payment would read as revenue that never existed.
      assert.equal(await commissionOf(id), 0);
      assert.deepEqual(await lineCommissionOf(id), [0]);
      const payment = await one(
        "SELECT payment_status FROM payments WHERE order_id = $1",
        [id],
      );
      assert.equal(payment.payment_status, "failed");
    });

    await check(
      "the admin payments list joins each payment to its order and customer",
      async () => {
        const listed = await request("/api/admin/payments?limit=10");
        assert.equal(listed.status, 200);
        assert.ok(listed.data.total >= 2);
        assert.equal(listed.data.items.length, listed.data.total);

        const seeded = await orderId(customer.user_id, "delivered");
        const row = listed.data.items.find((item) => item.order_id === seeded);
        assert.ok(row, "the seeded delivered order should have a payment");
        assert.equal(row.customer_email, "customer@shopsphere.test");
        assert.equal(row.customer_name, "Demo Customer");
        assert.equal(row.payment_status, "completed");
        assert.equal(row.payment_method, "cash_on_delivery");
        assert.ok(row.paid_at, "a completed payment carries the moment it settled");
        // The payment is the goods plus the delivery, and the two halves are on
        // the row so the arithmetic can be seen rather than trusted.
        assert.equal(
          Number(row.amount),
          Number(row.total_amount) + Number(row.delivery_cost),
        );
        // Non-zero because the seed fills it the way placement would. Before the
        // rule existed this column was 0 everywhere and this check was vacuous.
        assert.ok(Number(row.platform_commission) > 0);
        const lines = await lineCommissionOf(seeded);
        assert.equal(
          Number(row.platform_commission),
          cents(lines.reduce((sum, value) => sum + value, 0)),
        );

        const completed = await request("/api/admin/payments?status=completed");
        assert.ok(completed.data.items.length > 0);
        assert.ok(
          completed.data.items.every((item) => item.payment_status === "completed"),
        );

        // A filter is not a suggestion: a value outside the closed set is a 400,
        // not a silently dropped condition that returns everything.
        const badStatus = await request("/api/admin/payments?status=refunded");
        assert.equal(badStatus.status, 400);
        assert.match(badStatus.data.message, /Status must be one of/);
        const badMethod = await request("/api/admin/payments?method=cheque");
        assert.equal(badMethod.status, 400);
        assert.match(badMethod.data.message, /Method must be one of/);

        // Free text finds an order by its number.
        const pending = await orderId(customer2.user_id, "pending");
        const byNumber = await request(`/api/admin/payments?q=${pending}`);
        assert.deepEqual(
          byNumber.data.items.map((item) => item.order_id),
          [pending],
        );

        const refused = await request("/api/admin/payments", { user: vendor });
        assert.equal(refused.status, 403);
      },
    );

    await check(
      "the admin refunds list names the shop, the listing and the administrator",
      async () => {
        await setStock(keyboard, 4);
        const removed = await request(`/api/admin/listings/${keyboard}/discontinue`, {
          method: "PUT",
        });
        assert.equal(removed.status, 200, removed.data.message);

        const listed = await request("/api/admin/refunds");
        assert.equal(listed.status, 200);
        const row = listed.data.items.find((item) => item.prod_id === keyboard);
        assert.ok(row, "the removal just performed should be listed");
        assert.equal(row.shop_name, "Demo Tech Corner");
        assert.equal(row.listing_name, "Demo Wireless Keyboard");
        assert.equal(row.master_prod_id, removed.data.refund.master_prod_id);
        assert.equal(row.reason, "admin_removal");
        assert.equal(row.admin_email, "admin@shopsphere.test");
        assert.equal(row.admin_name, "Demo Admin");
        assert.equal(row.units, 4);
        assert.equal(Number(row.amount), Number(removed.data.refund.amount));

        const filtered = await request("/api/admin/refunds?reason=shop_closed");
        assert.equal(filtered.data.total, 0);
        const badReason = await request("/api/admin/refunds?reason=because");
        assert.equal(badReason.status, 400);
        assert.match(badReason.data.message, /Reason must be one of/);

        const refused = await request("/api/admin/refunds", { user: customer });
        assert.equal(refused.status, 403);
      },
    );

    await check(
      "a customer's payment history is their own and nothing else",
      async () => {
        const mine = await request("/api/account/payments", { user: customer });
        assert.equal(mine.status, 200);
        assert.ok(mine.data.length > 0);
        const ids = mine.data.map((item) => item.order_id);
        const owned = (
          await client.query("SELECT order_id FROM orders WHERE user_id = $1", [
            customer.user_id,
          ])
        ).rows.map((row) => row.order_id);
        assert.deepEqual(
          [...ids].sort((a, b) => a - b),
          [...owned].sort((a, b) => a - b),
        );
        // The platform's cut is not on the customer's row.
        assert.equal("platform_commission" in mine.data[0], false);

        const theirs = await request("/api/account/payments", { user: customer2 });
        assert.equal(theirs.status, 200);
        assert.ok(
          theirs.data.every((item) => !ids.includes(item.order_id)),
          "one customer's payments must not appear in another's history",
        );

        const refused = await request("/api/account/payments", { user: vendor });
        assert.equal(refused.status, 403);
        const guest = await request("/api/account/payments", { user: null });
        assert.equal(guest.status, 401);
      },
    );

    await check(
      "a vendor's books agree with the tables behind them",
      async () => {
        const books = await request("/api/vendor/payments", { user: vendor });
        assert.equal(books.status, 200);
        const { sales, purchases, refunds, shops, totals } = books.data;

        const ownedShops = (
          await client.query(
            "SELECT shop_id, name, earnings FROM shops WHERE owner = $1",
            [vendor.user_id],
          )
        ).rows;
        const ownedIds = ownedShops.map((shop) => shop.shop_id);
        assert.deepEqual(
          [...new Set(sales.map((row) => row.shop_id))].sort((a, b) => a - b),
          [...ownedIds].sort((a, b) => a - b),
        );
        // The seeded delivered order has three lines and two of them are this
        // shop's — the third belongs to Demo Gadget House, which is the point of
        // the assertion below it.
        assert.equal(sales.length, 2, "one line per seeded listing from this shop");
        // A vendor does not deliver, so the buyer's identity is not theirs to see.
        assert.equal("customer_name" in sales[0], false);
        assert.equal("customer_email" in sales[0], false);

        // Every headline is checked against the table it came from rather than
        // against a number written down here, so a seeded price change cannot
        // make this pass by coincidence.
        const spend = await one(
          `SELECT COALESCE(SUM(sp.quantity * sp.wholesale_unit_price), 0)::numeric(12,2) AS value
           FROM shop_purchases sp JOIN shops s ON s.shop_id = sp.shop_id WHERE s.owner = $1`,
          [vendor.user_id],
        );
        assert.equal(Number(totals.wholesale_spend), Number(spend.value));
        const purchaseRows = await one(
          `SELECT COUNT(*)::int AS count FROM shop_purchases sp
           JOIN shops s ON s.shop_id = sp.shop_id WHERE s.owner = $1`,
          [vendor.user_id],
        );
        assert.equal(purchases.length, purchaseRows.count);
        assert.ok(purchases.every((row) => row.shop_name === "Demo Tech Corner"));

        const gross = await one(
          `SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)::numeric(12,2) AS value
           FROM order_items oi
           JOIN orders o ON o.order_id = oi.order_id
           JOIN products p ON p.prod_id = oi.prod_id
           JOIN shops s ON s.shop_id = p.shop_id
           WHERE s.owner = $1 AND o.order_status <> 'cancelled'`,
          [vendor.user_id],
        );
        assert.equal(Number(totals.gross_sales), Number(gross.value));
        assert.equal(
          Number(totals.net_sales),
          cents(Number(totals.gross_sales) - Number(totals.commission_paid)),
        );
        assert.equal(
          Number(totals.earnings_balance),
          cents(
            ownedShops.reduce((sum, shop) => sum + Number(shop.earnings), 0),
          ),
        );
        assert.equal(
          Number(shops.find((shop) => shop.shop_id === techCorner).earnings),
          await shopEarnings(techCorner),
        );

        // A removal pays into the balance this screen reads, so the two numbers
        // move together rather than being unrelated readings of the same column.
        await setStock(keyboard, 3);
        const before = await shopEarnings(techCorner);
        const removed = await request(`/api/admin/listings/${keyboard}/discontinue`, {
          method: "PUT",
        });
        const paid = Number(removed.data.refund.amount);
        assert.ok(paid > 0);
        assert.equal(await shopEarnings(techCorner), cents(before + paid));
        const after = await request("/api/vendor/payments", { user: vendor });
        assert.equal(
          Number(after.data.totals.refunds_received),
          paid,
        );
        assert.equal(
          Number(after.data.totals.earnings_balance),
          cents(Number(totals.earnings_balance) + paid),
        );

        // The neighbouring vendor's takings are not visible in any form: their
        // shop never appears, so their numbers cannot leak through a total. The
        // refund above landed in this vendor's shop and no other, which is what
        // makes the two balances comparable rather than both being zero.
        const other = await request("/api/vendor/payments", { user: vendor2 });
        assert.ok(
          other.data.sales.every((row) => row.shop_id === gadgetHouse),
          "a vendor must only ever see their own shops",
        );
        assert.equal(Number(other.data.totals.refunds_received), 0);
        assert.notEqual(
          Number(after.data.totals.refunds_received),
          Number(other.data.totals.refunds_received),
        );

        const refused = await request("/api/vendor/payments", { user: customer });
        assert.equal(refused.status, 403);
      },
    );

    await check(
      "the permission tables are gone, and nothing serves them",
      async () => {
        // They were seed-only data describing an authorization model the code
        // does not implement: requireRole(roleName) on a mounted router is a
        // check per role, and nothing ever read a grant. 009_drop_permissions.sql
        // removed them, and this is the check that they stay removed — a table
        // that looks like an authorization model and is not one invites someone
        // to start trusting it.
        const tables = (
          await client.query(
            `SELECT to_regclass('permissions') AS permissions,
                    to_regclass('role_permissions') AS role_permissions`,
          )
        ).rows[0];
        assert.equal(tables.permissions, null);
        assert.equal(tables.role_permissions, null);

        // The endpoint that reported on them went with them.
        const listed = await request("/api/admin/permissions");
        assert.equal(listed.status, 404);

        // roles survives: it is what a user's role actually points at.
        assert.equal(
          Number(
            (await client.query("SELECT COUNT(*)::int AS count FROM roles"))
              .rows[0].count,
          ),
          4,
        );
      },
    );

    await check(
      "a shop's reviews are public, and writing one needs a delivered order",
      async () => {
        const publicList = await request(`/api/shops/${techCorner}/reviews`, {
          user: null,
        });
        assert.equal(publicList.status, 200);
        assert.ok(publicList.data.length > 0, "the seed writes a shop review");
        assert.equal(publicList.data[0].name, "Demo Customer");
        assert.equal(publicList.data[0].rating, 5);

        // customer2 has only a pending order, so the shop is not theirs to rate.
        const refused = await request(`/api/shops/${techCorner}/review`, {
          user: customer2,
          method: "PUT",
          body: { rating: 1, review: "Never bought anything here." },
        });
        assert.equal(refused.status, 403);
        assert.match(refused.data.message, /delivered order from this shop/);

        const saved = await request(`/api/shops/${techCorner}/review`, {
          user: customer,
          method: "PUT",
          body: { rating: 4, review: "Accurate listing, slow dispatch." },
        });
        assert.equal(saved.status, 200);
        assert.equal(saved.data.review.rating, 4);

        // One review per customer per shop: saving again rewrites, it does not
        // add a second row to weigh in the average.
        const updated = await request(`/api/shops/${techCorner}/review`, {
          user: customer,
          method: "PUT",
          body: { rating: 3, review: "Revised after a follow-up." },
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.review.rating, 3);
        const rows = await client.query(
          "SELECT COUNT(*)::int AS count FROM shop_reviews WHERE user_id = $1 AND shop_id = $2",
          [customer.user_id, techCorner],
        );
        assert.equal(rows.rows[0].count, 1);

        const eligibility = await request(
          `/api/shops/${techCorner}/review-eligibility`,
          { user: customer },
        );
        assert.equal(eligibility.status, 200);
        assert.equal(eligibility.data.eligible, true);
        assert.equal(eligibility.data.review.rating, 3);

        const removed = await request(`/api/shops/${techCorner}/review`, {
          user: customer,
          method: "DELETE",
        });
        assert.equal(removed.status, 204);
        const gone = await request(`/api/shops/${techCorner}/review-eligibility`, {
          user: customer,
        });
        assert.equal(gone.data.eligible, true);
        assert.equal(gone.data.review, null);
        const again = await request(`/api/shops/${techCorner}/review`, {
          user: customer,
          method: "DELETE",
        });
        assert.equal(again.status, 404);

        const badRating = await request(`/api/shops/${techCorner}/review`, {
          user: customer,
          method: "PUT",
          body: { rating: 6 },
        });
        assert.equal(badRating.status, 400);
      },
    );

    await check(
      "the shop-review trigger enforces the rule even when the API is bypassed",
      async () => {
        // The endpoint's check is a courtesy that turns a refusal into a
        // sentence. This is the enforcement, and it is the schema's own idiom —
        // the same division fn_verify_product_review_purchase already uses.
        //
        // The savepoint is what makes an expected failure survivable: the whole
        // file runs inside one transaction, and the trigger's RAISE aborts it, so
        // every later statement would come back 25P02 instead of the row it
        // asked for. Rolling back to the savepoint restores a usable transaction.
        await client.query("SAVEPOINT expects_refusal");
        await assert.rejects(
          () =>
            client.query(
              "INSERT INTO shop_reviews (user_id, shop_id, rating) VALUES ($1, $2, 1)",
              [customer2.user_id, techCorner],
            ),
          /delivered order from this shop/,
        );
        await client.query("ROLLBACK TO SAVEPOINT expects_refusal");

        // And it lets a genuine buyer through, so the guard is a filter rather
        // than a wall. The upsert is what makes this row addressable at all: the
        // seed already reviewed this shop on this customer's behalf, and the
        // UPDATE half of the statement exercises the trigger's second event.
        await client.query(
          `INSERT INTO shop_reviews (user_id, shop_id, rating, review)
           VALUES ($1, $2, 2, 'Trigger test.')
           ON CONFLICT (user_id, shop_id)
           DO UPDATE SET rating = EXCLUDED.rating, review = EXCLUDED.review`,
          [customer.user_id, gadgetHouse],
        );
        const stored = await one(
          "SELECT rating FROM shop_reviews WHERE user_id = $1 AND shop_id = $2",
          [customer.user_id, gadgetHouse],
        );
        assert.equal(stored.rating, 2);

        // last_modified is the trigger's other job: an update must restamp it,
        // because the list is ordered by it.
        const before = (
          await one(
            "SELECT last_modified FROM shop_reviews WHERE user_id = $1 AND shop_id = $2",
            [customer.user_id, gadgetHouse],
          )
        ).last_modified.getTime();
        await client.query(
          "UPDATE shop_reviews SET rating = 1 WHERE user_id = $1 AND shop_id = $2",
          [customer.user_id, gadgetHouse],
        );
        const after = (
          await one(
            "SELECT last_modified FROM shop_reviews WHERE user_id = $1 AND shop_id = $2",
            [customer.user_id, gadgetHouse],
          )
        ).last_modified.getTime();
        assert.ok(after >= before);
      },
    );
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    // Awaited, and the client released, because neither is cosmetic: an
    // unawaited close leaves the listener accepting and a held client leaves the
    // pool open, and the test file then finishes its assertions and hangs instead
    // of exiting — the one failure mode that looks like a slow test.
    if (server) await new Promise((resolve) => server.close(resolve));
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    await pool.end();
  }
});
