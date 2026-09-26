const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const { createAuthToken } = require("../src/utils/authToken");

// Placing an order: what is claimed, what is refused, and what happens when two
// customers reach for the last unit. Every check runs inside a savepoint that is
// rolled back, so each one sees the same seeded starting point.
//
// A NOTE ON WHAT THIS PROVES. The harness routes every request through one
// connection (see the pool.connect stub below), so two "concurrent" checkouts are
// serialised by node-pg rather than racing inside PostgreSQL. That still exercises
// the real guard — the claim is one conditional UPDATE and the loser sees
// in_stock below its quantity, which is exactly what a losing racer sees — but it
// cannot reproduce true parallel contention. The enforcement of that is the
// predicate sitting inside the UPDATE (so the test and the decrement cannot be
// split) plus CHECK (in_stock >= 0) on the column; the last check below asserts
// those two mechanisms directly.
test("order placement and cash-on-delivery settlement against PostgreSQL", async (t) => {
  pool.options.connectionTimeoutMillis = 10000;
  let client;
  let server;
  const originalQuery = pool.query;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const namespace = `shopsphere_order_check_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(await fs.readFile("sql/schema.sql", "utf8"));
    await client.query(
      await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"),
    );
    pool.query = (...args) => client.query(...args);
    // transaction() calls pool.connect(), which would hand back a *different*
    // pooled connection — outside this schema and outside this transaction, so the
    // order would be written to the real database. Route it back here.
    //
    // Unlike the admin suite's stub, BEGIN/COMMIT/ROLLBACK are not swallowed: they
    // become savepoints. An order is placed inside one transaction and rolled back
    // whole when any part of it fails, so a stub that ignores ROLLBACK would let a
    // half-finished order survive and quietly defeat the very property these
    // checks exist to prove. Savepoints give the nesting real semantics while the
    // outer transaction still discards everything at the end.
    let transactionDepth = 0;
    pool.connect = async () => {
      const savepoint = `order_tx_${++transactionDepth}`;
      return {
        query: async (text, values) => {
          const statement = String(text).trim().toUpperCase();
          if (statement === "BEGIN")
            return client.query(`SAVEPOINT ${savepoint}`);
          if (statement === "COMMIT")
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (statement === "ROLLBACK")
            // Rolling back to a savepoint leaves it in place; releasing it keeps
            // the name from accumulating in the outer transaction.
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
    const customer2 = account("customer2@shopsphere.test");    const vendor = account("vendor@shopsphere.test");
    const courier = account("delivery@shopsphere.test");
    const admin = account("admin@shopsphere.test");
    const countryId = (
      await client.query("SELECT country_id FROM countries ORDER BY country_id LIMIT 1")
    ).rows[0].country_id;

    async function request(path, { user = customer, method = "GET", body } = {}) {
      const headers = { "Content-Type": "application/json" };
      // A null user means "no session at all", which is how the signed-out checks
      // are spelled.
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

    const productId = async (shopName, productName) =>
      (
        await client.query(
          `SELECT p.prod_id FROM products p
           JOIN shops s ON s.shop_id = p.shop_id
           JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
           WHERE s.name = $1 AND mp.name = $2`,
          [shopName, productName],
        )
      ).rows[0].prod_id;

    const keyboard = await productId("Demo Tech Corner", "Demo Wireless Keyboard");
    const headphones = await productId("Demo Tech Corner", "Demo Bluetooth Headphones");
    const watch = await productId("Demo Tech Corner", "Demo Fitness Watch");

    // Two listings from the same shop, so the multi-item rollback check has both
    // of its items on one shop's shelves. Which is which is decided by prod_id,
    // because the claim loop runs in that order and the check only proves a
    // rollback if the claimable listing is claimed *before* the short one fails.
    // Identity assignment follows the insert plan, not the seed file's VALUES
    // order, so the roles are derived here rather than assumed.
    const [plentiful, short] = [keyboard, headphones].sort((a, b) => a - b);
    assert.notEqual(plentiful, short);

    const setStock = (prodId, quantity) =>
      client.query("UPDATE products SET in_stock = $2 WHERE prod_id = $1", [
        prodId,
        quantity,
      ]);
    const stockOf = async (prodId) =>
      (await client.query("SELECT in_stock FROM products WHERE prod_id = $1", [prodId]))
        .rows[0].in_stock;
    const priceOf = async (prodId) =>
      (await client.query("SELECT unit_price FROM products WHERE prod_id = $1", [prodId]))
        .rows[0].unit_price;
    const setCart = async (userId, entries) => {
      await client.query("DELETE FROM cart_items WHERE user_id = $1", [userId]);
      for (const [prodId, quantity] of entries)
        await client.query(
          "INSERT INTO cart_items (user_id, prod_id, quantity) VALUES ($1, $2, $3)",
          [userId, prodId, quantity],
        );
    };
    const cartOf = async (userId) =>
      (
        await client.query(
          "SELECT prod_id, quantity FROM cart_items WHERE user_id = $1 ORDER BY prod_id",
          [userId],
        )
      ).rows;
    const orderCount = async (userId) =>
      (
        await client.query(
          "SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1",
          [userId],
        )
      ).rows[0].n;
    const salesOf = async (prodId) =>
      (
        await client.query(
          `SELECT COUNT(*)::int AS n FROM order_items oi
           JOIN orders o ON o.order_id = oi.order_id
           WHERE oi.prod_id = $1 AND o.order_status <> 'cancelled'`,
          [prodId],
        )
      ).rows[0].n;
    const setCourierStatus = (status) =>
      client.query(
        "UPDATE delivery_personnel SET active_status = $1 WHERE delivery_person_id = $2",
        [status, courier.user_id],
      );
    const setDiscontinued = (prodId, discontinued) =>
      client.query("UPDATE products SET discontinued = $2 WHERE prod_id = $1", [
        prodId,
        discontinued,
      ]);

    const placeOrder = (user, body = {}) =>
      request("/api/orders", { user, method: "POST", body });

    async function check(name, run) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT regression_case");
        try {
          await run();
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT regression_case");
        }
      });
    }

    await check("a checkout claims the stock and empties the cart", async () => {
      await setStock(keyboard, 5);
      await setCart(customer.user_id, [[keyboard, 2]]);

      const placed = await placeOrder(customer);
      assert.equal(placed.status, 201, placed.data.message);
      assert.equal(placed.data.order.order_status, "pending");
      assert.equal(await stockOf(keyboard), 3);
      assert.deepEqual(await cartOf(customer.user_id), []);

      // The total is the trigger's sum of the item snapshots, and the payment is
      // that total plus delivery.
      const price = await priceOf(keyboard);
      const expected = Number(price) * 2;
      assert.equal(Number(placed.data.order.total_amount), expected);
      assert.equal(
        Number(placed.data.order.payment.amount),
        expected + Number(placed.data.order.delivery_cost),
      );
      assert.equal(placed.data.order.payment.payment_method, "cash_on_delivery");
      assert.equal(placed.data.order.payment.payment_status, "pending");
      // paid_at must stay null: the column defaults to CURRENT_TIMESTAMP, which
      // would otherwise date an unpaid order as paid.
      assert.equal(placed.data.order.payment.paid_at, null);
    });

    await check(
      "stock that ran out mid-checkout is refused, and nothing is taken",
      async () => {
        const before = await orderCount(customer.user_id);
        await setStock(keyboard, 1);
        await setCart(customer.user_id, [[keyboard, 2]]);

        const refused = await placeOrder(customer);
        assert.equal(refused.status, 409, refused.data.message);
        assert.match(refused.data.message, /Demo Wireless Keyboard/);
        assert.match(refused.data.message, /1 left/);

        assert.equal(await stockOf(keyboard), 1);
        assert.equal(await orderCount(customer.user_id), before);
        // The cart survives so the customer can adjust it and retry.
        assert.deepEqual(await cartOf(customer.user_id), [
          { prod_id: keyboard, quantity: 2 },
        ]);
      },
    );

    await check(
      "the last unit goes to exactly one customer, and stock never goes negative",
      async () => {
        await setStock(keyboard, 1);
        await setCart(customer.user_id, [[keyboard, 1]]);
        await setCart(customer2.user_id, [[keyboard, 1]]);
        const before = await salesOf(keyboard);

        // Sent one after the other, not with Promise.all, and that is a limitation
        // of this harness rather than a weaker claim. Every request is routed
        // through a single connection, so "concurrent" checkouts do not race
        // inside PostgreSQL — they interleave, and their savepoints nest. The
        // first request's rollback would then undo the second request's committed
        // work, which is an artefact of one session rather than anything a real
        // deployment does. What is asserted here is the outcome that matters: the
        // second customer is refused once the last unit is gone, and the stock
        // never goes below zero. What makes that hold under true parallelism is
        // the predicate inside the UPDATE, asserted directly in the last check.
        const first = await placeOrder(customer);
        assert.equal(first.status, 201, first.data.message);

        const second = await placeOrder(customer2);
        assert.equal(second.status, 409, second.data.message);

        assert.equal(await stockOf(keyboard), 0);
        assert.equal(await salesOf(keyboard), before + 1);
      },
    );

    await check("a multi-item order is all or nothing", async () => {
      const before = await orderCount(customer.user_id);
      await setStock(plentiful, 5);
      await setStock(short, 1);
      // The plentiful listing can be claimed; the short one cannot. Claiming runs
      // in prod_id order, so this is the case where a claim has already landed and
      // has to be undone.
      await setCart(customer.user_id, [
        [plentiful, 2],
        [short, 2],
      ]);

      const refused = await placeOrder(customer);
      assert.equal(refused.status, 409, refused.data.message);

      // The first claim was rolled back with everything else.
      assert.equal(await stockOf(plentiful), 5);
      assert.equal(await stockOf(short), 1);
      assert.equal(await orderCount(customer.user_id), before);
    });

    await check("a listing that went off sale cannot be bought", async () => {
      await setStock(keyboard, 5);
      await setCart(customer.user_id, [[keyboard, 1]]);
      await setDiscontinued(keyboard, true);

      const refused = await placeOrder(customer);
      assert.equal(refused.status, 409, refused.data.message);
      assert.match(refused.data.message, /went off sale/);
      assert.equal(await stockOf(keyboard), 5);
    });

    await check("an empty cart cannot be checked out", async () => {
      await setCart(customer.user_id, []);
      const refused = await placeOrder(customer);
      assert.equal(refused.status, 400);
      assert.match(refused.data.message, /cart is empty/i);
    });

    await check(
      "the order is delivered, and that is when the cash settles",
      async () => {
        await setStock(watch, 3);
        await setCart(customer.user_id, [[watch, 1]]);
        const placed = await placeOrder(customer);
        assert.equal(placed.status, 201, placed.data.message);
        const orderId = placed.data.order.order_id;

        // The courier sees it on their run, with the parcel's contents.
        const run = await request("/api/delivery/deliveries", { user: courier });
        assert.equal(run.status, 200);
        const assigned = run.data.find((order) => order.order_id === orderId);
        assert.ok(assigned, "the new order must appear on the courier's run");
        assert.equal(assigned.order_status, "pending");
        assert.equal(assigned.customer_name, "Demo Customer");
        assert.equal(assigned.items.length, 1);
        assert.equal(assigned.payment_status, "pending");

        const shipped = await request(`/api/delivery/orders/${orderId}/status`, {
          user: courier,
          method: "PUT",
          body: { order_status: "shipped" },
        });
        assert.equal(shipped.status, 200, shipped.data.message);
        assert.equal(shipped.data.order.order_status, "shipped");
        // Delivery is what settles it, so shipping must leave the payment alone.
        assert.equal(shipped.data.order.payment, null);

        const delivered = await request(`/api/delivery/orders/${orderId}/status`, {
          user: courier,
          method: "PUT",
          body: { order_status: "delivered" },
        });
        assert.equal(delivered.status, 200, delivered.data.message);
        assert.equal(delivered.data.order.order_status, "delivered");
        assert.equal(delivered.data.order.payment.payment_status, "completed");
        assert.ok(delivered.data.order.payment.paid_at);

        // It is off the run now, and the customer's history shows it settled.
        const after = await request("/api/delivery/deliveries", { user: courier });
        assert.equal(
          after.data.some((order) => order.order_id === orderId),
          false,
        );
        const history = await request(`/api/orders/${orderId}`);
        assert.equal(history.data.order_status, "delivered");
        assert.equal(history.data.payment_status, "completed");
        assert.equal(history.data.items.length, 1);
      },
    );

    await check("procedure failure rolls back delivery, payment and courier earnings", async () => {
      await setCart(customer.user_id, [[watch, 1]]);
      const placed = await placeOrder(customer);
      assert.equal(placed.status, 201);
      const path = `/api/delivery/orders/${placed.data.order.order_id}/status`;
      assert.equal((await request(path, { user: courier, method: "PUT", body: { order_status: "shipped" } })).status, 200);
      const balance = (await client.query("SELECT earnings FROM delivery_personnel WHERE delivery_person_id=$1", [courier.user_id])).rows[0].earnings;
      await client.query(`CREATE FUNCTION reject_settlement() RETURNS TRIGGER AS $$
        BEGIN RAISE EXCEPTION 'Simulated settlement failure'; END; $$ LANGUAGE plpgsql;
        CREATE TRIGGER reject_settlement BEFORE UPDATE ON payments
        FOR EACH ROW EXECUTE FUNCTION reject_settlement()`);
      const failed = await request(path, { user: courier, method: "PUT", body: { order_status: "delivered" } });
      assert.equal(failed.status, 409);
      const order = (await request(`/api/orders/${placed.data.order.order_id}`)).data;
      assert.equal(order.order_status, "shipped");
      assert.equal(order.payment_status, "pending");
      assert.equal(order.delivered_at, null);
      assert.equal((await client.query("SELECT earnings FROM delivery_personnel WHERE delivery_person_id=$1", [courier.user_id])).rows[0].earnings, balance);
    });

    await check("a delivery cannot skip the shipped step", async () => {
      await setStock(watch, 3);
      await setCart(customer.user_id, [[watch, 1]]);
      const placed = await placeOrder(customer);
      assert.equal(placed.status, 201, placed.data.message);

      const skipped = await request(
        `/api/delivery/orders/${placed.data.order.order_id}/status`,
        { user: courier, method: "PUT", body: { order_status: "delivered" } },
      );
      assert.equal(skipped.status, 409, skipped.data.message);
      assert.match(skipped.data.message, /pending/);
    });

    await check("a courier cannot touch an order that is not theirs", async () => {
      await setStock(watch, 3);
      await setCart(customer.user_id, [[watch, 1]]);
      await setCourierStatus("unavailable");
      const placed = await placeOrder(customer);
      assert.equal(placed.status, 201, placed.data.message);
      assert.equal(placed.data.order.delivery_person_id, null);
      await setCourierStatus("available");

      const touched = await request(
        `/api/delivery/orders/${placed.data.order.order_id}/status`,
        { user: courier, method: "PUT", body: { order_status: "shipped" } },
      );
      assert.equal(touched.status, 404);
    });

    await check(
      "cancelling returns the stock and fails the cash-on-delivery payment",
      async () => {
        await setStock(watch, 3);
        await setCart(customer.user_id, [[watch, 2]]);
        const placed = await placeOrder(customer);
        assert.equal(placed.status, 201, placed.data.message);
        const orderId = placed.data.order.order_id;
        assert.equal(await stockOf(watch), 1);

        const cancelled = await request(`/api/orders/${orderId}/cancel`, {
          method: "PUT",
        });
        assert.equal(cancelled.status, 200, cancelled.data.message);
        assert.equal(cancelled.data.order.order_status, "cancelled");
        assert.equal(await stockOf(watch), 3);

        const detail = await request(`/api/orders/${orderId}`);
        assert.equal(detail.data.order_status, "cancelled");
        // fn_cleanup_cancelled_order fails the pending payment: there is no money
        // to refund, but "pending" would wrongly imply it is still expected.
        assert.equal(detail.data.payment_status, "failed");
        assert.equal(detail.data.paid_at, null);
      },
    );

    await check("only a pending order can be cancelled", async () => {
      await setStock(watch, 3);
      await setCart(customer.user_id, [[watch, 1]]);
      const placed = await placeOrder(customer);
      const orderId = placed.data.order.order_id;
      assert.equal(
        (
          await request(`/api/delivery/orders/${orderId}/status`, {
            user: courier,
            method: "PUT",
            body: { order_status: "shipped" },
          })
        ).status,
        200,
      );

      const refused = await request(`/api/orders/${orderId}/cancel`, {
        method: "PUT",
      });
      assert.equal(refused.status, 409, refused.data.message);
      assert.match(refused.data.message, /shipped/);
      assert.equal(await stockOf(watch), 2);
    });

    await check("an order cannot be cancelled twice", async () => {
      await setStock(watch, 3);
      await setCart(customer.user_id, [[watch, 1]]);
      const placed = await placeOrder(customer);
      const orderId = placed.data.order.order_id;
      assert.equal(
        (await request(`/api/orders/${orderId}/cancel`, { method: "PUT" })).status,
        200,
      );
      // A second cancel must not return the stock a second time.
      assert.equal(
        (await request(`/api/orders/${orderId}/cancel`, { method: "PUT" })).status,
        409,
      );
      assert.equal(await stockOf(watch), 3);
    });

    await check(
      "checkout assigns an available courier, and waits when there is none",
      async () => {
        await setCourierStatus("available");
        await setStock(watch, 3);
        await setCart(customer.user_id, [[watch, 1]]);
        const assigned = await placeOrder(customer);
        assert.equal(assigned.status, 201, assigned.data.message);
        assert.equal(assigned.data.order.delivery_person_id, courier.user_id);

        await setCourierStatus("unavailable");
        await setCart(customer.user_id, [[watch, 1]]);
        const waiting = await placeOrder(customer);
        assert.equal(waiting.status, 201, waiting.data.message);
        assert.equal(waiting.data.order.delivery_person_id, null);
      },
    );

    await check("disabled couriers receive no new orders", async () => {
      await client.query("UPDATE users SET active_status='disabled' WHERE user_id=$1", [courier.user_id]);
      await setCourierStatus("available");
      await setCart(customer.user_id, [[watch, 1]]);
      const placed = await placeOrder(customer);
      assert.equal(placed.status, 201, placed.data.message);
      assert.equal(placed.data.order.delivery_person_id, null);
    });

    await check("inherited property names are invalid delivery statuses", async () => {
      for (const order_status of ["constructor", "toString", "__proto__"])
        assert.equal((await request("/api/delivery/orders/1/status", {
          user: courier, method: "PUT", body: { order_status },
        })).status, 400);
    });

    await check(
      "checkout uses the profile address unless another one is given",
      async () => {
        await setStock(watch, 3);
        await setCart(customer.user_id, [[watch, 1]]);

        const profile = (
          await client.query("SELECT address FROM users WHERE user_id = $1", [
            customer.user_id,
          ])
        ).rows[0].address;
        const plain = await placeOrder(customer);
        assert.equal(plain.status, 201, plain.data.message);
        assert.equal(plain.data.order.shipping_address, profile);

        const before = (
          await client.query("SELECT COUNT(*)::int AS n FROM locations")
        ).rows[0].n;
        // Checkout emptied the cart, so the second order needs something to buy.
        await setCart(customer.user_id, [[watch, 1]]);
        const other = await placeOrder(customer, {
          street_address: "17 Somewhere Else",
          city: "Dhaka",
          postal_code: "1212",
          country_id: countryId,
        });
        assert.equal(other.status, 201, other.data.message);
        assert.notEqual(other.data.order.shipping_address, profile);
        // A new row, not an edit: an older order keeps the address it was sent to.
        assert.equal(
          (await client.query("SELECT COUNT(*)::int AS n FROM locations")).rows[0].n,
          before + 1,
        );
        assert.equal(
          (
            await client.query(
              "SELECT street_address FROM locations WHERE location_id = $1",
              [other.data.order.shipping_address],
            )
          ).rows[0].street_address,
          "17 Somewhere Else",
        );
      },
    );

    await check(
      "a profile with no address cannot check out without giving one",
      async () => {
        await setStock(watch, 3);
        await setCart(customer.user_id, [[watch, 1]]);
        await client.query("UPDATE users SET address = NULL WHERE user_id = $1", [
          customer.user_id,
        ]);

        const refused = await placeOrder(customer);
        assert.equal(refused.status, 400, refused.data.message);
        assert.match(refused.data.message, /delivery address/);

        // Supplying one is enough; the profile does not have to be filled in first.
        const supplied = await placeOrder(customer, {
          street_address: "4 Nowhere Road",
          city: "Dhaka",
          country_id: countryId,
        });
        assert.equal(supplied.status, 201, supplied.data.message);
      },
    );

    await check("the order list is the customer's own", async () => {
      const mine = await request("/api/orders");
      assert.equal(mine.status, 200);
      assert.ok(mine.data.length >= 1);
      assert.ok(
        mine.data.every((order) => order.order_id !== undefined),
        "each row carries its id",
      );

      // customer2's seeded pending order is not customer's to read.
      const theirs = (
        await client.query(
          "SELECT order_id FROM orders WHERE user_id = $1 LIMIT 1",
          [customer2.user_id],
        )
      ).rows[0].order_id;
      assert.equal((await request(`/api/orders/${theirs}`)).status, 404);
    });

    await check("the order surface is closed to guests and other roles", async () => {
      const paths = [
        ["GET", "/api/orders"],
        ["POST", "/api/orders"],
        ["GET", "/api/orders/1"],
        ["PUT", "/api/orders/1/cancel"],
      ];
      for (const [method, path] of paths) {
        assert.equal(
          (await request(path, { user: null, method })).status,
          401,
          `${method} ${path} must reject a guest`,
        );
        for (const user of [vendor, courier, admin]) {
          assert.equal(
            (await request(path, { user, method })).status,
            403,
            `${method} ${path} must reject a ${user.role_name}`,
          );
        }
      }

      const courierPaths = [
        ["GET", "/api/delivery/deliveries"],
        ["PUT", "/api/delivery/orders/1/status"],
      ];
      for (const [method, path] of courierPaths) {
        assert.equal(
          (await request(path, { user: null, method })).status,
          401,
          `${method} ${path} must reject a guest`,
        );
        for (const user of [customer, vendor, admin]) {
          assert.equal(
            (await request(path, { user, method })).status,
            403,
            `${method} ${path} must reject a ${user.role_name}`,
          );
        }
      }
    });

    await check("the courier profile carries the vehicle fields", async () => {
      const saved = await request("/api/delivery/profile", {
        user: courier,
        method: "PUT",
        body: {
          active_status: "available",
          vehicle_info: "Rear carrier, insulated bag",
          vehicle_type: "motorcycle",
          vehicle_number: "DHK-1234",
          license_number: "LIC-99887",
          vehicle_model: "Honda CD 70",
        },
      });
      assert.equal(saved.status, 200, saved.data.message);
      assert.equal(saved.data.profile.vehicle_type, "motorcycle");
      assert.equal(saved.data.profile.vehicle_number, "DHK-1234");
      assert.equal(saved.data.profile.license_number, "LIC-99887");
      assert.equal(saved.data.profile.vehicle_model, "Honda CD 70");
      assert.equal(saved.data.profile.vehicle_info, "Rear carrier, insulated bag");

      // Read back, so the workspace is not told it saved something it did not.
      const read = await request("/api/delivery/profile", { user: courier });
      assert.equal(read.data.vehicle_number, "DHK-1234");

      // A typo in the closed list is refused rather than stored.
      assert.equal(
        (
          await request("/api/delivery/profile", {
            user: courier,
            method: "PUT",
            body: {
              active_status: "available",
              vehicle_info: "Notes",
              vehicle_type: "hovercraft",
            },
          })
        ).status,
        400,
      );
    });

    await check(
      "the claim is one atomic statement, and the column is the backstop",
      async () => {
        // The guard the whole design rests on, asserted directly: the predicate and
        // the decrement are evaluated together, so the loser is told "no rows"
        // rather than reading a stale stock and acting on it.
        await setStock(keyboard, 0);
        const lost = await client.query(
          "UPDATE products SET in_stock = in_stock - $2 WHERE prod_id = $1 AND in_stock >= $2 RETURNING in_stock",
          [keyboard, 1],
        );
        assert.equal(lost.rowCount, 0);
        assert.equal(lost.rows.length, 0);
        assert.equal(await stockOf(keyboard), 0);

        // And if a predicate were ever weakened, the column refuses to go negative.
        await assert.rejects(
          client.query("UPDATE products SET in_stock = -1 WHERE prod_id = $1", [
            keyboard,
          ]),
          (error) => error.code === "23514",
        );
      },
    );
  } finally {
    pool.query = originalQuery;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (client) {
      await client.query("ROLLBACK");
      client.release();
    }
    await pool.end();
  }
});
