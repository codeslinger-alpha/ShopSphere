const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});

const pool = require("../src/db/pool");
const transaction = require("../src/db/transaction");

// No ORM: the SQL file contains the INSERT statements and foreign-key lookups.
async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data is only intended for a development database.");
  }

  const files = ["seed_demo.sql", "seed_extended.sql"];
  const sql = (await Promise.all(files.map((file) =>
    fs.readFile(path.join(__dirname, "../sql/test_insert", file), "utf8"),
  ))).join("\n");
  const results = await transaction(async (client) => {
    await client.query("SET LOCAL statement_timeout = '30s'");
    // Serialize seed commands so concurrent runs cannot duplicate demo rows.
    await client.query("SELECT pg_advisory_xact_lock(216, 600)");
    return client.query(sql);
  });
  const inserted = results.reduce(
    (count, result) => count + (result.rowCount || 0),
    0,
  );
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
  // PostgreSQL error codes are database errors, not HTTP response statuses.
  const explanations = {
    "42P01":
      "A required table is missing. Create the schema in your development database first.",
    42703:
      "A required column is missing. Check that the database matches sql/schema.sql.",
    23503: "A foreign key refers to a record that does not exist.",
    23505: "A value conflicts with an existing unique key.",
    23514: "A value violates a database CHECK constraint.",
    "28P01":
      "Database authentication failed. Check the credentials in server/.env.",
    ECONNREFUSED:
      "PostgreSQL refused the connection. Check that the database is running.",
    EAI_AGAIN:
      "The database hostname could not be resolved. Check the network and DB_HOST.",
  };
  // Do not print connection strings or database error details containing row data.
  console.error(
    "Demo seed failed:",
    explanations[error.code] || error.code || error.message,
  );
  process.exitCode = 1;
}).finally(() => pool.end());
