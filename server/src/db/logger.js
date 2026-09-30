const { loggingEnabled } = require("../utils/logging");
const { cyan, dim, red } = require("../utils/color");

// Log statement shape and timing, never bound values (addresses, emails, hashes).
async function timedQuery(runner, text, values) {
  if (!loggingEnabled("LOG_SQL")) return runner.query(text, values);
  const startedAt = process.hrtime.bigint();
  // Printed whole. Collapsing the whitespace is what keeps a formatted query on
  // one line; cutting it short as well hid the half a reader is actually looking
  // for — the WHERE clause of a query that returned the wrong rows.
  const statement = String(typeof text === "string" ? text : text.text)
    .replace(/\s+/g, " ")
    .trim();
  const elapsed = () => `${(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)}ms`;
  try {
    const result = await runner.query(text, values);
    console.log(
      `${cyan("[sql]")} ${dim(elapsed())} ${result?.rowCount ?? 0} row(s) ${statement}`,
    );
    return result;
  } catch (error) {
    console.error(
      `${cyan("[sql]")} ${dim(elapsed())} ${red(`FAILED ${error.code || "query error"}`)} ${statement}`,
    );
    throw error;
  }
}

module.exports = { timedQuery };
