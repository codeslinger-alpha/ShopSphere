const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({ quiet: true });
const pool = require("../src/db/pool");
const scratch = require("./scratch-schema");

test("canonical schema and expanded seed are complete and repeatable", async () => {
  const client = await pool.connect();
  let namespace;
  try {
    namespace = await scratch.create(client, "SHOPSPHERE_SCHEMA");
    const canonical = await fs.readFile(
      path.join(__dirname, "../sql/schema.sql"),
      "utf8",
    );
    assert.doesNotMatch(canonical, /^\s*(ALTER TABLE|DROP TRIGGER|UPDATE users)/im);
    await scratch.load(client, { extended: true });
    const snapshot = async () => (await client.query(`
      SELECT (SELECT COUNT(*) FROM users) AS users,
        (SELECT COUNT(*) FROM categories) AS categories,
        (SELECT COUNT(*) FROM categories WHERE parent_category IS NULL) AS roots,
        (SELECT COUNT(*) FROM shops) AS shops,
        (SELECT COUNT(*) FROM master_products) AS masters,
        (SELECT COUNT(*) FROM products) AS listings,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM order_items) AS items,
        (SELECT COUNT(*) FROM payments) AS payments,
        (SELECT COUNT(*) FROM vendor_refunds) AS refunds,
        (SELECT SUM(earnings) FROM delivery_personnel) AS courier_earnings,
        (SELECT SUM(balance) FROM shops) AS shop_balances,
        (SELECT SUM(amount) FROM shop_topups) AS topups
      FROM dual
    `)).rows[0];
    const before = await snapshot();
    assert.equal(before.users, 46);
    assert.equal(before.categories, 12);
    assert.equal(before.roots, 1);
    const tree = (await client.query(`SELECT category_id, LEVEL AS depth
      FROM categories START WITH name='Demo Catalog'
      CONNECT BY PRIOR category_id=parent_category`)).rows;
    assert.equal(tree.length, 12);
    assert.equal(Math.max(...tree.map((row) => row.depth)), 3);
    const { buildProductListQuery } = require("../src/db/queries/catalogQueries");
    const filters = { q: "", categoryId: tree.find((row) => row.depth === 1).category_id,
      minPrice: null, maxPrice: null, attributes: new Map(), sort: "newest", page: 1, limit: 60 };
    const descendants = await client.query(buildProductListQuery(filters));
    const all = await client.query(buildProductListQuery({ ...filters, categoryId: null }));
    assert.ok(descendants.rows.length > 0);
    assert.deepEqual(descendants.rows, all.rows);
    assert.equal(before.shops, 8);
    assert.equal(before.masters, 52);
    assert.equal(before.listings, 296);
    assert.equal(before.orders, 34);
    assert.equal(before.items, 68);
    assert.equal(before.payments, 34);
    assert.equal(before.refunds, 24);
    assert.equal((await client.query("SELECT 1 FROM orders WHERE total_amount<>fn_order_subtotal(order_id)")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM payments p JOIN orders o ON o.order_id=p.order_id WHERE p.amount<>o.total_amount+o.delivery_cost")).rowCount, 0);
    assert.equal((await client.query("SELECT 1 FROM orders o JOIN payments p ON p.order_id=o.order_id WHERE o.order_status='cancelled' AND (p.payment_status<>'failed' OR p.paid_at IS NOT NULL OR o.delivery_person_id IS NOT NULL)")).rowCount, 0);
    // Named the way Oracle spells an index and read from the owner-scoped view:
    // USER_INDEXES answers for the user the connection logged in as, which is not
    // the schema this run built.
    for (const name of ['IDX_VENDOR_REFUNDS_SHOP', 'IDX_VENDOR_REFUNDS_CREATED'])
      assert.equal((await client.query("SELECT 1 FROM all_indexes WHERE owner=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND index_name=:1", [name])).rowCount, 1);
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
            FROM order_items oi JOIN orders o ON o.order_id=oi.order_id JOIN products p ON p.prod_id=oi.prod_id
            WHERE p.shop_id = s.shop_id AND o.order_status = 'delivered'), 0)
            + COALESCE((SELECT SUM(t.amount) FROM shop_topups t WHERE t.shop_id = s.shop_id), 0)
            - COALESCE((SELECT SUM(sp.quantity * sp.wholesale_unit_price)
                        FROM shop_purchases sp WHERE sp.shop_id = s.shop_id), 0)
            + COALESCE((SELECT SUM(vr.amount) FROM vendor_refunds vr WHERE vr.shop_id = s.shop_id), 0)
        `)
      ).rowCount,
      0,
    );
    // The procedure the delivery API calls, asserted to be a procedure rather
    // than the function of the same shape it could have been written as.
    const routine = (await client.query(
      `SELECT object_type FROM all_objects
       WHERE owner = SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND object_name = 'SETTLE_DELIVERY'`,
    )).rows[0];
    assert.equal(routine.object_type, 'PROCEDURE');
    // Reseeding must not reset actual earnings accrued after the fixtures were loaded.
    await client.query("UPDATE delivery_personnel SET earnings=earnings+10");
    const changed = await snapshot();
    await scratch.seed(client);
    assert.deepEqual(await snapshot(), changed);
  } finally {
    await scratch.drop(client, namespace);
    await client.close();
    await pool.end();
  }
});
