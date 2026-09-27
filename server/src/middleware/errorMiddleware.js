const { loggingEnabled } = require("../utils/logging");

// What the database refuses by itself, in the numbers this database reports it
// under. PostgreSQL named these with SQLSTATE strings — 23505, 23503, 23514 —
// and Oracle names them with a number, which node-oracledb exposes as
// `errorNum`, the same field the query adapter reads 1403 from. The grouping is
// the one the API already had: a duplicate is a conflict, a reference that leads
// nowhere is the caller's mistake, and anything else the schema declines to store
// is a value it will not take.
//
// 2292 — a row still referenced somewhere — is listed beside 2291 rather than
// left to fall through to a 500, because both mean the same thing to a caller:
// the record they named is the wrong one to name.
const INTEGRITY = {
  1: [409, "This record already exists."],
  2290: [400, "Values violate a required database constraint."],
  1400: [400, "Values violate a required database constraint."],
  1438: [400, "Values violate a required database constraint."],
  1722: [400, "Values violate a required database constraint."],
  12899: [400, "Values violate a required database constraint."],
  2291: [
    400,
    "A referenced country, category, attribute, or record does not exist.",
  ],
  2292: [
    400,
    "A referenced country, category, attribute, or record does not exist.",
  ],
};

// The sentence a trigger raised, without the code in front of it or the
// documentation link behind it.
function raisedMessage(error) {
  const colon = error.message.indexOf(":");
  const sentence = colon === -1 ? error.message : error.message.slice(colon + 1);
  return sentence.split("\n")[0].trim();
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);

  // The request logger reports the status of every response, but a 4xx returned
  // from here carries no other trace. A rejected body or a constraint violation
  // would show up as a bare number, with nothing saying which rule was broken.
  // Naming the reason is the difference between a terminal that explains itself
  // and one that only reports that something failed.
  const reject = (status, message) => {
    // The 500 path below always logs: an unexpected failure is worth seeing even
    // where request logging is turned off. A 4xx is routine traffic — the API
    // answers plenty of them by design — so it follows the same switch.
    if (loggingEnabled("LOG_REQUESTS"))
      console.error(
        `[api] ${status} ${req.method} ${req.originalUrl} — ${message}`,
      );
    return res.status(status).json({ message });
  };

  if (error.status && error.status >= 400 && error.status < 500 && !error.type)
    return reject(error.status, error.message);

  const integrity = INTEGRITY[error.errorNum];
  if (integrity) return reject(integrity[0], integrity[1]);

  // RAISE_APPLICATION_ERROR is how a trigger refuses something and says why —
  // "Only a delivered order can be returned." PostgreSQL handed that sentence
  // over as it was written; Oracle prefixes its own code to it and this driver
  // appends a link to the code's documentation, so the sentence is what is left
  // between the two. Ranging over the block the schema reserved for itself
  // (-20001 to -20007) rather than naming each code keeps the message handler
  // from having to be edited every time a trigger is added.
  if (error.errorNum >= 20000 && error.errorNum <= 20999)
    return reject(409, raisedMessage(error));
  if (error.type === "entity.parse.failed")
    return reject(400, "Request body must contain valid JSON.");
  if (error.type === "entity.too.large")
    return reject(413, "Request body is too large.");
  console.error(`[api] 500 ${req.method} ${req.originalUrl}`);
  console.error("Unhandled request error:", error);
  return res
    .status(500)
    .json({ message: "An unexpected server error occurred." });
}

module.exports = { errorHandler };
