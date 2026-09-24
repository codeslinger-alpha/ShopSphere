const pool = require("../config/db");
const { timedQuery } = require("./sqlLogger");

module.exports = async function transaction(work) {
  const client = await pool.connect();
  try {
    await timedQuery(client, "BEGIN");
    // Object.create makes the real client the prototype, so the work function
    // gets a logged query() while every other property still falls through to pg.
    // Anything less would either leave the work unlogged or turn this into a
    // client-shaped object that quietly lacks the rest of the API.
    const session = Object.create(client, {
      query: { value: (text, values) => timedQuery(client, text, values) },
    });
    const result = await work(session);
    await timedQuery(client, "COMMIT");
    return result;
  } catch (error) {
    await timedQuery(client, "ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};
