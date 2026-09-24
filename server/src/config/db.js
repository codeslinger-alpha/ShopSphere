const { Pool } = require("pg");
const { timedQuery } = require("../utils/sqlLogger");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  connectionTimeoutMillis: 10000,
});

// Every non-transactional query in the codebase reaches the database through
// pool.query, so wrapping it here covers all of them at once. The original is
// bound before being replaced: the wrapper calls it as a plain function, and pg's
// implementation needs its own `this`.
const query = pool.query.bind(pool);
pool.query = (text, values) => timedQuery({ query }, text, values);

module.exports = pool;
