const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");

require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});

// No ORM: the SQL file contains the INSERT statements and foreign-key lookups.
async function seed() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Demo data is only intended for a development database.");
  }

  const sql = await fs.readFile(
    path.join(__dirname, "../sql/test_insert/seed_demo.sql"),
    "utf8",
  );
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectionTimeoutMillis: 10000,
  });
  let client;

  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '30s'");
    // Serialize this seed command so concurrent runs do not duplicate demo rows.
    await client.query("SELECT pg_advisory_xact_lock(216, 600)");
    const results = await client.query(sql);
    await client.query("COMMIT");
    const inserted = results.reduce(
      (count, result) => count + (result.rowCount || 0),
      0,
    );
    console.log(
      `Demo seed complete: ${inserted} rows inserted. Existing records were preserved.`,
    );
    console.log(
      "Open http://localhost:5173/products to view the shop listings.",
    );
    console.log(
      "Demo account credentials and setup instructions are in server/README.md.",
    );
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
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
});
