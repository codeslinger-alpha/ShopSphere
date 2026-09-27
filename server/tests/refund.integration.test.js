const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const scratch = require("./scratch-schema");
const q = require("../src/db/queries/adminCatalogQueries");
const { createAuthToken } = require("../src/utils/authToken");

// Removing a listing and paying the vendor back for the stock they still hold.
//
// The thing being proven is the LIFO attribution: a listing's in_stock says how
// many units are on the shelf but not which purchase rows they came from, and
// the refund has to answer that. It is tested directly against
// REFUND_ATTRIBUTION as well as through the endpoint, because a test that only
// reads the HTTP response would pass just as happily against a rule that charged
// every unit at the newest price.
//
// Every check runs in a savepoint that is rolled back, so each one sees the same
// seeded starting point even though the checks move stock and money around.
test("vendor refunds on admin removal against Oracle", async (t) => {
  let client;
  let server;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  let namespace;
  try {
    client = await pool.connect();
    namespace = await scratch.create(client, "SHOPSPHERE_REFUND");
    await scratch.load(client);
    // transaction() calls pool.connect(), which would hand back a different
    // pooled connection — outside this schema and outside this transaction, so a
    // refund would be credited to the real database. funnel() routes it back
    // here, turning a commit or a rollback into the savepoint calls that keep
    // the nesting's real semantics while the outer transaction still discards
    // everything at the end.
    scratch.funnel(pool, client);
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;

    const accounts = (await client.query("SELECT * FROM users ORDER BY user_id"))
      .rows;
    const account = (email) => accounts.find((user) => user.email === email);
    const admin = account("admin@shopsphere.test");
    const vendor = account("vendor@shopsphere.test");
    const customer = account("customer@shopsphere.test");

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
      (await client.query("SELECT shop_id FROM shops WHERE name = :1", [name]))
        .rows[0].shop_id;
    const masterId = async (name) =>
      (
        await client.query(
          "SELECT master_prod_id FROM master_products WHERE name = :1 AND manufacturer = 'ShopSphere Demo'",
          [name],
        )
      ).rows[0].master_prod_id;
    const listingId = async (shop, master) =>
      (
        await client.query(
          `SELECT p.prod_id FROM products p
           JOIN shops s ON s.shop_id = p.shop_id
           JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
           WHERE s.name = :1 AND mp.name = :2`,
          [shop, master],
        )
      ).rows[0].prod_id;

    const techCorner = await shopId("Demo Tech Corner");
    const gadgetHouse = await shopId("Demo Gadget House");
    const keyboardMaster = await masterId("Demo Wireless Keyboard");
    const lampMaster = await masterId("Demo Desk Lamp");

    const setStock = (prodId, quantity) =>
      client.query("UPDATE products SET in_stock = :2 WHERE prod_id = :1", [
        prodId,
        quantity,
      ]);
    const stockOf = async (prodId) =>
      (await client.query("SELECT in_stock FROM products WHERE prod_id = :1", [
        prodId,
      ])).rows[0].in_stock;
    const discontinuedOf = async (prodId) =>
      (
        await client.query("SELECT discontinued FROM products WHERE prod_id = :1", [
          prodId,
        ])
      ).rows[0].discontinued;
    const balanceOf = async (id) =>
      Number(
        (await client.query("SELECT balance FROM shops WHERE shop_id = :1", [id]))
          .rows[0].balance ?? 0,
      );
    const refundsOf = async (prodId) =>
      (
        await client.query(
          "SELECT * FROM vendor_refunds WHERE prod_id = :1 ORDER BY refund_id",
          [prodId],
        )
      ).rows;
    const attribution = async (...prodIds) =>
      (await client.query(q.REFUND_ATTRIBUTION, [prodIds])).rows;

    // The seed gives every demo listing one purchase row covering its stock, so
    // the cases below that need a different purchase history start by clearing
    // it rather than by trying to work around it.
    const clearPurchases = (shop, master) =>
      client.query(
        "DELETE FROM shop_purchases WHERE shop_id = :1 AND master_prod_id = :2",
        [shop, master],
      );
    const addPurchase = (shop, master, quantity, price, purchasedAt) =>
      client.query(
        `INSERT INTO shop_purchases
           (shop_id, master_prod_id, quantity, wholesale_unit_price, purchased_at)
         VALUES (:1, :2, :3, :4, :5)`,
        [shop, master, quantity, price, new Date(purchasedAt)],
      );

    const removeListing = (prodId, user = admin) =>
      request(`/api/admin/listings/${prodId}/discontinue`, {
        user,
        method: "PUT",
      });
    const removeMaster = (id, user = admin) =>
      request(`/api/admin/master-products/${id}`, { user, method: "DELETE" });

    async function check(name, run) {
      await t.test(name, async () => {
        await client.query("SAVEPOINT refund_case");
        try {
          await run();
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT refund_case");
        }
      });
    }

    await check(
      "remaining stock is charged to the newest purchases first",
      async () => {
        const listing = await listingId("Demo Tech Corner", "Demo Wireless Keyboard");
        await clearPurchases(techCorner, keyboardMaster);
        // Oldest first in the table; LIFO reads them the other way round.
        await addPurchase(techCorner, keyboardMaster, 5, 4, "2026-01-01T00:00:00Z");
        await addPurchase(techCorner, keyboardMaster, 5, 9, "2026-06-01T00:00:00Z");
        await setStock(listing, 7);

        // The rule itself, before any endpoint is involved: 5 units at the newer
        // price of 9, then 2 at the older price of 4.
        const [attributed] = await attribution(listing);
        assert.equal(attributed.units, 7);
        assert.equal(attributed.purchased_units, 7);
        assert.equal(attributed.fallback_units, 0);
        assert.equal(Number(attributed.purchased_amount), 53);

        const before = await balanceOf(techCorner);
        const removed = await removeListing(listing);

        assert.equal(removed.status, 200, removed.data.message);
        assert.equal(removed.data.refund.units, 7);
        assert.equal(Number(removed.data.refund.amount), 53);
        // amount / units, so a ledger row can be read without the purchase rows.
        assert.equal(Number(removed.data.refund.unit_amount), 7.57);
        assert.equal(removed.data.refund.reason, "admin_removal");
        assert.equal(removed.data.refund.removed_by, admin.user_id);
        assert.match(removed.data.message, /\$53\.00/);

        assert.equal(await balanceOf(techCorner), before + 53);
        assert.equal(await discontinuedOf(listing), true);
        // Paid for, so it stops being inventory.
        assert.equal(await stockOf(listing), 0);
      },
    );

    await check(
      "a listing with no purchase history falls back to the master price",
      async () => {
        const listing = await listingId(
          "Demo Tech Corner",
          "Demo Bluetooth Headphones",
        );
        await clearPurchases(techCorner, await masterId("Demo Bluetooth Headphones"));
        await setStock(listing, 4);

        const [attributed] = await attribution(listing);
        assert.equal(attributed.purchased_units, 0);
        assert.equal(attributed.purchased_amount, "0.00");
        assert.equal(attributed.fallback_units, 4);
        // Demo Bluetooth Headphones wholesales at 40.00.
        assert.equal(Number(attributed.fallback_unit_amount), 40);
        assert.equal(Number(attributed.amount), 160);

        const before = await balanceOf(techCorner);
        const removed = await removeListing(listing);
        assert.equal(removed.status, 200, removed.data.message);
        assert.equal(Number(removed.data.refund.amount), 160);
        assert.equal(removed.data.refund.units, 4);
        assert.equal(await balanceOf(techCorner), before + 160);
      },
    );

    await check(
      "purchases refilled after a removal are not paid for twice",
      async () => {
        const listing = await listingId("Demo Tech Corner", "Demo Wireless Keyboard");
        await clearPurchases(techCorner, keyboardMaster);
        await addPurchase(techCorner, keyboardMaster, 6, 8, "2026-01-01T00:00:00Z");
        await setStock(listing, 4);

        const before = await balanceOf(techCorner);
        assert.equal(
          Number((await removeListing(listing)).data.refund.amount),
          32,
          "4 units at the only, newest price",
        );
        assert.equal(await balanceOf(techCorner), before + 32);

        // The vendor buys again. RESTOCK_LISTING adds to in_stock and clears the
        // discontinued flag, so without zeroing the paid-out stock this would
        // leave 4 already-refunded units on the shelf to be refunded a second
        // time.
        await setStock(listing, 6);
        await client.query("UPDATE products SET discontinued = 0 WHERE prod_id = :1", [
          listing,
        ]);
        await addPurchase(techCorner, keyboardMaster, 6, 8, "2026-07-01T00:00:00Z");

        const second = await removeListing(listing);
        assert.equal(second.status, 200, second.data.message);
        assert.equal(second.data.refund.units, 6);
        assert.equal(Number(second.data.refund.amount), 48);

        // 32 + 48 is 10 units at 8.00: exactly what the vendor paid for the 10
        // units refunded across the two removals, and no more.
        assert.equal(await balanceOf(techCorner), before + 32 + 48);
        assert.equal((await refundsOf(listing)).length, 2);
      },
    );

    await check(
      "an out-of-stock listing is removed, refunds nothing, and is not an error",
      async () => {
        // The seeded lamp at Gadget House is deliberately out of stock.
        const listing = await listingId("Demo Gadget House", "Demo Desk Lamp");
        await setStock(listing, 0);
        const before = await balanceOf(gadgetHouse);

        const removed = await removeListing(listing);
        assert.equal(removed.status, 200, removed.data.message);
        assert.equal(removed.data.refund.units, 0);
        assert.equal(Number(removed.data.refund.amount), 0);
        // The price of no units is not a number, so it is null rather than 0.
        assert.equal(removed.data.refund.unit_amount, null);
        assert.match(removed.data.message, /nothing to refund/);

        assert.equal(await balanceOf(gadgetHouse), before);
        assert.equal(await discontinuedOf(listing), true);
        assert.equal((await refundsOf(listing)).length, 1);
      },
    );

    await check(
      "removing the same listing twice is refused, and pays once",
      async () => {
        const listing = await listingId("Demo Tech Corner", "Demo Fitness Watch");
        await setStock(listing, 3);
        const before = await balanceOf(techCorner);

        const first = await removeListing(listing);
        assert.equal(first.status, 200, first.data.message);
        const paid = Number(first.data.refund.amount);
        assert.ok(paid > 0, "the first removal should have paid something");
        assert.equal(await balanceOf(techCorner), before + paid);

        const second = await removeListing(listing);
        assert.equal(second.status, 409, second.data.message);
        assert.match(second.data.message, /already been removed/);
        // The money is the assertion that matters: a 409 that still credited
        // would look identical from the status code alone.
        assert.equal(await balanceOf(techCorner), before + paid);
        assert.equal((await refundsOf(listing)).length, 1);
      },
    );

    await check("removing an unknown listing is a 404", async () => {
      const missing = await removeListing(2147483647);
      assert.equal(missing.status, 404, missing.data.message);
    });

    await check(
      "removing a master refunds every shop holding it, in one transaction",
      async () => {
        const tech = await listingId("Demo Tech Corner", "Demo Wireless Keyboard");
        const gadget = await listingId("Demo Gadget House", "Demo Wireless Keyboard");
        await setStock(tech, 20);
        await setStock(gadget, 18);
        const techBefore = await balanceOf(techCorner);
        const gadgetBefore = await balanceOf(gadgetHouse);

        const removed = await removeMaster(keyboardMaster);
        assert.equal(removed.status, 200, removed.data.message);
        assert.equal(removed.data.refunds.length, 2);
        // Both shops' stock is attributed at the master's 25.00 wholesale price,
        // which is what the seed recorded they paid.
        assert.equal(Number(removed.data.total), 20 * 25 + 18 * 25);
        assert.match(removed.data.message, /\$950\.00/);
        assert.match(removed.data.message, /2 listings/);

        assert.equal(await balanceOf(techCorner), techBefore + 500);
        assert.equal(await balanceOf(gadgetHouse), gadgetBefore + 450);
        assert.equal(await stockOf(tech), 0);
        assert.equal(await stockOf(gadget), 0);
        assert.equal(await discontinuedOf(tech), true);
        assert.equal(await discontinuedOf(gadget), true);
        const master = (
          await client.query(
            "SELECT active_status FROM master_products WHERE master_prod_id = :1",
            [keyboardMaster],
          )
        ).rows[0];
        assert.equal(master.active_status, "discontinued");

        // Idempotent by construction: there is no stock left to attribute, so a
        // second removal pays nothing rather than paying again.
        const techAfter = await balanceOf(techCorner);
        const again = await removeMaster(keyboardMaster);
        assert.equal(again.status, 200, again.data.message);
        assert.equal(again.data.refunds.length, 0);
        assert.match(again.data.message, /nothing to refund/);
        assert.equal(await balanceOf(techCorner), techAfter);
      },
    );

    await check(
      "a listing the vendor retired is refunded when its master goes",
      async () => {
        // The vendor discontinuing their own listing gets no refund: that was
        // their decision and they keep the stock. But once the master is gone
        // the stock is unsellable, so the master removal pays for it — the
        // discontinued flag is not the test, in_stock is.
        const listing = await listingId("Demo Tech Corner", "Demo Desk Lamp");
        await setStock(listing, 15);
        await client.query("UPDATE products SET discontinued = 1 WHERE prod_id = :1", [
          listing,
        ]);
        const before = await balanceOf(techCorner);

        const removed = await removeMaster(lampMaster);
        assert.equal(removed.status, 200, removed.data.message);
        const refund = removed.data.refunds.find((row) => row.prod_id === listing);
        assert.ok(refund, "the retired listing should have been refunded");
        // Demo Desk Lamp wholesales at 12.00.
        assert.equal(refund.units, 15);
        assert.equal(Number(refund.amount), 180);
        assert.equal(await balanceOf(techCorner), before + 180);
      },
    );

    await check("removal is closed to everyone but an administrator", async () => {
      const listing = await listingId("Demo Tech Corner", "Demo Wireless Keyboard");
      const before = await balanceOf(techCorner);

      const asVendor = await removeListing(listing, vendor);
      assert.equal(asVendor.status, 403, asVendor.data.message);
      const asCustomer = await removeListing(listing, customer);
      assert.equal(asCustomer.status, 403, asCustomer.data.message);
      const asGuest = await removeListing(listing, null);
      assert.equal(asGuest.status, 401, asGuest.data.message);

      assert.equal(await removeMaster(keyboardMaster, vendor).then((r) => r.status), 403);
      assert.equal(await balanceOf(techCorner), before);
      assert.equal(await discontinuedOf(listing), false);
      assert.equal((await refundsOf(listing)).length, 0);
    });

    await check(
      "the console previews what a removal would pay, per listing",
      async () => {
        const listed = await request(
          `/api/admin/shops/${techCorner}/listings`,
        );
        assert.equal(listed.status, 200, listed.data.message);
        const keyboard = listed.data.find(
          (row) => row.master_name === "Demo Wireless Keyboard",
        );
        // The preview is the same query the payment uses, so it must agree with
        // the seeded purchase row: 20 units at the master's 25.00.
        assert.equal(keyboard.refund.units, 20);
        assert.equal(Number(keyboard.refund.amount), 500);
        assert.equal(keyboard.discontinued, false);
        assert.ok(listed.data.every((row) => row.refund));

        // Another vendor's shop is not reachable from the vendor's own session,
        // because this route asks for the administrator role and takes the shop
        // id from the path rather than from the caller.
        assert.equal(
          (await request(`/api/admin/shops/${techCorner}/listings`, { user: vendor }))
            .status,
          403,
        );
      },
    );
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
