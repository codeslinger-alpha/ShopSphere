const bcrypt = require("bcrypt");
const pool = require("../config/db");
const { clearAuthCookie, createAuthToken, setAuthCookie } = require("../utils/authToken");

const SALT_ROUNDS = 12;
const PUBLIC_ROLES = new Set(["customer", "vendor", "delivery"]);

function cleanRegistrationInput(body) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const role = typeof body.role === "string" ? body.role.trim().toLowerCase() : "customer";

    if (name.length < 2 || name.length > 100) {
        return { error: "Name must be between 2 and 100 characters." };
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 60) {
        return { error: "Enter a valid email address." };
    }

    if (password.length < 8 || password.length > 128) {
        return { error: "Password must be between 8 and 128 characters." };
    }

    if (!PUBLIC_ROLES.has(role)) {
        return { error: "Choose a valid account type." };
    }

    return { name, email, password, role };
}

function publicUser(user) {
    return {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        role: user.role_name
    };
}

async function register(req, res) {
    const input = cleanRegistrationInput(req.body || {});

    if (input.error) {
        return res.status(400).json({ message: input.error });
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const roleResult = await client.query(
            "SELECT role_id, role_name FROM roles WHERE role_name = $1",
            [input.role]
        );

        if (roleResult.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(400).json({ message: "That account type is unavailable." });
        }

        const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
        const userResult = await client.query(
            `INSERT INTO users (user_role, name, password_hash, email)
             VALUES ($1, $2, $3, $4)
             RETURNING user_id, name, email, token_version`,
            [roleResult.rows[0].role_id, input.name, passwordHash, input.email]
        );

        const user = { ...userResult.rows[0], role_name: roleResult.rows[0].role_name };

        if (user.role_name === "delivery") {
            await client.query(
                "INSERT INTO delivery_personnel (delivery_person_id) VALUES ($1)",
                [user.user_id]
            );
        }

        await client.query("COMMIT");
        setAuthCookie(res, createAuthToken(user));
        return res.status(201).json({ message: "Account created.", user: publicUser(user) });
    } catch (error) {
        await client.query("ROLLBACK");

        if (error.code === "23505") {
            return res.status(409).json({ message: "An account with that email already exists." });
        }

        console.error("Registration error:", error);
        return res.status(500).json({ message: "Could not create the account." });
    } finally {
        client.release();
    }
}

async function login(req, res) {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
    }

    try {
        const result = await pool.query(
            `SELECT u.user_id, u.name, u.email, u.password_hash, u.active_status, u.token_version,
                    r.role_name
             FROM users u
             JOIN roles r ON r.role_id = u.user_role
             WHERE u.email = $1`,
            [email]
        );
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        if (user.active_status !== "active") {
            return res.status(403).json({ message: "This account is disabled." });
        }

        setAuthCookie(res, createAuthToken(user));
        return res.json({ message: "Login successful.", user: publicUser(user) });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ message: "Could not log in." });
    }
}

async function logout(req, res) {
    try {
        await pool.query(
            "UPDATE users SET token_version = token_version + 1 WHERE user_id = $1",
            [req.user.user_id]
        );
        clearAuthCookie(res);
        return res.status(204).send();
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({ message: "Could not log out." });
    }
}

function me(req, res) {
    return res.json({ user: publicUser(req.user) });
}

module.exports = { login, logout, me, register };
