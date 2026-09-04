const jwt = require("jsonwebtoken");
const pool = require("../config/db");
const { AUTH_COOKIE_NAME, clearAuthCookie, getJwtSecret } = require("../utils/authToken");

async function requireAuth(req, res, next) {
    const token = req.cookies[AUTH_COOKIE_NAME];

    if (!token) {
        return res.status(401).json({ message: "Authentication is required." });
    }

    try {
        const payload = jwt.verify(token, getJwtSecret());
        const result = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.active_status, u.token_version,
                    r.role_id, r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.user_role
             WHERE u.user_id = $1`,
            [Number(payload.sub)]
        );

        const user = result.rows[0];

        if (!user || user.active_status !== "active" || user.token_version !== payload.tokenVersion) {
            clearAuthCookie(res);
            return res.status(401).json({ message: "Your session is no longer valid." });
        }

        req.user = user;
        return next();
    } catch (error) {
        clearAuthCookie(res);
        return res.status(401).json({ message: "Your session is invalid or has expired." });
    }
}

function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ message: "Authentication is required." });
        }

        if (!allowedRoles.includes(req.user.role_name)) {
            return res.status(403).json({ message: "You are not allowed to perform this action." });
        }

        return next();
    };
}

module.exports = { requireAuth, requireRole };
