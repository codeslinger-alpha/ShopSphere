const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { Pool } = require("pg");
require("dotenv").config({ quiet: true });
process.env.JWT_SECRET = "shopsphere-isolated-regression-test-secret";
const app = require("../src/index");
const pool = require("../src/db/pool");
const q = require("../src/db/queries/orderQueries");
const { createAuthToken } = require("../src/utils/authToken");

// Real independent connections are required to reproduce duplicate checkout.
test("concurrent checkouts buy a cart once and preserve newly added items", async () => {
  const namespace = `shopsphere_concurrency_${process.pid}_${Date.now()}`;
  const originalQuery = pool.query;
  const originalConnect = pool.connect;
  const admin = await originalConnect.call(pool);
  const scoped = new Pool({
    ...pool.options,
    password: pool.options.password,
    options: `-c search_path=${namespace} -c statement_timeout=15000`,
  });
  let server;
  let resume;
  const gate = new Promise((resolve) => { resume = resolve; });
  let snapshotReady;
  const snapshot = new Promise((resolve) => { snapshotReady = resolve; });
  let cartReads = 0;
  let secondReadFinished = false;
  const pending = [];
  try {
    await admin.query(`CREATE SCHEMA "${namespace}"`);
    await scoped.query(await fs.readFile("sql/schema.sql", "utf8"));
    await scoped.query(await fs.readFile("sql/test_insert/seed_demo.sql", "utf8"));
    pool.query = scoped.query.bind(scoped);
    pool.connect = async () => {
      const client = await scoped.connect();
      return {
        release: () => client.release(),
        query: async (text, values) => {
          const read = text === q.CART_FOR_ORDER ? ++cartReads : 0;
          const result = await client.query(text, values);
          if (read === 1) { snapshotReady(); await gate; }
          if (read === 2) secondReadFinished = true;
          return result;
        },
      };
    };
    const user = (await scoped.query("SELECT * FROM users WHERE email='customer@shopsphere.test'")).rows[0];
    const products = (await scoped.query("SELECT prod_id FROM products WHERE discontinued=false AND in_stock > 0 ORDER BY prod_id LIMIT 2")).rows;
    const [bought, added] = products.map((p) => p.prod_id);
    await scoped.query("DELETE FROM cart_items WHERE user_id=$1", [user.user_id]);
    await scoped.query("INSERT INTO cart_items VALUES ($1,$2,1)", [user.user_id, bought]);
    const before = (await scoped.query("SELECT in_stock FROM products WHERE prod_id=$1", [bought])).rows[0].in_stock;
    server = app.listen(0, "127.0.0.1");
    await once(server, "listening");
    const checkout = () => fetch(`http://127.0.0.1:${server.address().port}/api/orders`, {
      method: "POST", headers: { Cookie: `shopsphere_token=${createAuthToken(user)}` },
    });
    pending.push(checkout());
    await snapshot;
    pending.push(checkout());

    // Wait until the second SELECT either blocks on the cart lock (fixed) or
    // returns its stale snapshot (regression), before allowing the first commit.
    let observed = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await scoped.query(
        "SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND query=$1 AND wait_event_type='Lock'",
        [q.CART_FOR_ORDER],
      );
      if (secondReadFinished || waiting.rowCount) { observed = true; break; }
      await delay(20);
    }
    assert.ok(observed, "second checkout must reach its cart read");
    await scoped.query("INSERT INTO cart_items VALUES ($1,$2,1)", [user.user_id, added]);
    resume();
    const responses = await Promise.all(pending);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 400]);
    const order = (await responses.find((response) => response.status === 201).json()).order;
    assert.deepEqual(order.items.map((item) => item.prod_id), [bought]);
    assert.equal((await scoped.query("SELECT in_stock FROM products WHERE prod_id=$1", [bought])).rows[0].in_stock, before - 1);
    assert.deepEqual((await scoped.query("SELECT prod_id FROM cart_items WHERE user_id=$1", [user.user_id])).rows, [{ prod_id: added }]);
  } finally {
    resume();
    await Promise.allSettled(pending);
    if (server) await new Promise((resolve) => server.close(resolve));
    pool.query = originalQuery;
    pool.connect = originalConnect;
    await scoped.end();
    await admin.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`);
    admin.release();
    await pool.end();
  }
});
