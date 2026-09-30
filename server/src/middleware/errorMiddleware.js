const { loggingEnabled } = require("../utils/logging");
const { cyan, status } = require("../utils/color");

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  // The request logger reports the status of every response, but a 4xx returned
  // from here carries no other trace. A rejected body or a constraint violation
  // would show up as a bare number, with nothing saying which rule was broken.
  // Naming the reason is the difference between a terminal that explains itself
  // and one that only reports that something failed.
  const reject = (code, message) => {
    // The 500 path below always logs: an unexpected failure is worth seeing even
    // where request logging is turned off. A 4xx is routine traffic — the API
    // answers plenty of them by design — so it follows the same switch.
    if (loggingEnabled("LOG_REQUESTS"))
      console.error(
        `${cyan("[api]")} ${status(code)} ${req.method} ${req.originalUrl} — ${message}`,
      );
    return res.status(code).json({ message });
  };

  if (error.status && error.status >= 400 && error.status < 500 && !error.type)
    return reject(error.status, error.message);
  if (error.code === "23505")
    return reject(409, "This record already exists.");
  if (error.code === "23503")
    return reject(
      400,
      "A referenced country, category, attribute, or record does not exist.",
    );
  if (["23514", "23502", "22003", "22P02"].includes(error.code))
    return reject(400, "Values violate a required database constraint.");
  if (error.code === "P0001") return reject(409, error.message);
  if (error.type === "entity.parse.failed")
    return reject(400, "Request body must contain valid JSON.");
  if (error.type === "entity.too.large")
    return reject(413, "Request body is too large.");
  console.error(`${cyan("[api]")} ${status(500)} ${req.method} ${req.originalUrl}`);
  console.error("Unhandled request error:", error);
  return res
    .status(500)
    .json({ message: "An unexpected server error occurred." });
}

module.exports = { errorHandler };
