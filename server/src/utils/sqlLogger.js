// Every statement this API runs passes through one of two runners: the pool, for
// single-statement queries, and a transaction client, for the work inside
// BEGIN/COMMIT. Wrapping both means the terminal shows what was asked of
// PostgreSQL and how long it took, without each query module logging itself.
//
// Set LOG_SQL=false to quiet it; the integration test scripts do, since they run
// thousands of statements and their own output is what needs reading.
const { loggingEnabled } = require("./logging");

// Query modules write SQL as a multi-line template literal. Printing it as
// written would push a single statement across the whole terminal width, so it is
// collapsed to one line and clipped from the right, where the tail is usually a
// RETURNING clause rather than the part that identifies the statement.
const MAX_SQL = 150;
function summarise(text) {
  const flat = String(text).replace(/\s+/g, " ").trim();
  return flat.length > MAX_SQL ? `${flat.slice(0, MAX_SQL)}…` : flat;
}
function milliseconds(startedAt) {
  return `${(Number(process.hrtime.bigint() - startedAt) / 1e6).toFixed(1)}ms`;
}
// Parameters are what distinguish two calls to the same statement, so they are
// worth showing. They are hashes and ids, never a plaintext password: every write
// path hashes before it reaches SQL.
function showValues(values) {
  if (!values || values.length === 0) return "";
  const rendered = JSON.stringify(values);
  return ` ${rendered.length > 120 ? `${rendered.slice(0, 120)}…` : rendered}`;
}

async function timedQuery(runner, text, values) {
  if (!loggingEnabled("LOG_SQL")) return runner.query(text, values);
  const startedAt = process.hrtime.bigint();
  try {
    const result = await runner.query(text, values);
    console.log(
      `[sql] ${milliseconds(startedAt)} ${result?.rowCount ?? 0} row(s) ${summarise(text)}${showValues(values)}`,
    );
    return result;
  } catch (error) {
    console.error(
      `[sql] ${milliseconds(startedAt)} FAILED ${error.code || error.message} ${summarise(text)}${showValues(values)}`,
    );
    throw error;
  }
}

module.exports = { timedQuery };
