const jwt = require("jsonwebtoken");

const AUTH_COOKIE_NAME = "shopsphere_token";
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;

    if (!secret || secret.length < 32) {
        throw new Error("JWT_SECRET must be set to a value with at least 32 characters.");
    }

    return secret;
}

function cookieOptions() {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/"
    };
}

function createAuthToken(user) {
    return jwt.sign(
        {
            sub: String(user.user_id),
            tokenVersion: user.token_version
        },
        getJwtSecret(),
        { expiresIn: "1d" }
    );
}

function setAuthCookie(res, token) {
    res.cookie(AUTH_COOKIE_NAME, token, {
        ...cookieOptions(),
        maxAge: COOKIE_MAX_AGE_MS
    });
}

function clearAuthCookie(res) {
    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
}

module.exports = {
    AUTH_COOKIE_NAME,
    clearAuthCookie,
    createAuthToken,
    getJwtSecret,
    setAuthCookie
};
