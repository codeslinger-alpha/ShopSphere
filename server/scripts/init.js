const fs = require("node:fs/promises");
const path = require("node:path");
require("dotenv").config({ path: path.join(__dirname, "../.env"), quiet: true });
const pool = require("../src/db/pool");
const { statements, assertValidObjects } = require("../src/db/script");

async function initialize() {
  const client = await pool.connect();
  try {
    const batches = statements(await fs.readFile(path.join(__dirname, "../sql/schema.sql"), "utf8"));
    const tables = batches.map((sql) => /^CREATE TABLE (\w+)/i.exec(sql)?.[1]).filter(Boolean);
    const objects = (await client.query(`SELECT object_name, object_type FROM all_objects
      WHERE owner=SYS_CONTEXT('USERENV','CURRENT_SCHEMA') AND object_type IN ('TABLE','INDEX')`)).rows;
    const existing = new Set(objects.map((row) => `${row.object_type}:${row.object_name}`));
    const present = tables.filter((name) => existing.has(`TABLE:${name.toUpperCase()}`));
    const resume = process.argv.includes("--resume");
    if (present.length && !resume)
      throw new Error("Application tables already exist. To finish an empty partial installation, use npm run db:init -- --resume. No data was changed.");
    // DDL commits itself. Recovery is deliberately limited to empty application
    // tables; this command never drops tables or overwrites existing records.
    for (const table of present) {
      const result = await client.query(`SELECT 1 FROM ${table} WHERE ROWNUM=1`);
      if (result.rowCount) throw new Error(`Cannot resume: ${table} contains data. Use a separate empty schema.`);
    }
    for (const [index, sql] of batches.entries()) {
      const match = /^CREATE (?:UNIQUE )?(TABLE|INDEX) (\w+)/i.exec(sql);
      if (match && existing.has(`${match[1].toUpperCase()}:${match[2].toUpperCase()}`)) continue;
      try { await client.query(sql); }
      catch (error) {
        throw new Error(`Schema statement ${index + 1} (${sql.split("\n")[0]}): ${error.message}`, { cause: error });
      }
    }
    await assertValidObjects(client);
    console.log(`Schema ready: ${tables.length} application tables; stored routines compiled. Run npm run db:seed for demo data.`);
  } finally { await client.close(); }
}
initialize().catch((error) => {
  console.error("Initialization failed:", error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
