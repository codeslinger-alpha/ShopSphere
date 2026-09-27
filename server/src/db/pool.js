const oracledb = require("oracledb");
const { pooledQuery, session } = require("./execute");
const { connectionOptions } = require("./config");

// Text columns are CLOB, and the application has always read them as strings —
// node-pg handed a text column back as a string, and the review forms, the
// listing descriptions and the model validators all expect one. Without this the
// driver would hand back a Lob object instead.
oracledb.fetchAsString = [oracledb.CLOB];

// The database is an Autonomous Database reached through a wallet, so
// DB_CONNECT_STRING names an alias in the wallet's own tnsnames.ora rather than
// a host and port. The driver can only resolve that alias if it is told where
// the wallet is, which is what DB_WALLET_LOCATION is for: the same directory
// holds the alias definition and the credentials the TCPS handshake needs.

// node-oracledb builds a pool asynchronously, where pg's Pool was ready when its
// constructor returned, so the wait is memoised: the first statement pays for it
// and every later one joins the pool that already exists.
let opening = null;

function open() {
  opening ??= oracledb.createPool({
    ...connectionOptions(),
    poolMin: 1,
    poolMax: 10,
    poolTimeout: 60,
  }).catch((error) => { opening = null; throw error; });
  return opening;
}

// Every non-transactional query in the codebase reaches the database through
// pool.query. A connection of its own per statement, closed in a finally, which
// is what pg's Pool did underneath.
async function query(text, values) {
  const connection = await (await open()).getConnection();
  try {
    return await pooledQuery(connection, text, values);
  } finally {
    await connection.close();
  }
}

async function connect() {
  return session(await (await open()).getConnection());
}

async function end() {
  if (!opening) return;
  const created = await opening;
  opening = null;
  await created.close(0);
}

module.exports = { connect, end, query };
