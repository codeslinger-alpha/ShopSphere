const test = require("node:test");
const assert = require("node:assert/strict");
const scratch = require("./scratch-schema");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const { createAuthToken } = require("../src/utils/authToken");

// Customer returns, the shop balance, and the arithmetic that ties them together.
//
// Three things are being proven, and they are the three that would be expensive
// to get wrong:
//
//   1. the balance is not a number that drifts — it equals its sources, exactly,
//      after a delivery, a purchase, a return and a recharge;
//   2. every step of the return flow happens at most once, so no double refund,
//      no double restock;
//   3. the customer's payment is the goods plus the trip, and the shop and the
//      courier between them receive exactly all of it — nothing is withheld.
//
// Money is why the assertions are arithmetic rather than a status code. A 409
// that still moved the money looks identical from the outside, so each refusal
// is followed by the balance it was supposed to leave alone.
//
// Every check runs in a savepoint that is rolled back, so each one starts from
// the same seeded database even though the checks deliver orders and refund
// customers.
test("customer returns and the shop balance against Oracle", async (t) => {
  let client;
  let namespace;
  let server;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  try {
    client = await pool.connect();
    namespace = await scratch.create(client, "SHOPSPHERE_RETURNS");
    await scratch.load(client);
    scratch.funnel(pool, client);
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

    async function request(path, { user = customer, method = "GET", body } = {}) {
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

    const scalar = async (sql, values = []) =>
      Object.values((await client.query(sql, values)).rows[0])[0];
    const shopByName = async (name) =>
      scalar("SELECT shop_id FROM shops WHERE name = :1", [name]);
    const masterByName = async (name) =>
      scalar(
        "SELECT master_prod_id FROM master_products WHERE name = :1 AND manufacturer = 'ShopSphere Demo'",
        [name],
      );
    const techCorner = await shopByName("Demo Tech Corner");
    const gadgetHouse = await shopByName("Demo Gadget House");

    const shopOf = (prodId) =>
      scalar("SELECT shop_id FROM products WHERE prod_id = :1", [prodId]);
    const balanceOf = (shopId) =>
      scalar("SELECT balance FROM shops WHERE shop_id = :1", [shopId]).then(
        Number,
      );
    const setBalance = (shopId, amount) =>
      client.query("UPDATE shops SET balance = :2 WHERE shop_id = :1", [
        shopId,
        amount,
      ]);
    const stockOf = (prodId) =>
      scalar("SELECT in_stock FROM products WHERE prod_id = :1", [prodId]);
    const earningsOf = (userId) =>
      scalar(
        "SELECT earnings FROM delivery_personnel WHERE delivery_person_id = :1",
        [userId],
      ).then(Number);
    const purchasesOf = (shopId) =>
      scalar("SELECT COUNT(*) FROM shop_purchases WHERE shop_id = :1", [
        shopId,
      ]);
    const orderFor = (email, status) =>
      scalar(
        `SELECT o.order_id FROM orders o JOIN users u ON u.user_id = o.user_id
         WHERE u.email = :1 AND o.order_status = :2`,
        [email, status],
      );
    const itemsOf = async (orderId) =>
      (
        await client.query(
          "SELECT prod_id, quantity, unit_price FROM order_items WHERE order_id = :1 ORDER BY prod_id",
          [orderId],
        )
      ).rows;
    const refundsOf = async (shopId) =>
      (
        await client.query(
          "SELECT * FROM customer_refunds WHERE shop_id = :1",
          [shopId],
        )
      ).rows;
    const returnsOf = async (orderId) =>
      (
        await client.query(
          "SELECT * FROM product_returns WHERE order_id = :1 ORDER BY return_id",
          [orderId],
        )
      ).rows;
    const clearReturns = (orderId) =>
      client.query("DELETE FROM product_returns WHERE order_id = :1", [orderId]);

    const deliveredOrder = await orderFor("customer@shopsphere.test", "delivered");
    // The seeded delivered order carries one unit of each of three listings, two
    // from Tech Corner and one from Gadget House. Which is which is looked up
    // rather than assumed from the order the rows come back in, because two of
    // the checks below are about one shop not seeing the other's returns.
    const deliveredItems = [];
    for (const item of await itemsOf(deliveredOrder))
      deliveredItems.push({ ...item, shop_id: await shopOf(item.prod_id) });
    const line = deliveredItems.find((item) => item.shop_id === techCorner);
    const otherLine = deliveredItems.find((item) => item.shop_id === gadgetHouse);
    assert.ok(line && otherLine, "the seeded delivered order should span both shops");
    const lineShop = line.shop_id;

    // Every shop's balance against the four ledgers that feed it. Zero rows means
    // the cached total agrees with its sources, everywhere — which is the only
    // version of this check that cannot be satisfied by two errors cancelling out
    // in one shop.
    const identityBreaks = () =>
      scalar(`
        SELECT COUNT(*) FROM shops s
        WHERE s.balance <> COALESCE((
                SELECT SUM(oi.quantity * oi.unit_price)
                FROM order_items oi
                JOIN orders o ON o.order_id = oi.order_id
                JOIN products p ON p.prod_id = oi.prod_id
                WHERE p.shop_id = s.shop_id AND o.order_status = 'delivered'
              ), 0)
            + COALESCE((SELECT SUM(t.amount) FROM shop_topups t
                        WHERE t.shop_id = s.shop_id), 0)
            - COALESCE((SELECT SUM(sp.quantity * sp.wholesale_unit_price)
                        FROM shop_purchases sp WHERE sp.shop_id = s.shop_id), 0)
            + COALESCE((SELECT SUM(vr.amount) FROM vendor_refunds vr
                        WHERE vr.shop_id = s.shop_id), 0)
            - COALESCE((SELECT SUM(cr.amount) FROM customer_refunds cr
                        WHERE cr.shop_id = s.shop_id), 0)
      `);

    const askToReturn = (orderId, prodId, quantity, user = customer) =>
      request("/api/returns", {
        user,
        method: "POST",
        body: {
          order_id: orderId,
          prod_id: prodId,
          quantity,
          reason: "It arrived scratched.",
        },
      });
    const decide = (returnId, action, user = vendor, note = "Accepted.") =>
      request(`/api/vendor/returns/${returnId}/${action}`, {
        user,
        method: "PUT",
        body: { decision_note: note },
      });
    const collect = (returnId, user = courier) =>
      request(`/api/delivery/returns/${returnId}/collect`, {
        user,
        method: "PUT",
      });
    const restock = (returnId, user = vendor) =>
      request(`/api/vendor/returns/${returnId}/restock`, { user, method: "PUT" });

    // Open a return on a line and hand back its id, which almost every check
    // below needs as a starting point.
    async function openReturn(item = line) {
      const made = await askToReturn(deliveredOrder, item.prod_id, 1);
      assert.equal(made.status, 201, made.data.message);
      return made.data.return.return_id;
    }

    async function check(name, run) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT returns_case");
        try {
          await run();
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT returns_case");
        }
      });
    }

    await check(
      "asking to return something prices it from the order, not from the caller",
      async () => {
        const before = await balanceOf(lineShop);
        const made = await askToReturn(deliveredOrder, line.prod_id, 1);

        assert.equal(made.status, 201, made.data.message);
        assert.equal(made.data.return.status, "requested");
        assert.equal(Number(made.data.return.refund_amount), Number(line.unit_price));
        // A request is only a request: the shop has not agreed to anything, so
        // nothing has moved yet.
        assert.equal(await balanceOf(lineShop), before);
        assert.equal((await refundsOf(lineShop)).length, 0);
        assert.match(made.data.message, /for review/);
      },
    );

    await check("only the buyer of a line can return it", async () => {
      // customer2 did not buy this, and cannot reach it by naming the order.
      const theirs = await askToReturn(deliveredOrder, line.prod_id, 1, customer2);
      assert.equal(theirs.status, 404, theirs.data.message);

      const guest = await askToReturn(deliveredOrder, line.prod_id, 1, null);
      assert.equal(guest.status, 401, guest.data.message);
    });

    await check("an order still on its way cannot be returned", async () => {
      const pending = await orderFor("customer2@shopsphere.test", "pending");
      const [item] = await itemsOf(pending);
      const refused = await askToReturn(pending, item.prod_id, 1, customer2);

      assert.equal(refused.status, 409, refused.data.message);
      assert.match(refused.data.message, /delivered/);
      assert.equal((await returnsOf(pending)).length, 0);
    });

    await check(
      "an open return cannot be duplicated, and a second ask is refused",
      async () => {
        await openReturn();
        // The line is one unit and the open return claims it, so the trigger
        // refuses a second claim on the same unit.
        const again = await askToReturn(deliveredOrder, line.prod_id, 1);
        assert.equal(again.status, 409, again.data.message);
        assert.equal((await returnsOf(deliveredOrder)).length, 1);
      },
    );

    await check(
      "the database caps cumulative returns at what was ordered",
      async () => {
        await clearReturns(deliveredOrder);
        const insert = (quantity, status) =>
          client.query(
            `INSERT INTO product_returns
               (order_id, prod_id, user_id, shop_id, quantity, reason, status, refund_amount)
             VALUES (:1, :2, :3, :4, :5, 'direct', :6, :5 * :7)`,
            [
              deliveredOrder,
              line.prod_id,
              customer.user_id,
              lineShop,
              quantity,
              status,
              Number(line.unit_price),
            ],
          );

        // A rejected statement aborts the surrounding transaction, and this suite
        // deliberately runs everything inside one, so each expected failure is
        // taken inside its own savepoint and rolled back out of. Without this the
        // refusal itself would look like the bug: every later statement would
        // fail with "current transaction is aborted".
        const refuse = async (quantity, message) => {
          await client.query("SAVEPOINT return_insert");
          await assert.rejects(
            insert(quantity, "requested"),
            /more units than they bought/,
            message,
          );
          await client.query("ROLLBACK TO SAVEPOINT return_insert");
        };

        // The order line is one unit, so a claim of two is more than was bought
        // however the request is written.
        await refuse(2, "a claim larger than the order line must be refused");

        await insert(1, "restocked");
        await refuse(1, "a second claim on the same unit must be refused");
        // A rejection releases the unit: it refunded nothing, so the customer is
        // still owed the chance to ask again.
        await insert(1, "rejected");
        assert.equal((await returnsOf(deliveredOrder)).length, 2);
      },
    );

    await check(
      "accepting a return refunds the customer from the shop's balance",
      async () => {
        const returnId = await openReturn();
        const before = await balanceOf(lineShop);
        const amount = Number(line.unit_price);

        const accepted = await decide(returnId, "approve");
        assert.equal(accepted.status, 200, accepted.data.message);
        assert.equal(await balanceOf(lineShop), before - amount);
        assert.match(accepted.data.message, /were refunded|was refunded/);

        const refunds = await refundsOf(lineShop);
        assert.equal(refunds.length, 1);
        assert.equal(Number(refunds[0].amount), amount);
        assert.equal(refunds[0].return_id, returnId);
        assert.equal(refunds[0].user_id, customer.user_id);
        assert.equal(refunds[0].order_id, deliveredOrder);
      },
    );

    await check(
      "a shop with nothing in its balance still refunds the customer",
      async () => {
        const returnId = await openReturn();
        const amount = Number(line.unit_price);
        // The balance is deliberately allowed to go negative: a vendor must not
        // be able to keep a customer's money by having spent it.
        await setBalance(lineShop, 0);

        const accepted = await decide(returnId, "approve");
        assert.equal(accepted.status, 200, accepted.data.message);
        assert.equal(await balanceOf(lineShop), -amount);
        assert.equal((await refundsOf(lineShop)).length, 1);
      },
    );

    await check("a return is decided once", async () => {
      const returnId = await openReturn();
      const amount = Number(line.unit_price);
      const before = await balanceOf(lineShop);

      assert.equal((await decide(returnId, "approve")).status, 200);
      const afterFirst = await balanceOf(lineShop);
      assert.equal(afterFirst, before - amount);

      // Approving again would refund a second time if the status were not part
      // of the update's predicate.
      const again = await decide(returnId, "approve");
      assert.equal(again.status, 409, again.data.message);
      assert.equal(await balanceOf(lineShop), afterFirst);
      assert.equal((await refundsOf(lineShop)).length, 1);

      const flip = await decide(returnId, "reject", vendor, "Too late.");
      assert.equal(flip.status, 409, flip.data.message);
      assert.equal(await balanceOf(lineShop), afterFirst);
    });

    await check(
      "a refusal refunds nothing and leaves the customer free to ask again",
      async () => {
        const returnId = await openReturn();
        const before = await balanceOf(lineShop);

        const refused = await decide(returnId, "reject", vendor, "Outside the window.");
        assert.equal(refused.status, 200, refused.data.message);
        assert.equal(await balanceOf(lineShop), before);
        assert.equal((await refundsOf(lineShop)).length, 0);
        // The record stays, with the reason on it.
        const [row] = await returnsOf(deliveredOrder);
        assert.equal(row.status, "rejected");
        assert.equal(row.decision_note, "Outside the window.");

        const again = await askToReturn(deliveredOrder, line.prod_id, 1);
        assert.equal(again.status, 201, again.data.message);
        assert.equal((await returnsOf(deliveredOrder)).length, 2);
      },
    );

    await check("declining without a reason is refused", async () => {
      const returnId = await openReturn();
      const silent = await request(`/api/vendor/returns/${returnId}/reject`, {
        user: vendor,
        method: "PUT",
        body: { decision_note: "" },
      });
      assert.equal(silent.status, 400, silent.data.message);
      assert.equal((await returnsOf(deliveredOrder))[0].status, "requested");
    });

    await check("only the shop that sold it decides", async () => {
      const returnId = await openReturn();
      const stranger = await decide(returnId, "approve", vendor2);
      assert.equal(stranger.status, 409, stranger.data.message);
      assert.equal((await returnsOf(deliveredOrder))[0].status, "requested");

      const asCustomer = await decide(returnId, "approve", customer);
      assert.equal(asCustomer.status, 403, asCustomer.data.message);
      const asGuest = await decide(returnId, "approve", null);
      assert.equal(asGuest.status, 401, asGuest.data.message);
    });

    await check(
      "a courier collects an accepted parcel, and only once",
      async () => {
        const returnId = await openReturn();
        await decide(returnId, "approve");
        const before = await balanceOf(lineShop);

        // A parcel nobody has agreed to take back is not a pickup. This uses the
        // other shop's line so that the open return above still holds its own.
        const early = await openReturn(otherLine);
        assert.equal((await collect(early)).status, 409);

        // Only a courier may collect.
        assert.equal((await collect(returnId, customer)).status, 403);
        assert.equal((await collect(returnId, null)).status, 401);

        const collected = await collect(returnId);
        assert.equal(collected.status, 200, collected.data.message);
        const [row] = await returnsOf(deliveredOrder);
        assert.equal(row.status, "collected");
        assert.equal(row.collected_by, courier.user_id);
        assert.ok(row.collected_at, "a collection records when it happened");

        // Collection is a movement of goods, not of money: the refund was paid
        // when the shop accepted the return.
        assert.equal(await balanceOf(lineShop), before);

        const again = await collect(returnId);
        assert.equal(again.status, 409, again.data.message);
      },
    );

    await check(
      "restocking puts the units back once, and moves no money",
      async () => {
        const returnId = await openReturn();
        await decide(returnId, "approve");
        const before = await balanceOf(lineShop);
        const stockBefore = await stockOf(line.prod_id);

        // The parcel has to be in hand before it can go back on the shelf.
        const early = await restock(returnId);
        assert.equal(early.status, 409, early.data.message);
        assert.equal(await stockOf(line.prod_id), stockBefore);

        await collect(returnId);
        const restored = await restock(returnId);
        assert.equal(restored.status, 200, restored.data.message);
        assert.equal(restored.data.in_stock, stockBefore + 1);
        assert.equal(await stockOf(line.prod_id), stockBefore + 1);
        // Not a second refund.
        assert.equal(await balanceOf(lineShop), before);
        assert.match(restored.data.message, /balance was not changed/);

        const again = await restock(returnId);
        assert.equal(again.status, 409, again.data.message);
        assert.equal(await stockOf(line.prod_id), stockBefore + 1);
      },
    );

    await check("a vendor sees its own returns and nobody else's", async () => {
      const mine = await askToReturn(deliveredOrder, otherLine.prod_id, 1);
      assert.equal(mine.status, 201, mine.data.message);
      const returnId = mine.data.return.return_id;

      // The other shop's return must not appear in this vendor's queue, and must
      // appear in the shop that sold it.
      const asTechCorner = await request("/api/vendor/returns", { user: vendor });
      assert.equal(asTechCorner.status, 200);
      assert.equal(
        asTechCorner.data.some((row) => row.return_id === returnId),
        false,
        "another shop's return must not appear in the vendor's queue",
      );

      const asGadgetHouse = await request("/api/vendor/returns", { user: vendor2 });
      assert.equal(
        asGadgetHouse.data.some((row) => row.return_id === returnId),
        true,
      );

      // The customer's own list is scoped the same way, and carries the shop's
      // answer back to them.
      await decide(returnId, "approve", vendor2, "Sorry.");
      const theirs = await request("/api/returns", { user: customer });
      const seen = theirs.data.find((row) => row.return_id === returnId);
      assert.equal(seen.status, "approved");
      assert.equal(seen.decision_note, "Sorry.");

      const other = await request("/api/returns", { user: customer2 });
      assert.equal(
        other.data.some((row) => row.return_id === returnId),
        false,
      );
    });

    await check("the pickup list is what is accepted and not yet collected", async () => {
      const returnId = await openReturn();
      const listed = () => request("/api/delivery/returns", { user: courier });

      // A request nobody has decided is not a pickup.
      assert.equal(
        (await listed()).data.some((row) => row.return_id === returnId),
        false,
      );

      await decide(returnId, "approve");
      const approved = (await listed()).data.find(
        (row) => row.return_id === returnId,
      );
      assert.ok(approved, "an accepted return should be waiting for a courier");
      // The courier needs somewhere to go, and it comes from the order's address
      // rather than from the return.
      assert.ok(approved.street_address);
      assert.ok(approved.city);
      assert.equal(approved.status, "approved");

      await collect(returnId);
      assert.equal(
        (await listed()).data.some((row) => row.return_id === returnId),
        false,
        "a collected return leaves the pickup list",
      );

      assert.equal(
        (await request("/api/delivery/returns", { user: customer })).status,
        403,
      );
    });

    await check("a purchase the balance cannot cover is refused", async () => {
      const master = await masterByName("Demo Wireless Keyboard");
      const wholesale = Number(
        await scalar(
          "SELECT wholesale_price FROM master_products WHERE master_prod_id = :1",
          [master],
        ),
      );
      await setBalance(techCorner, 5);
      const purchasesBefore = await purchasesOf(techCorner);

      const refused = await request("/api/vendor/listings", {
        user: vendor,
        method: "POST",
        body: {
          shop_id: techCorner,
          master_prod_id: master,
          quantity: 4,
          unit_price: "99.00",
          description: "",
        },
      });

      assert.equal(refused.status, 409, refused.data.message);
      assert.match(refused.data.message, /balance does not cover/);
      // The message quotes what it would have cost, which is the number the
      // vendor needs in order to decide how much to recharge.
      assert.match(refused.data.message, new RegExp(`${(4 * wholesale).toFixed(2)}`));
      assert.equal(await balanceOf(techCorner), 5);
      assert.equal(await purchasesOf(techCorner), purchasesBefore);
    });

    await check("buying stock takes exactly its wholesale cost", async () => {
      const master = await masterByName("Demo Wireless Keyboard");
      const wholesale = Number(
        await scalar(
          "SELECT wholesale_price FROM master_products WHERE master_prod_id = :1",
          [master],
        ),
      );
      await setBalance(techCorner, 1000);
      const purchasesBefore = await purchasesOf(techCorner);

      const bought = await request("/api/vendor/listings", {
        user: vendor,
        method: "POST",
        body: {
          shop_id: techCorner,
          master_prod_id: master,
          quantity: 6,
          unit_price: "40.00",
          description: "",
        },
      });

      assert.equal(bought.status, 201, bought.data.message);
      assert.equal(await balanceOf(techCorner), 1000 - 6 * wholesale);
      assert.equal(Number(bought.data.balance), 1000 - 6 * wholesale);
      assert.equal(await purchasesOf(techCorner), purchasesBefore + 1);
      assert.match(bought.data.message, /taken from your shop balance/);
    });

    await check("a recharge credits the balance and says what it is", async () => {
      const before = await balanceOf(techCorner);
      const topped = await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: techCorner, amount: "250.00", method: "bank_transfer" },
      });

      assert.equal(topped.status, 201, topped.data.message);
      assert.equal(await balanceOf(techCorner), before + 250);
      // No gateway is involved and the message does not pretend otherwise.
      assert.match(topped.data.message, /No card was charged/);

      const zero = await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: techCorner, amount: "0.00", method: "card" },
      });
      assert.equal(zero.status, 400, zero.data.message);

      const wrongMethod = await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: techCorner, amount: "10.00", method: "cheque" },
      });
      assert.equal(wrongMethod.status, 400, wrongMethod.data.message);

      // Another vendor's shop is not reachable by naming it.
      const theirs = await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: gadgetHouse, amount: "10.00", method: "card" },
      });
      assert.equal(theirs.status, 404, theirs.data.message);
      assert.equal(await balanceOf(techCorner), before + 250);
    });

    await check("the balance page shows the movements behind the number", async () => {
      await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: techCorner, amount: "80.00", method: "cash" },
      });
      const returnId = await openReturn();
      await decide(returnId, "approve");

      const book = await request(`/api/vendor/balance?shop_id=${techCorner}`, {
        user: vendor,
      });
      assert.equal(book.status, 200, book.data.message);
      assert.equal(Number(book.data.balance), await balanceOf(techCorner));

      const kinds = new Set(book.data.movements.map((row) => row.kind));
      // The seeded history gives the sales and the purchase; the calls above give
      // the recharge and the return.
      for (const kind of ["sale", "purchase", "topup", "customer_return"]) {
        assert.ok(kinds.has(kind), `expected a ${kind} movement, got ${[...kinds]}`);
      }

      const recharge = book.data.movements.find((row) => row.kind === "topup");
      assert.equal(Number(recharge.amount), 80);
      const refund = book.data.movements.find(
        (row) => row.kind === "customer_return",
      );
      // Money out is negative, the same as a purchase, so the column can be
      // added up by eye and reaches the balance above it.
      assert.equal(Number(refund.amount), -Number(line.unit_price));

      // Another vendor's shop is not readable by naming it.
      const theirs = await request(`/api/vendor/balance?shop_id=${gadgetHouse}`, {
        user: vendor,
      });
      assert.equal(theirs.status, 404, theirs.data.message);
    });

    await check(
      "delivering pays the courier the trip and the shop the goods",
      async () => {
        const pending = await orderFor("customer2@shopsphere.test", "pending");
        const [item] = await itemsOf(pending);
        const itemShop = await shopOf(item.prod_id);
        const trip = Number(
          await scalar("SELECT delivery_cost FROM orders WHERE order_id = :1", [
            pending,
          ]),
        );
        assert.ok(trip > 0, "a seeded order should have its trip priced");

        await client.query(
          "UPDATE orders SET delivery_person_id = :2 WHERE order_id = :1",
          [pending, courier.user_id],
        );
        const courierBefore = await earningsOf(courier.user_id);
        const shopBefore = await balanceOf(itemShop);

        const shipped = await request(
          `/api/delivery/orders/${pending}/status`,
          { user: courier, method: "PUT", body: { order_status: "shipped" } },
        );
        assert.equal(shipped.status, 200, shipped.data.message);

        const delivered = await request(
          `/api/delivery/orders/${pending}/status`,
          { user: courier, method: "PUT", body: { order_status: "delivered" } },
        );
        assert.equal(delivered.status, 200, delivered.data.message);

        assert.equal(
          await earningsOf(courier.user_id),
          courierBefore + trip,
          "the courier is paid the charge the customer paid for the trip",
        );
        assert.equal(
          await balanceOf(itemShop),
          shopBefore + Number(item.unit_price) * item.quantity,
          "the shop is paid its line in full",
        );

        // The refund that was never asked for is not a refund.
        assert.equal((await refundsOf(itemShop)).length, 0);

        // Delivering twice is not possible, and would pay the courier twice.
        const again = await request(`/api/delivery/orders/${pending}/status`, {
          user: courier,
          method: "PUT",
          body: { order_status: "delivered" },
        });
        assert.equal(again.status, 409, again.data.message);
        assert.equal(await earningsOf(courier.user_id), courierBefore + trip);
      },
    );

    await check(
      "the customer's payment is the goods plus the trip, and nothing is withheld",
      async () => {
        // Over the whole seeded database: every payment is its order's goods plus
        // its order's trip charge.
        assert.equal(
          await scalar(`
            SELECT COUNT(*) FROM payments pay
            JOIN orders o ON o.order_id = pay.order_id
            WHERE pay.amount <> o.total_amount + o.delivery_cost
          `),
          0,
          "a payment must be the goods plus the delivery charge",
        );

        // And the trip charge is what the courier was paid: no cut sits between
        // the two, so a courier's earnings are the sum of the charges on the
        // orders they delivered.
        assert.equal(
          await scalar(`
            SELECT COUNT(*) FROM (
              SELECT d.delivery_person_id
              FROM delivery_personnel d
              LEFT JOIN orders o ON o.delivery_person_id = d.delivery_person_id
                                AND o.order_status = 'delivered'
              GROUP BY d.delivery_person_id, d.earnings
              HAVING d.earnings <> COALESCE(SUM(o.delivery_cost), 0)
            ) mismatched
          `),
          0,
          "courier earnings must equal the delivery charges on their orders",
        );

        // A delivered order's goods reach the shops in full, so a shop's balance
        // is its sales plus its capital less what it spent and refunded.
        assert.equal(await identityBreaks(), 0, "the balance must equal its sources");
      },
    );

    await check(
      "a recharge, a purchase, a return and a delivery all leave it exact",
      async () => {
        const master = await masterByName("Demo Wireless Keyboard");
        assert.equal(await identityBreaks(), 0, "the seed must already balance");

        // The check is not vacuous: falsifying one balance by a cent is detected,
        // and the count is the number of shops that no longer agree with their
        // sources — so it is one shop, not every shop, that has to be moved.
        await client.query(
          "UPDATE shops SET balance = balance + 0.01 WHERE shop_id = :1",
          [lineShop],
        );
        assert.equal(await identityBreaks(), 1);
        await client.query(
          "UPDATE shops SET balance = balance - 0.01 WHERE shop_id = :1",
          [lineShop],
        );
        assert.equal(await identityBreaks(), 0);

        await request("/api/vendor/topups", {
          user: vendor,
          method: "POST",
          body: { shop_id: lineShop, amount: "120.00", method: "card" },
        });
        assert.equal(await identityBreaks(), 0, "after a recharge");

        const bought = await request("/api/vendor/listings", {
          user: vendor,
          method: "POST",
          body: {
            shop_id: lineShop,
            master_prod_id: master,
            quantity: 2,
            unit_price: "60.00",
            description: "",
          },
        });
        assert.ok(
          [200, 201].includes(bought.status),
          `expected the purchase to succeed, got ${bought.status}: ${bought.data.message}`,
        );
        assert.equal(await identityBreaks(), 0, "after a purchase");

        const returnId = await openReturn();
        await decide(returnId, "approve");
        assert.equal(await identityBreaks(), 0, "after an approved return");

        await collect(returnId);
        await restock(returnId);
        assert.equal(
          await identityBreaks(),
          0,
          "restocking moves goods, not money, so the identity is unmoved",
        );

        // And a delivery: the trip leaves the customer's payment and lands in the
        // courier's earnings, while the goods land in the shop's balance.
        const pending = await orderFor("customer2@shopsphere.test", "pending");
        await client.query(
          "UPDATE orders SET delivery_person_id = :2 WHERE order_id = :1",
          [pending, courier.user_id],
        );
        for (const status of ["shipped", "delivered"]) {
          const moved = await request(`/api/delivery/orders/${pending}/status`, {
            user: courier,
            method: "PUT",
            body: { order_status: status },
          });
          assert.equal(moved.status, 200, moved.data.message);
        }
        assert.equal(await identityBreaks(), 0, "after a delivery");
      },
    );

    await check("the statistics agree with the balance they explain", async () => {
      const rechargedBefore = Number(
        await scalar(
          `SELECT COALESCE(SUM(t.amount), 0)
           FROM shop_topups t JOIN shops s ON s.shop_id = t.shop_id
           WHERE s.owner = :1`,
          [vendor.user_id],
        ),
      );
      const returnId = await openReturn();
      await decide(returnId, "approve");
      await request("/api/vendor/topups", {
        user: vendor,
        method: "POST",
        body: { shop_id: lineShop, amount: "75.00", method: "card" },
      });

      const stats = await request("/api/vendor/statistics?group_by=month", {
        user: vendor,
      });
      assert.equal(stats.status, 200, stats.data.message);
      assert.equal(stats.data.group_by, "month");

      const totals = stats.data.totals;
      // The same arithmetic the balance page shows, from the same tables.
      assert.equal(
        Number(totals.balance_total),
        await scalar("SELECT SUM(balance) FROM shops WHERE owner = :1", [
          vendor.user_id,
        ]).then(Number),
      );
      assert.equal(Number(totals.refunded_to_customers), Number(line.unit_price));
      assert.equal(Number(totals.recharged), rechargedBefore + 75);
      assert.ok(Number(totals.delivered_revenue) > 0);
      assert.ok(Number(totals.units_sold) > 0);

      // One bucket per period, and the refund lands in the bucket it was paid in.
      assert.ok(stats.data.series.length > 0);
      const refunded = stats.data.series.reduce(
        (sum, row) => sum + Number(row.refunds),
        0,
      );
      assert.equal(refunded, Number(line.unit_price));

      const top = stats.data.top_listings;
      assert.ok(top.length > 0);
      // The leaderboard is capped at ten, so it only has to add up when the
      // vendor has ten or fewer earning listings — which the demo seed gives.
      assert.ok(top.length <= 10);
      if (top.length < 10)
        assert.equal(
          top.reduce((sum, row) => sum + Number(row.revenue), 0).toFixed(2),
          Number(totals.delivered_revenue).toFixed(2),
          "an untruncated leaderboard must add up to the revenue it shares out",
        );

      const daily = await request("/api/vendor/statistics?group_by=day", {
        user: vendor,
      });
      assert.equal(daily.data.group_by, "day");
      // A day is a finer bucket than a month, so there is never less of them.
      assert.ok(daily.data.series.length >= stats.data.series.length);

      const nonsense = await request("/api/vendor/statistics?group_by=century", {
        user: vendor,
      });
      assert.equal(nonsense.status, 400, nonsense.data.message);

      const asCustomer = await request("/api/vendor/statistics", {
        user: customer,
      });
      assert.equal(asCustomer.status, 403, asCustomer.data.message);
    });

    await check("returns are closed to administrators", async () => {
      const returnId = await openReturn();
      assert.equal((await decide(returnId, "approve", admin)).status, 403);
      assert.equal((await collect(returnId, admin)).status, 403);
      assert.equal((await restock(returnId, admin)).status, 403);
      assert.equal((await request("/api/returns", { user: admin })).status, 403);
      assert.equal((await request("/api/vendor/returns", { user: admin })).status, 403);
    });
  } finally {
    pool.query = originalQuery;
    pool.connect = originalConnect;
    if (server) await new Promise((resolve) => server.close(resolve));
    if (client) {
      await scratch.drop(client, namespace);
      await client.close();
    }
    await pool.end();
  }
});
