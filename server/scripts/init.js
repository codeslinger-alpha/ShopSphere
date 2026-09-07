const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});
const pool = require("../src/config/db");
const transaction = require("../src/utils/transaction");

async function initialize() {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(216,601)");
    const existing = await client.query(
      "SELECT 1 FROM pg_tables WHERE schemaname=current_schema() LIMIT 1",
    );
    if (existing.rowCount)
      throw new Error(
        "Schema is not empty. Use npm run db:migrate for an existing database.",
      );
    await client.query(
      await fs.readFile(path.join(__dirname, "../sql/schema.sql"), "utf8"),
    );
    console.log(
      "Schema created. Run npm run db:seed from the project root to add local demo accounts and reference data.",
    );
  });
}
initialize()
  .catch((error) => {
    console.error("Initialization failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
