// One line per request, printed when the response finishes. Without it the
// terminal shows only the startup banner, so a request that fails in the browser
// leaves no trace of ever having arrived.
//
// Set LOG_REQUESTS=false to quiet it; the integration test scripts do, since the
// suite fires hundreds of requests of its own.
const { loggingEnabled } = require("../utils/logging");

// The status picks the stream, which is what gives errors their colour in the VS
// Code terminal and lets `npm run dev 2>&1 | grep` isolate failures.
function requestLogger(req, res, next) {
  if (!loggingEnabled("LOG_REQUESTS")) return next();
  const startedAt = process.hrtime.bigint();
  res.on("finish", () => {
    const milliseconds = (
      Number(process.hrtime.bigint() - startedAt) / 1e6
    ).toFixed(1);
    // The session is set by requireAuth, which runs after this, so on a public
    // route there is simply no user to name.
    const user = req.user ? ` user=${req.user.user_id}` : "";
    const line = `[api] ${res.statusCode} ${req.method} ${req.originalUrl} ${milliseconds}ms${user}`;
    if (res.statusCode >= 500) console.error(line);
    else if (res.statusCode >= 400) console.warn(line);
    else console.log(line);
  });
  next();
}

module.exports = { requestLogger };
