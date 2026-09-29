const fs = require("node:fs/promises");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });

const pool = require("../src/db/pool");
const transaction = require("../src/db/transaction");

async function migrate() {
  const directory = path.join(__dirname, "../sql/migrations");
  const files = (await fs.readdir(directory))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  const applied = await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(216, 602)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const done = new Set(
      (await client.query("SELECT filename FROM schema_migrations")).rows.map(
        (row) => row.filename,
      ),
    );
    const pending = files.filter((file) => !done.has(file));
    for (const file of pending) {
      await client.query(await fs.readFile(path.join(directory, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
    }
    return pending;
  });

  console.log(
    applied.length
      ? `Database migrations applied: ${applied.join(", ")}`
      : "Database is already up to date.",
  );
}

migrate()
  .catch((error) => {
    console.error("Database migration failed:", error.code || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
