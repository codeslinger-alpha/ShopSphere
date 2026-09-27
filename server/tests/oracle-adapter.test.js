const test = require("node:test");
const assert = require("node:assert/strict");
const oracle = require("oracledb");
const { session } = require("../src/db/execute");
process.env.LOG_SQL = "false";
const columns = [
  { COLUMN_NAME: "PROD_ID", DATA_TYPE: "NUMBER", DATA_PRECISION: 10, DATA_SCALE: 0 },
  { COLUMN_NAME: "UNIT_PRICE", DATA_TYPE: "NUMBER", DATA_PRECISION: 12, DATA_SCALE: 2 },
];
function fake(run) {
  return session({ execute: async (sql, binds) => sql.includes("FROM all_tab_columns")
    ? { rows: columns } : run(sql, binds) });
}
test("DML output arrays become one row per affected record", async () => {
  const db = fake(async () => ({ rowsAffected: 2, outBinds: { ret0: [7, 8], ret1: [2.5, 3] } }));
  assert.deepEqual(await db.query("UPDATE products SET unit_price=:1 RETURNING prod_id, unit_price", [3]),
    { rowCount: 2, rows: [{ prod_id: 7, unit_price: "2.50" }, { prod_id: 8, unit_price: "3.00" }] });
});
test("a guarded DML miss produces no phantom result row", async () => {
  const db = fake(async () => ({ rowsAffected: 0, outBinds: { ret0: [] } }));
  assert.deepEqual(await db.query("DELETE FROM products WHERE prod_id=:1 RETURNING prod_id", [7]), { rowCount: 0, rows: [] });
});
test("array expansion does not corrupt the RETURNING clause offset", async () => {
  const db = fake(async (sql, binds) => {
    assert.match(sql, /IN \(:list1_0, :list1_1\) RETURNING PROD_ID INTO :ret0/i);
    assert.equal(binds.list1_1, 8);
    return { rowsAffected: 1, outBinds: { ret0: [7] } };
  });
  assert.equal((await db.query("DELETE FROM products WHERE prod_id IN (:1) RETURNING prod_id", [[7, 8]])).rows[0].prod_id, 7);
});
test("query builder configs preserve binds and lowercase result keys", async () => {
  const db = fake(async (sql, binds) => {
    assert.equal(sql, "SELECT :1 AS PROD_ID FROM dual"); assert.equal(binds[1], 7);
    return { rows: [{ PROD_ID: 7 }], metaData: [{ name: "PROD_ID", dbType: oracle.DB_TYPE_NUMBER }] };
  });
  assert.deepEqual((await db.query({ text: "SELECT :1 AS PROD_ID FROM dual", values: [7] })).rows, [{ prod_id: 7 }]);
});
test("PL/SQL CLOB outputs are consumed before returning the connection", async () => {
  const db = fake(async () => ({ outBinds: { result: { getData: async () => '{"ok":true}' } } }));
  const result = await db.query("BEGIN example(:result); END;", { result: { dir: oracle.BIND_OUT, type: oracle.DB_TYPE_CLOB } });
  assert.deepEqual(result, { rowCount: 1, rows: [{ result: '{"ok":true}' }] });
});
