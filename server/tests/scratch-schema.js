// A disposable Oracle schema, and the wiring that points the application at it.
//
// Every integration test in this directory runs inside a namespace of its own.
// The intent was always that a run could not reach the application's tables and
// that no run inherited anything from the last one; on PostgreSQL both halves
// came free, because a schema was a directory-like thing a transaction could
// create, fill with the canonical DDL and both seeds, and roll back at the end.
//
// Oracle has neither half. There is no CREATE SCHEMA — a schema is a user — and
// DDL commits itself, so "build the schema inside the transaction and roll it
// back" cannot happen at all. The same isolation is reached a different way: the
// test creates a user, aims its session at that user's schema with ALTER SESSION
// SET CURRENT_SCHEMA, loads the schema and the seeds into it, and drops the user
// with CASCADE when it is done. That statement is the closest thing Oracle has to
// search_path, and it does the one job search_path was doing here — every
// unqualified name in the application's SQL resolves into the scratch schema,
// because the application's queries are all funnelled through this one session.
//
// Nothing the run writes is ever committed into the schema the server is
// configured against, so the cost of a run killed with SIGKILL is one orphaned
// user rather than altered demo data. `create` clears any such orphan before it
// starts, so the next run repairs the last one.
//
// The scratch user is dropped at the end of the run and its password is the
// constant below rather than a secret: no credential outlives the test that
// reads it, and it is never a way into anything.
const fs = require("node:fs/promises");
const path = require("node:path");



// The canonical schema first, then the small fixture and the expanded one, in the
// order `npm run db:seed` loads them.
const FILES = [
  "../sql/schema.sql",
  "../sql/test_insert/seed_demo.sql",
  "../sql/test_insert/seed_extended.sql",
];

// The files are a sequence of statements separated by a line holding only "/",
// the SQL*Plus convention the runner also reads, because Oracle prepares one
// statement at a time and a file of them has to be cut up first.
const { statements, assertValidObjects } = require("../src/db/script");

async function read(file) {
  return fs.readFile(path.join(__dirname, file), "utf8");
}

// Oracle uppercases an unquoted name, so a scratch schema written plainly is
// spelled in capitals everywhere it is used afterwards.
function name(prefix) {
  return `${prefix}_${process.pid}_${Date.now()}`;
}

// The schema, the seeds and the order they go in, loaded as the runner loads them.
async function load(client, { extended = false } = {}) {
  let changed = 0;
  for (const file of extended ? FILES : FILES.slice(0, 2)) {
    for (const statement of statements(await read(file)))
      changed += (await client.query(statement)).rowCount;
    await assertValidObjects(client);
  }
  await assertValidObjects(client);
  await client.query("DELETE FROM seed_run_orders");
  return changed;
}

// The canonical schema alone, for a test that wants to load the seed itself.
async function schema(client) {
  for (const statement of statements(await read(FILES[0])))
    await client.query(statement);
  await assertValidObjects(client);
}

// The seeds alone, so that a test can load them a second time and see what
// loading them a second time does.
async function seed(client) {
  await client.query("DELETE FROM seed_run_orders");
  for (const file of FILES.slice(1))
    for (const statement of statements(await read(file)))
      await client.query(statement);
  await assertValidObjects(client);
  await client.query("DELETE FROM seed_run_orders");
}

// The scratch table the seed notes its own inserted orders in, which the seed
// script creates before it starts for the reason it explains there: Oracle
// commits at DDL, so a CREATE inside the seed's transaction would end it. It has
// to exist before either seed file runs, and being ON COMMIT DELETE ROWS it
// empties itself, so the rerun a test performs finds it clean.
async function scratchTable(client) {
  const existing = await client.query(
    `SELECT COUNT(*) AS found FROM all_tables
     WHERE owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA')
       AND table_name = 'SEED_RUN_ORDERS'`,
  );
  if (Number(existing.rows[0].found)) return;
  await client.query(
    `CREATE GLOBAL TEMPORARY TABLE seed_run_orders (
       order_id NUMBER(10) PRIMARY KEY
     ) ON COMMIT DELETE ROWS`,
  );
}

// A user of its own, whose schema is this run's namespace.
//
// The privileges an object needs are the ones held by the user creating it —
// ADMIN, here — and not by the schema it lands in, so no grants are made to the
// scratch user: it never logs in, it is only ever a name that objects sit under.
// The quota is a different matter and does have to be given, because it is
// charged to the owner of the table.
async function create(client, prefix) {
  const scratch = name(prefix);
  await client.query(
    `CREATE USER ${scratch} NO AUTHENTICATION QUOTA UNLIMITED ON DATA`,
  );
  await client.query(`ALTER SESSION SET CURRENT_SCHEMA = ${scratch}`);
  await scratchTable(client);
  return scratch;
}

// DML first, then the schema that held it. Oracle would commit the pending
// transaction by itself at the DROP, but saying which of the two the caller
// means is the difference between a teardown and an accident.
async function drop(client, scratch) {
  if (!scratch) return;
  await client.rollback().catch(() => {});
  await client.query(`DROP USER ${scratch} CASCADE`);
}

// Sends everything the application does through the one session above, which is
// what makes the scratch schema apply to the application's own queries and what
// makes its writes part of the transaction this file rolls back.
//
// A transaction of the application's own becomes a savepoint, so a failure the
// test provokes rolls back exactly the work that failed — the application is
// told its transaction was abandoned, and the test can still read the tables
// afterwards to see what it left behind. `commit` is the savepoint released and
// `rollback` is the savepoint returned to; `close` has nothing to hand back,
// because the connection was never the application's to take.
function funnel(pool, client) {
  let transaction = 0;
  pool.query = (text, values) => client.query(text, values);
  pool.connect = async () => {
    const savepoint = `regression_${++transaction}`;
    await client.query(`SAVEPOINT ${savepoint}`);
    return {
      query: (text, values) => client.query(text, values),
      commit: async () => {},
      rollback: () => client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`),
      close: async () => {},
    };
  };
}

module.exports = { create, drop, funnel, load, schema, seed, statements };
