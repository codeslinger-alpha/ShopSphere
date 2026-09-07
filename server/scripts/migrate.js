const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});
const pool = require("../src/config/db");
const transaction = require("../src/utils/transaction");
async function migrate() {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(216, 601)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
    );
    const directory = path.join(__dirname, "../sql/migrations");
    for (const name of (await fs.readdir(directory))
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      if (
        (
          await client.query("SELECT 1 FROM schema_migrations WHERE name=$1", [
            name,
          ])
        ).rowCount
      )
        continue;
      await client.query(await fs.readFile(path.join(directory, name), "utf8"));
      await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [
        name,
      ]);
      console.log(`Applied ${name}`);
    }
  });
}
migrate()
  .catch((error) => {
    console.error("Migration failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
