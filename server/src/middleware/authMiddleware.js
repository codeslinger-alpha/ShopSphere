const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { FIND_AUTH_USER_BY_ID } = require("../queries/userQueries");
const {
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  getJwtSecret,
} = require("../utils/authToken");
const { parsePositiveInteger } = require("../utils/validation");

async function requireAuth(req, res, next) {
  const token = req.cookies?.[AUTH_COOKIE_NAME];

  if (!token) {
    return res.status(401).json({ message: "Authentication is required." }); // 401 Unauthorized: valid login credentials or a valid session are required.
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
        .json({ message: "Your session is no longer valid." }); // 401 Unauthorized: valid login credentials or a valid session are required.
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
        .json({ message: "Your session is invalid or has expired." }); // 401 Unauthorized: the login token is invalid.
    }
    console.error("Session lookup error:", error);
    return res
      .status(500)
      .json({ message: "Could not verify your session. Please try again." }); // 500 Internal Server Error: infrastructure failed; preserve the login cookie.
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Authentication is required." }); // 401 Unauthorized: valid login credentials or a valid session are required.
    }

    if (!allowedRoles.includes(req.user.role_name)) {
      return res
        .status(403)
        .json({ message: "You are not allowed to perform this action." }); // 403 Forbidden: this account is not allowed to perform the action.
    }

    return next();
  };
}

module.exports = { requireAuth, requireRole };
