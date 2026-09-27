// Shared by diagnostics, initialization and the runtime pool.
function connectionOptions() {
  for (const key of ["DB_USER", "DB_PASSWORD", "DB_CONNECT_STRING"])
    if (!process.env[key]) throw new Error(`${key} must be set in server/.env.`);
  const wallet = process.env.DB_WALLET_LOCATION || undefined;
  return {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
    configDir: wallet,
    walletLocation: wallet,
    walletPassword: process.env.DB_WALLET_PASSWORD || undefined,
    transportConnectTimeout: 10,
    retryCount: 0,
  };
}

module.exports = { connectionOptions };
