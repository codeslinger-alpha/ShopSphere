const pool = require("./pool");

// Oracle has no BEGIN. A transaction is simply whatever a connection has written
// since it last committed, so this is the same promise as before — every
// statement in the work succeeds and is committed, or the first failure rolls
// all of them back — expressed with the two calls the database actually has.
async function transaction(work) {
  const client = await pool.connect();
  try {
    const result = await work(client);
    await client.commit();
    return result;
  } catch (error) {
    // A rollback that itself fails must not replace the error that caused it:
    // the original is the one worth reporting, and the connection is going back
    // to the pool either way.
    await client.rollback().catch(() => {});
    throw error;
  } finally {
    await client.close();
  }
}

// Single-statement writes still explicitly commit or roll back.
transaction.query = (text, values) => transaction((client) => client.query(text, values));
module.exports = transaction;
