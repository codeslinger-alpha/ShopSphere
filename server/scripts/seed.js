// Load the local demo accounts and reference data.
//
// The SQL files are run statement by statement rather than in one call: Oracle
// prepares one statement at a time, so a file of them has to be cut up first.
// They separate their statements with a line holding only "/", the convention
// SQL*Plus uses.
//
// The whole seed is one transaction, so a failure leaves the database as it was,
// and it is written to be safe to run twice: every insert is guarded, and the
// scratch table below means the balance movements a rerun would otherwise repeat
// are only ever applied to the rows this run actually added.
const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});

const pool = require("../src/db/pool");
const transaction = require("../src/db/transaction");

// Where the seed notes the orders it inserted on this run.
//
// It cannot be created inside the seed's transaction: Oracle commits implicitly
// at every DDL statement, which would end that transaction without anyone asking
// it to. So it is created first, and being ON COMMIT DELETE ROWS it empties
// itself as the seed commits — a rerun finds it clean and credits nothing a
// second time, which is the whole reason it exists.
//
// The lookup below names the owner rather than using the USER_ view, which
// answers for the user the connection logged in as. The two are the same in a
// normal deployment and differ when the session has been aimed at another schema
// with ALTER SESSION SET CURRENT_SCHEMA, where the seed must still see the table
// it is about to load into and not a same-named one in the schema it logged in
// as.
const SCRATCH = "seed_run_orders";

const { statements, assertValidObjects } = require("../src/db/script");

async function scratch(client) {
  const existing = await client.query(
    `SELECT COUNT(*) AS found FROM all_tables
     WHERE owner = SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AND table_name = :1`,
    [SCRATCH.toUpperCase()],
  );
  if (Number(existing.rows[0].found)) return;
  await client.query(
    `CREATE GLOBAL TEMPORARY TABLE ${SCRATCH} (
       order_id NUMBER(10) PRIMARY KEY
     ) ON COMMIT DELETE ROWS`,
  );
}

async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data is only intended for a development database.");
  }

  const files = ["seed_demo.sql", "seed_extended.sql"];
  const sql = (await Promise.all(files.map((file) =>
    fs.readFile(path.join(__dirname, "../sql/test_insert", file), "utf8"),
  ))).join("\n");
  const batches = statements(sql);

  const setup = await pool.connect();
  let inserted;
  try {
    await assertValidObjects(setup);
    await scratch(setup);
    inserted = await transaction(async (client) => {
      let affected = 0;
      for (const statement of batches)
        affected += (await client.query(statement)).rowCount;
      // The scratch rows are this run's; nothing outside the seed reads them.
      await client.query(`DELETE FROM ${SCRATCH}`);
      return affected;
    });
  } finally {
    await setup.close();
  }

  console.log(
    `Demo seed complete: ${inserted} rows affected. Existing accounts and inventory were preserved.`,
  );
  console.log(
    "Open http://localhost:5173/products to view the shop listings.",
  );
  console.log(
    "Demo account credentials and setup instructions are in server/README.md.",
  );
}

seed().catch((error) => {
  // Oracle error codes are database errors, not HTTP response statuses.
  const explanations = {
    "ORA-00942":
      "A required table is missing. Create the schema in your development database first.",
    "ORA-00904":
      "A required column is missing. Check that the database matches sql/schema.sql.",
    "ORA-02291": "A foreign key refers to a record that does not exist.",
    "ORA-00001": "A value conflicts with an existing unique key.",
    "ORA-02290": "A value violates a database CHECK constraint.",
    "ORA-01017":
      "Database authentication failed. Check the credentials in server/.env.",
    "ORA-12154":
      "The connect string could not be resolved. Check DB_CONNECT_STRING and DB_WALLET_LOCATION.",
    "ORA-28759":
      "The wallet could not be opened. Check DB_WALLET_LOCATION, and that the wallet directory holds its credentials file.",
    "NJS-518":
      "The database could not be reached. Check that it is running and that its network is reachable.",
    "NJS-521":
      "The database could not be reached. Check that it is running and that its network is reachable.",
  };
  // Do not print connection strings or database error details containing row data.
  console.error(
    "Demo seed failed:",
    explanations[error.code] || error.code || error.message,
  );
  process.exitCode = 1;
}).finally(() => pool.end());
