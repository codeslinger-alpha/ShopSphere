const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { FIND_AUTH_USER_BY_ID } = require("../db/queries/authQueries");
const {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  getJwtSecret,
} = require("../utils/authToken");
const { parsePositiveInteger } = require("../utils/validation");

async function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ message: "Authentication is required." });
  }

  try {
    const payload = jwt.verify(token, getJwtSecret());
    const userId = parsePositiveInteger(payload.sub);
    if (!userId || !Number.isInteger(payload.tokenVersion)) {
      throw new jwt.JsonWebTokenError("Invalid session payload.");
    }
    const result = await pool.query(FIND_AUTH_USER_BY_ID, [userId]);

    const user = result.rows[0];

    if (
      !user ||
      user.active_status !== "active" ||
      user.token_version !== payload.tokenVersion
    ) {
      clearAuthCookie(res);
      return res
        .status(401)
        .json({ message: "Your session is no longer valid." });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.NotBeforeError
    ) {
      clearAuthCookie(res);
      return res
        .status(401)
        .json({ message: "Your session is invalid or has expired." });
    }
    console.error("Session lookup error:", error);
    return res
      .status(500)
      .json({ message: "Could not verify your session. Please try again." });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication is required." });
    }

    if (!allowedRoles.includes(req.user.role_name)) {
      return res
        .status(403)
        .json({ message: "You are not allowed to perform this action." });
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole };
