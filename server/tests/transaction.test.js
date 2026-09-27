const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../src/db/pool");
const transaction = require("../src/db/transaction");

for (const failureAt of [null, "write", "COMMIT"]) {
  test(`explicit single-statement transaction: ${failureAt || "success"}`, async (t) => {
    const calls = [];
    const failure = new Error("Simulated database failure");
    t.mock.method(pool, "connect", async () => ({
      query: async (sql) => {
        calls.push(sql);
        if (sql === failureAt) throw failure;
        return { rows: [{ saved: true }] };
      },
      commit: async () => { calls.push("COMMIT"); if (failureAt === "COMMIT") throw failure; },
      rollback: async () => calls.push("ROLLBACK"),
      close: async () => calls.push("close"),
    }));
    if (failureAt) await assert.rejects(transaction.query("write"), failure);
    else assert.deepEqual((await transaction.query("write")).rows, [{ saved: true }]);
    assert.deepEqual(calls, failureAt === "write"
      ? ["write", "ROLLBACK", "close"]
      : ["write", "COMMIT", ...(failureAt ? ["ROLLBACK"] : []), "close"]);
  });
}

test("controllers do not issue mutation SQL through the read pool", async () => {
  const queryPath = path.join(__dirname, "../src/db/queries");
  const mutationNames = new Set();
  for (const file of await fs.readdir(queryPath)) {
    const queries = require(path.join(queryPath, file));
    for (const [name, sql] of Object.entries(queries))
      if (typeof sql === "string" && /\b(INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM|CALL)\b/i.test(sql))
        mutationNames.add(name);
  }
  const controllers = path.join(__dirname, "../src/controllers");
  for (const file of await fs.readdir(controllers)) {
    const source = await fs.readFile(path.join(controllers, file), "utf8");
    for (const match of source.matchAll(/pool\.query\(\s*(?:\w+\.)?(\w+)/g))
      assert.ok(!mutationNames.has(match[1]), `${file}: ${match[1]} must use explicit transaction control`);
  }
});
