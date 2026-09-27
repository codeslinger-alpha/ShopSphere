// Does the configured database answer?
//
// The one question this asks is whether the connection settings in .env reach a
// live database, so it prints only things that are not secret: the server banner,
// the driver mode, the schema that was reached and how many of this project's
// tables are already there. Credentials are never echoed, not even on failure —
// the driver's own error text is passed through, and it does not contain them.
const path = require("node:path");
require("dotenv").config({
  path: path.join(__dirname, "../.env"),
  quiet: true,
});

const oracledb = require("oracledb");
const { connectionOptions } = require("../src/db/config");

const TABLES = [
  "countries", "locations", "roles", "users", "shops", "categories",
  "master_products", "products", "shop_purchases", "vendor_refunds",
  "shop_topups", "attributes", "category_attributes", "attribute_values",
  "cart_items", "wish_list_items", "product_reviews", "shop_reviews",
  "delivery_personnel", "orders", "payments", "order_items",
  "product_returns", "customer_refunds",
];

async function main() {
  if (!process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_CONNECT_STRING)
    throw new Error(
      "DB_USER, DB_PASSWORD and DB_CONNECT_STRING must all be set in server/.env.",
    );

  const connection = await oracledb.getConnection(connectionOptions());

  try {
    const version = await connection.execute(
      "SELECT banner FROM v$version WHERE ROWNUM = 1",
    );
    const identity = await connection.execute(
      "SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS schema FROM dual",
    );
    // One round trip for all 24: a missing table is an ORA-00942, which is caught
    // here rather than thrown, so "how far along is this database" is one query.
    const present = [];
    for (const name of TABLES) {
      try {
        await connection.execute(`SELECT 1 FROM ${name} WHERE ROWNUM = 1`);
        present.push(name);
      } catch {
        // Not there yet. Absence is an answer, not an error.
      }
    }

    console.log("Connection succeeded.");
    console.log(`  driver        node-oracledb ${oracledb.versionString} (${oracledb.thin ? "thin" : "thick"} mode)`);
    console.log(`  server        ${version.rows[0][0]}`);
    console.log(`  schema        ${identity.rows[0][0]}`);
    console.log(`  tables found  ${present.length} of ${TABLES.length}`);
    if (present.length && present.length < TABLES.length)
      console.log(
        `  missing       ${TABLES.filter((name) => !present.includes(name)).join(", ")}`,
      );
  } finally {
    await connection.close();
  }
}

main().catch((error) => {
  console.error("Connection failed.");
  console.error(`  ${error.code ? `${error.code}: ` : ""}${error.message}`);
  process.exitCode = 1;
});
