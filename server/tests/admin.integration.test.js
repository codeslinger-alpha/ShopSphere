const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const { createAuthToken } = require("../src/utils/authToken");

// The administrator's side of the platform: who may be banned, which shops go
// live, and above all that a vendor cannot do either to themselves. Every check
// runs inside a savepoint that is rolled back, so each one sees the same seeded
// starting point.
test("admin moderation and shop approval against PostgreSQL", async (t) => {
  pool.options.connectionTimeoutMillis = 10000;
  let client;
  let server;
  const originalQuery = pool.query;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const namespace = `shopsphere_admin_check_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(await fs.readFile("sql/schema.sql", "utf8"));
    await client.query(
      await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"),
    );
    // All API reads/writes in this test use this isolated transaction.
    pool.query = (...args) => client.query(...args);
    // Nested API transactions need real rollback semantics within the test schema.
    let transactionId = 0;
    pool.connect = async () => {
      const savepoint = `admin_tx_${++transactionId}`;
      return {
        query: async (text, values) => {
          if (text === "BEGIN") return client.query(`SAVEPOINT ${savepoint}`);
          if (text === "COMMIT") return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          if (text === "ROLLBACK") {
            await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            return client.query(`RELEASE SAVEPOINT ${savepoint}`);
          }
          return client.query(text, values);
        },
        release: () => {},
      };
    };
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const origin = `http://127.0.0.1:${server.address().port}`;

    const accounts = (
      await client.query("SELECT * FROM users ORDER BY user_id")
    ).rows;
    const account = (email) =>
      accounts.find((user) => user.email === email);
    const admin = account("admin@shopsphere.test");
    const vendor = account("vendor@shopsphere.test");
    const customer = account("customer@shopsphere.test");
    const courier = account("delivery@shopsphere.test");
    const countryId = (
      await client.query(
        "SELECT country_id FROM countries ORDER BY country_id LIMIT 1",
      )
    ).rows[0].country_id;
    const techCorner = (
      await client.query("SELECT * FROM shops WHERE name = 'Demo Tech Corner'")
    ).rows[0];
    const masterId = (
      await client.query(
        "SELECT master_prod_id FROM master_products WHERE active_status = 'available' ORDER BY master_prod_id LIMIT 1",
      )
    ).rows[0].master_prod_id;

    async function request(
      path,
      { user = admin, method = "GET", body } = {},
    ) {
      const headers = { "Content-Type": "application/json" };
      // A null user means "no session at all", which is how the signed-out
      // checks are spelled.
      if (user) headers.Cookie = `shopsphere_token=${createAuthToken(user)}`;
      const response = await fetch(origin + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return {
        status: response.status,
        headers: response.headers,
        data: response.status === 204 ? null : await response.json(),
      };
    }

    // A shop body the vendor path accepts. active_status is deliberately absent:
    // the server must not read it from here.
    function shopBody(overrides = {}) {
      return {
        name: "Pending Corner",
        description: "A shop submitted for approval.",
        phone_numbers: "01000000009",
        logo: "",
        cover_photo: "",
        street_address: "9 Approval Road",
        city: "Dhaka",
        postal_code: "1209",
        state_province: "Dhaka",
        country_id: countryId,
        ...overrides,
      };
    }

    const shopRow = async (shopId) =>
      (await client.query("SELECT * FROM shops WHERE shop_id = $1", [shopId]))
        .rows[0];
    const userRow = async (userId) =>
      (await client.query("SELECT * FROM users WHERE user_id = $1", [userId]))
        .rows[0];
    const shopListings = async (shopId) =>
      (
        await client.query("SELECT * FROM products WHERE shop_id = $1", [
          shopId,
        ])
      ).rows;
    // What a shopper actually sees, which is the only measure that matters for
    // "is this listing on sale".
    const storefrontTotal = async () =>
      (await request("/api/products?limit=1", { user: null })).data.total;
    const submitShop = async () => {
      const created = await request("/api/vendor/shops", {
        user: vendor,
        method: "POST",
        body: shopBody(),
      });
      assert.equal(created.status, 201, created.data.message);
      return created.data.shop;
    };
    const setShopStatus = (shopId, active_status) =>
      request(`/api/admin/shops/${shopId}/status`, {
        method: "PUT",
        body: { active_status },
      });
    const setUserStatus = (userId, active_status, user = admin) =>
      request(`/api/admin/users/${userId}/status`, {
        user,
        method: "PUT",
        body: { active_status },
      });

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

    await check("registration is atomic and admin creation preserves its session", async () => {
      const body = {
        name: "Regression Courier", email: "regression@shopsphere.test",
        password: "regression-password", phone: "01000000099", role: "delivery",
        street_address: "1 Test Street", city: "Dhaka", country_id: countryId,
        vehicle_info: "Bicycle",
      };
      const register = (path, data = body) => request(path, { method: "POST", body: data });
      const created = await register("/api/auth/register");
      assert.equal(created.status, 201, created.data.message);
      assert.match(created.headers.get("set-cookie"), /shopsphere_token=.*HttpOnly/);
      assert.equal((await client.query("SELECT vehicle_info FROM delivery_personnel WHERE delivery_person_id=$1", [created.data.user.user_id])).rows[0].vehicle_info, "Bicycle");
      const locationCount = async () => (await client.query("SELECT count(*)::int AS n FROM locations")).rows[0].n;
      const before = await locationCount();
      assert.equal((await register("/api/auth/register")).status, 409);
      assert.equal(await locationCount(), before, "duplicate registration must roll back its address");
      const login = await request("/api/auth/login", { method: "POST", body });
      assert.equal(login.status, 200);
      assert.match(login.headers.get("set-cookie"), /shopsphere_token=/);
      const adminCreated = await register("/api/admin/users", { ...body, role: "admin", email: "new-admin@shopsphere.test" });
      assert.equal(adminCreated.status, 201, adminCreated.data.message);
      assert.equal(adminCreated.headers.get("set-cookie"), null);
      assert.equal((await register("/api/auth/register", { ...body, role: "admin" })).status, 400);
    });

    await check(
      "a submitted shop waits as pending and cannot be sold from",
      async () => {
        const shop = await submitShop();
        assert.equal(shop.active_status, "pending");

        // Shoppers must not see it: the public list only carries active shops.
        const publicShops = await request("/api/shops", { user: null });
        assert.equal(
          publicShops.data.some((entry) => entry.shop_id === shop.shop_id),
          false,
        );

        // And the vendor cannot stock it, so a pending shop cannot reach the
        // storefront through the purchase path either.
        const purchase = await request("/api/vendor/listings", {
          user: vendor,
          method: "POST",
          body: {
            shop_id: shop.shop_id,
            master_prod_id: masterId,
            quantity: 1,
            unit_price: "10.00",
            description: "Should not be listed.",
          },
        });
        assert.equal(purchase.status, 404);
        assert.equal((await shopListings(shop.shop_id)).length, 0);
      },
    );

    await check(
      "a vendor cannot activate a shop an administrator disabled",
      async () => {
        assert.equal(
          (await setShopStatus(techCorner.shop_id, "disabled")).status,
          200,
        );
        assert.equal(
          (await shopRow(techCorner.shop_id)).active_status,
          "disabled",
        );

        // The regression guard for the hole this work closed: the vendor used to
        // read active_status straight out of the body and could undo their own
        // ban with a routine shop save.
        const saved = await request(`/api/vendor/shops/${techCorner.shop_id}`, {
          user: vendor,
          method: "PUT",
          body: shopBody({
            name: "Demo Tech Corner",
            active_status: "active",
          }),
        });
        assert.equal(saved.status, 200);
        assert.equal(
          (await shopRow(techCorner.shop_id)).active_status,
          "disabled",
        );

        // The rest of the shop edits still land, so the vendor is not locked out
        // of correcting a rejected submission.
        assert.equal(saved.data.shop.name, "Demo Tech Corner");
      },
    );

    await check(
      "an approved shop reaches the storefront, and a ban takes it back",
      async () => {
        const before = await storefrontTotal();
        const shop = await submitShop();

        const approved = await setShopStatus(shop.shop_id, "active");
        assert.equal(approved.status, 200);
        assert.equal(approved.data.shop.active_status, "active");

        const purchase = await request("/api/vendor/listings", {
          user: vendor,
          method: "POST",
          body: {
            shop_id: shop.shop_id,
            master_prod_id: masterId,
            quantity: 3,
            unit_price: "19.50",
            description: "Now on sale.",
          },
        });
        assert.equal(purchase.status, 201);
        assert.equal(await storefrontTotal(), before + 1);

        // Disabling the shop discontinues its listings, which is what the
        // console warns about before the click.
        assert.equal(
          (await setShopStatus(shop.shop_id, "disabled")).status,
          200,
        );
        assert.equal(await storefrontTotal(), before);
        const listing = (
          await client.query("SELECT * FROM products WHERE prod_id = $1", [
            purchase.data.listing.prod_id,
          ])
        ).rows[0];
        assert.equal(listing.discontinued, true);

        // Restoring the shop does not resurrect them: the vendor has to relist
        // on purpose. The console promises exactly this in its message.
        assert.equal((await setShopStatus(shop.shop_id, "active")).status, 200);
        assert.equal(await storefrontTotal(), before);
      },
    );

    await check(
      "the pending queue holds submissions until they are decided",
      async () => {
        const shop = await submitShop();

        const queue = await request("/api/admin/shops?status=pending");
        assert.equal(queue.status, 200);
        assert.ok(
          queue.data.items.some((entry) => entry.shop_id === shop.shop_id),
        );
        // Every row in a filtered queue carries the filter's status.
        assert.ok(
          queue.data.items.every((entry) => entry.active_status === "pending"),
        );

        // Rejecting is the same endpoint with the other status.
        assert.equal(
          (await setShopStatus(shop.shop_id, "disabled")).status,
          200,
        );
        const after = await request("/api/admin/shops?status=pending");
        assert.equal(
          after.data.items.some((entry) => entry.shop_id === shop.shop_id),
          false,
        );
      },
    );

    await check(
      "un-banning a user restores their shops but not their listings",
      async () => {
        const before = await storefrontTotal();

        assert.equal(
          (await setUserStatus(vendor.user_id, "disabled")).status,
          200,
        );
        // The ban cascades down to the shops and on to their listings.
        assert.equal(
          (await shopRow(techCorner.shop_id)).active_status,
          "disabled",
        );
        const banned = await storefrontTotal();
        assert.ok(banned < before, "the ban must remove listings from sale");

        // The vendor's existing session is dead, not just their privileges.
        assert.equal(
          (await request("/api/vendor/shops", { user: vendor })).status,
          401,
        );

        assert.equal((await setUserStatus(vendor.user_id, "active")).status, 200);
        assert.equal(
          (await shopRow(techCorner.shop_id)).active_status,
          "active",
        );
        // The shop is sellable again but carries nothing: the vendor consciously
        // relists rather than having a retired product reappear on their behalf.
        assert.equal(await storefrontTotal(), banned);
        const listings = await shopListings(techCorner.shop_id);
        assert.equal(listings.length > 0, true);
        assert.ok(listings.every((listing) => listing.discontinued));
      },
    );

    await check(
      "an administrator cannot disable their own account",
      async () => {
        const result = await setUserStatus(admin.user_id, "disabled");
        assert.equal(result.status, 409);
        assert.equal((await userRow(admin.user_id)).active_status, "active");
      },
    );

    await check(
      "the admin surface is closed to every other role and to guests",
      async () => {
        const paths = [
          ["GET", "/api/admin/users"],
          ["GET", "/api/admin/shops"],
          ["GET", "/api/admin/catalog-metadata"],
          ["PUT", `/api/admin/users/${customer.user_id}/status`],
          ["PUT", `/api/admin/shops/${techCorner.shop_id}/status`],
          ["POST", "/api/admin/master-products"],
        ];
        for (const [method, path] of paths) {
          assert.equal(
            (await request(path, { user: null, method })).status,
            401,
            `${method} ${path} must reject a guest`,
          );
          for (const user of [customer, vendor, courier]) {
            assert.equal(
              (await request(path, { user, method })).status,
              403,
              `${method} ${path} must reject a ${user.role_name}`,
            );
          }
        }
      },
    );

    await check(
      "list filters are validated rather than silently ignored",
      async () => {
        // "pending" is a shop status but not an account one; a typo must not
        // read as an empty page.
        assert.equal(
          (await request("/api/admin/users?status=pending")).status,
          400,
        );
        assert.equal(
          (await request("/api/admin/shops?status=closed")).status,
          400,
        );
        assert.equal((await request("/api/admin/users?page=0")).status, 400);
        assert.equal((await request("/api/admin/shops?limit=0")).status, 400);
      },
    );

    await check(
      "the account list filters, pages and searches literally",
      async () => {
        const vendors = await request("/api/admin/users?role=vendor");
        assert.equal(vendors.status, 200);
        assert.equal(vendors.data.total, 2);
        assert.ok(
          vendors.data.items.every((entry) => entry.role_name === "vendor"),
        );

        const paged = await request("/api/admin/users?limit=2&page=2");
        assert.equal(paged.data.items.length, 2);
        assert.equal(paged.data.page, 2);
        assert.equal(paged.data.limit, 2);
        assert.equal(paged.data.total_pages, Math.ceil(paged.data.total / 2));

        const found = await request("/api/admin/users?q=customer2");
        assert.equal(found.data.total, 1);
        assert.equal(found.data.items[0].email, "customer2@shopsphere.test");

        // Metacharacters are matched literally, not as wildcards — the escaping
        // moved into utils/sql.js and this is what keeps the move honest.
        const wildcard = await request("/api/admin/users?q=%25");
        assert.equal(wildcard.data.total, 0);
      },
    );

    await check(
      "the shop list reports what a ban would discontinue",
      async () => {
        const shops = await request("/api/admin/shops?q=Demo%20Tech%20Corner");
        assert.equal(shops.data.total, 1);
        const shop = shops.data.items[0];
        assert.equal(shop.owner_email, "vendor@shopsphere.test");
        assert.equal(shop.city, "Dhaka");
        // The console reads these counts to say how much is about to go off sale.
        assert.equal(shop.listing_count, 4);
        assert.equal(shop.active_listing_count, 4);

        const byOwner = await request("/api/admin/shops?q=vendor2");
        assert.equal(byOwner.data.total, 1);
        assert.equal(byOwner.data.items[0].name, "Demo Gadget House");
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
