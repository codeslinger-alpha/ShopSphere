const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
require("dotenv").config({ quiet: true });
const pool = require("../src/db/pool");

test("canonical schema and expanded seed are complete and repeatable", async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout='30s'");
    const namespace = `shopsphere_schema_${process.pid}_${Date.now()}`;
    await client.query(`CREATE SCHEMA "${namespace}"`);
    await client.query(`SET LOCAL search_path TO "${namespace}"`);
    const schema = await fs.readFile("sql/schema.sql", "utf8");
    assert.doesNotMatch(schema, /^\s*(ALTER TABLE|DROP TRIGGER|UPDATE users)/im);
    await client.query(schema);
    const seed = (await Promise.all(["seed_demo.sql", "seed_extended.sql"].map((name) =>
      fs.readFile(`sql/test_insert/${name}`, "utf8")))).join("\n");
    await client.query(seed);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const snapshot = async () => (await client.query(`
      SELECT (SELECT count(*)::int FROM users) AS users,
        (SELECT count(*)::int FROM shops) AS shops,
        (SELECT count(*)::int FROM master_products) AS masters,
        (SELECT count(*)::int FROM products) AS listings,
        (SELECT count(*)::int FROM orders) AS orders,
        (SELECT count(*)::int FROM order_items) AS items,
        (SELECT count(*)::int FROM payments) AS payments,
        (SELECT count(*)::int FROM vendor_refunds) AS refunds,
        (SELECT sum(earnings)::text FROM delivery_personnel) AS courier_earnings,
        (SELECT sum(balance)::text FROM shops) AS shop_balances,
        (SELECT sum(amount)::text FROM shop_topups) AS topups
    `)).rows[0];
    const before = await snapshot();
    assert.equal(before.users, 46);
    assert.equal(before.shops, 8);
    assert.equal(before.masters, 52);
    assert.equal(before.listings, 296);
    assert.equal(before.orders, 34);
    assert.equal(before.items, 68);
    assert.equal(before.payments, 34);
    assert.equal(before.refunds, 24);
    assert.equal((await client.query("SELECT 1 FROM orders WHERE total_amount<>fn_order_subtotal(order_id)")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM payments p JOIN orders o USING(order_id) WHERE p.amount<>o.total_amount+o.delivery_cost")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM orders o JOIN payments p USING(order_id) WHERE o.order_status='cancelled' AND (p.payment_status<>'failed' OR p.paid_at IS NOT NULL OR o.delivery_person_id IS NOT NULL)")).rowCount, 0);
    for (const name of ['idx_vendor_refunds_shop', 'idx_vendor_refunds_created'])
      assert.equal((await client.query("SELECT 1 FROM pg_indexes WHERE schemaname=$1 AND indexname=$2", [namespace, name])).rowCount, 1);
    // The balance is a cached running total, so it has to equal the movements it
    // claims to summarise — every shop, or the column is a number that reconciles
    // with nothing. This is the identity the recharge page and the purchase guard
    // both rest on, checked against the four ledgers rather than against a figure
    // written down here.
    assert.equal(
      (
        await client.query(`
          SELECT 1 FROM shops s
          WHERE s.balance <> COALESCE((
            SELECT SUM(oi.quantity * oi.unit_price)
            FROM order_items oi JOIN orders o USING(order_id) JOIN products p USING(prod_id)
            WHERE p.shop_id = s.shop_id AND o.order_status = 'delivered'), 0)
            + COALESCE((SELECT SUM(t.amount) FROM shop_topups t WHERE t.shop_id = s.shop_id), 0)
            - COALESCE((SELECT SUM(sp.quantity * sp.wholesale_unit_price)
                        FROM shop_purchases sp WHERE sp.shop_id = s.shop_id), 0)
            + COALESCE((SELECT SUM(vr.amount) FROM vendor_refunds vr WHERE vr.shop_id = s.shop_id), 0)
        `)
      ).rowCount,
      0,
    );
    const routine = (await client.query("SELECT prokind FROM pg_proc WHERE pronamespace=$1::regnamespace AND proname='settle_delivery'", [namespace])).rows[0];
    assert.equal(routine.prokind, 'p');
    // Reseeding must not reset actual earnings accrued after the fixtures were loaded.
    await client.query("UPDATE delivery_personnel SET earnings=earnings+10");
    const changed = await snapshot();
    await client.query(seed);
    assert.deepEqual(await snapshot(), changed);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
