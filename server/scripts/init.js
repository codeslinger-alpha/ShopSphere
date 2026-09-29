const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});
const pool = require("../src/db/pool");
const transaction = require("../src/db/transaction");

async function initialize() {
  const reset = process.argv.includes("--reset");
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(216,601)");
    if (reset) {
      // A reset deliberately replaces only this application's public schema.
      // It is the development workflow after changing schema.sql: the schema
      // and both demo datasets always begin from exactly the same state.
      await client.query("DROP SCHEMA public CASCADE");
      await client.query("CREATE SCHEMA public");
    } else {
      const existing = await client.query(
        "SELECT 1 FROM pg_tables WHERE schemaname=current_schema() LIMIT 1",
      );
      if (existing.rowCount)
        throw new Error(
          "Schema is not empty. Use npm run db:reset to recreate and populate the development database.",
        );
    }
    await client.query(
      await fs.readFile(path.join(__dirname, "../sql/schema.sql"), "utf8"),
    );
    if (reset) {
      const files = ["seed_demo.sql", "seed_extended.sql"];
      const seed = (
        await Promise.all(
          files.map((file) =>
            fs.readFile(path.join(__dirname, "../sql/test_insert", file), "utf8"),
          ),
        )
      ).join("\n");
      await client.query(seed);
    }
    console.log(
      reset
        ? "Database reset, schema created, and demo data loaded."
        : "Schema created. Run npm run db:seed from the project root to add demo data.",
    );
  });
}
initialize()
  .catch((error) => {
    console.error("Initialization failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
