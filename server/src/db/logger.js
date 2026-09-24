const { loggingEnabled } = require("../utils/logging");

// Log statement shape and timing, never bound values (addresses, emails, hashes).
async function timedQuery(runner, text, values) {
  if (!loggingEnabled("LOG_SQL")) return runner.query(text, values);
  const startedAt = process.hrtime.bigint();
  const statement = String(typeof text === "string" ? text : text.text).replace(/\s+/g, " ").trim().slice(0, 150);
  const elapsed = () => `${(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)}ms`;
  try {
    const result = await runner.query(text, values);
    console.log(`[sql] ${elapsed()} ${result?.rowCount ?? 0} row(s) ${statement}`);
    return result;
  } catch (error) {
    console.error(`[sql] ${elapsed()} FAILED ${error.code || "query error"} ${statement}`);
    throw error;
  }
}

module.exports = { timedQuery };
