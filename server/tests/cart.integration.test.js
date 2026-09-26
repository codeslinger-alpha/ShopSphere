const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const { createAuthToken } = require("../src/utils/authToken");

test("cart, catalog and session regressions against PostgreSQL", async (t) => {
  pool.options.connectionTimeoutMillis = 10000;
  let client;
  let server;
  const originalQuery = pool.query;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    const namespace = `shopsphere_cart_check_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    await client.query(await fs.readFile("sql/schema.sql", "utf8"));
    await client.query(
      await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"),
    );
    // All API reads/writes in this test use this isolated transaction.
    pool.query = (...args) => client.query(...args);
    let transactionId = 0;
    pool.connect = async () => {
      const savepoint = `cart_tx_${++transactionId}`;
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
    const customer = accounts.find(
      (user) => user.email === "customer@shopsphere.test",
    );
    const customer2 = accounts.find(
      (user) => user.email === "customer2@shopsphere.test",
    );
    const vendor = accounts.find(
      (user) => user.email === "vendor@shopsphere.test",
    );
    const product = (
      await client.query(
        "SELECT p.* FROM cart_items c JOIN products p ON p.prod_id = c.prod_id WHERE c.user_id = $1 ORDER BY p.prod_id LIMIT 1",
        [customer.user_id],
      )
    ).rows[0];
    const cartPath = `/api/cart/${product.prod_id}`;

    async function request(
      path,
      { user = customer, method = "GET", body, rawBody } = {},
    ) {
      const headers = { "Content-Type": "application/json" };
      if (user) headers.Cookie = `shopsphere_token=${createAuthToken(user)}`;
      const response = await fetch(origin + path, {
        method,
        headers,
        body:
          rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      return {
        status: response.status,
        headers: response.headers,
        data: response.status === 204 ? null : await response.json(),
      };
    }
    const quantity = async () =>
      (
        await client.query(
          "SELECT quantity FROM cart_items WHERE user_id = $1 AND prod_id = $2",
          [customer.user_id, product.prod_id],
        )
      ).rows[0]?.quantity;
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

    await check(
      "PUT sets an absolute quantity and returns confirmed stock/subtotal",
      async () => {
        for (let repeat = 0; repeat < 2; repeat++) {
          const result = await request(cartPath, {
            method: "PUT",
            body: { quantity: 3 },
          });
          assert.equal(result.status, 200);
          assert.equal(result.data.item.quantity, 3);
          assert.equal(result.data.item.in_stock, product.in_stock);
          assert.equal(
            Number(result.data.item.subtotal),
            3 * Number(product.unit_price),
          );
        }
        assert.equal(await quantity(), 3);
      },
    );
    await check(
      "over-stock updates fail and retain the saved quantity",
      async () => {
        const before = await quantity();
        const result = await request(cartPath, {
          method: "PUT",
          body: { quantity: product.in_stock + 1 },
        });
        assert.equal(result.status, 409);
        assert.equal(result.data.item.quantity, before);
        assert.equal(await quantity(), before);
      },
    );
    await check(
      "invalid JSON quantities and IDs are rejected before PostgreSQL",
      async () => {
        for (const value of [
          0,
          -1,
          1.5,
          true,
          false,
          [1],
          {},
          null,
          "",
          "1e2",
          2147483648,
        ]) {
          assert.equal(
            (
              await request(cartPath, {
                method: "PUT",
                body: { quantity: value },
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await request("/api/cart", {
                method: "POST",
                body: { prod_id: value, quantity: 1 },
              })
            ).status,
            400,
          );
        }
        assert.equal((await request("/api/products/2147483648")).status, 400);
      },
    );
    await check(
      "adding to a maximum-size cart never overflows an integer",
      async () => {
        await client.query(
          "UPDATE products SET in_stock = 2147483647 WHERE prod_id = $1",
          [product.prod_id],
        );
        await client.query(
          "UPDATE cart_items SET quantity = 2147483646 WHERE user_id = $1 AND prod_id = $2",
          [customer.user_id, product.prod_id],
        );
        assert.equal(
          (
            await request("/api/cart", {
              method: "POST",
              body: { prod_id: product.prod_id, quantity: 1 },
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await request("/api/cart", {
              method: "POST",
              body: { prod_id: product.prod_id, quantity: 1 },
            })
          ).status,
          409,
        );
        assert.equal(await quantity(), 2147483647);
      },
    );
    await check(
      "customers cannot change or remove another customer's cart rows",
      async () => {
        const before = await quantity();
        assert.equal(
          (
            await request(cartPath, {
              user: customer2,
              method: "PUT",
              body: { quantity: 1, user_id: customer.user_id },
            })
          ).status,
          404,
        );
        assert.equal(
          (await request(cartPath, { user: customer2, method: "DELETE" }))
            .status,
          404,
        );
        assert.equal(await quantity(), before);
      },
    );
    await check(
      "unauthenticated and cross-role requests fail on the server",
      async () => {
        assert.equal((await request("/api/cart", { user: null })).status, 401);
        assert.equal(
          (await request("/api/cart", { user: vendor })).status,
          403,
        );
        assert.equal(
          (await request("/api/wishlist", { user: vendor })).status,
          403,
        );
      },
    );
    for (const [name, sql, id] of [
      [
        "out-of-stock listing",
        "UPDATE products SET in_stock = 0 WHERE prod_id = $1",
        product.prod_id,
      ],
      [
        "discontinued listing",
        "UPDATE products SET discontinued = true WHERE prod_id = $1",
        product.prod_id,
      ],
      [
        "disabled shop",
        "UPDATE shops SET active_status = 'disabled' WHERE shop_id = $1",
        product.shop_id,
      ],
      [
        "discontinued master product",
        "UPDATE master_products SET active_status = 'discontinued' WHERE master_prod_id = $1",
        product.master_prod_id,
      ],
    ]) {
      await check(
        `${name} blocks cart changes but permits removal`,
        async () => {
          await client.query(sql, [id]);
          const result = await request(cartPath, {
            method: "PUT",
            body: { quantity: 1 },
          });
          assert.equal(result.status, 409);
          assert.equal(result.data.item.available, false);
          assert.equal(
            (
              await request("/api/cart", {
                method: "POST",
                body: { prod_id: product.prod_id, quantity: 1 },
              })
            ).status,
            409,
          );
          if (name !== "out-of-stock listing")
            assert.equal(
              (await request(`/api/products/${product.prod_id}`)).status,
              404,
            );
          assert.equal(
            (await request(cartPath, { method: "DELETE" })).status,
            204,
          );
        },
      );
    }
    await check(
      "missing product and malformed JSON return meaningful JSON errors",
      async () => {
        assert.equal(
          (
            await request("/api/cart", {
              method: "POST",
              body: { prod_id: 2147483647, quantity: 1 },
            })
          ).status,
          404,
        );
        const result = await request(cartPath, {
          method: "PUT",
          rawBody: '{"quantity":',
        });
        assert.equal(result.status, 400);
        assert.match(result.data.message, /valid JSON/);
      },
    );
    await check(
      "wishlist saves are idempotent and ownership is enforced",
      async () => {
        const path = "/api/wishlist";
        assert.equal(
          (
            await request(path, {
              method: "POST",
              body: { prod_id: product.prod_id },
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await request(path, {
              method: "POST",
              body: { prod_id: product.prod_id },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request(`${path}/${product.prod_id}`, {
              user: customer2,
              method: "DELETE",
            })
          ).status,
          404,
        );
      },
    );
    await check(
      "database errors are 500 and do not clear the session cookie",
      async () => {
        const workingQuery = pool.query;
        const log = t.mock.method(console, "error", () => {});
        pool.query = async () => {
          throw new Error("Simulated database outage");
        };
        try {
          const result = await request("/api/cart");
          assert.equal(result.status, 500);
          assert.equal(result.headers.get("set-cookie"), null);
        } finally {
          pool.query = workingQuery;
          log.mock.restore();
        }
      },
    );
    await check("logout invalidates a copied token", async () => {
      assert.equal(
        (await request("/api/auth/logout", { method: "POST" })).status,
        204,
      );
      assert.equal((await request("/api/cart")).status, 401);
    });
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
