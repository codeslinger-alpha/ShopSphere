const bcrypt = require("bcrypt");
const pool = require("../config/db");
const {
  CREATE_DELIVERY_PERSONNEL,
  COUNTRY_EXISTS,
  CREATE_LOCATION,
  CREATE_USER,
  FIND_ROLE_BY_NAME,
  FIND_USER_BY_EMAIL,
  INCREMENT_TOKEN_VERSION,
} = require("../queries/authQueries");
const {
  BEGIN_TRANSACTION,
  COMMIT_TRANSACTION,
  ROLLBACK_TRANSACTION,
} = require("../queries/transactionQueries");
const {
  clearAuthCookie,
  createAuthToken,
  setAuthCookie,
} = require("../utils/authToken");

const SALT_ROUNDS = 12;
const PUBLIC_ROLES = new Set(["customer", "vendor", "delivery"]);

function cleanRegistrationInput(body, adminCreation = false) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const pfp = typeof body.pfp === "string" ? body.pfp.trim() : null;
  const streetAddress =
    typeof body.street_address === "string" ? body.street_address.trim() : "";
  const postalCode =
    typeof body.postal_code === "string" ? body.postal_code.trim() : null;
  const city = typeof body.city === "string" ? body.city.trim() : "";
  const stateProvince =
    typeof body.state_province === "string" ? body.state_province.trim() : null;
  const countryId =
    typeof body.country_id === "string"
      ? body.country_id.trim().toUpperCase()
      : "";
  const role =
    typeof body.role === "string" ? body.role.trim().toLowerCase() : "customer";

  if (name.length < 2 || name.length > 100) {
    return { error: "Name must be between 2 and 100 characters." };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 60) {
    return { error: "Enter a valid email address." };
  }

  if (password.length < 8 || Buffer.byteLength(password, "utf8") > 72) {
    return {
      error:
        "Password must be at least 8 characters and no more than 72 bytes.",
    };
  }

  if (!PUBLIC_ROLES.has(role) && !(adminCreation && role === "admin")) {
    return { error: "Choose a valid account type." };
  }
  if (!/^\+?[0-9 -]{7,20}$/.test(phone))
    return { error: "Enter a valid phone number." };
  if (!streetAddress || !city || !countryId)
    return { error: "Street address, city, and country are required." };
  if (pfp && !/^https?:\/\/\S+$/i.test(pfp))
    return { error: "Profile image must be a valid http or https URL." };

  if (
    streetAddress.length > 500 ||
    city.length > 100 ||
    (postalCode || "").length > 30 ||
    (stateProvince || "").length > 100 ||
    countryId.length > 10 ||
    (pfp || "").length > 2000
  )
    return { error: "Address or image URL is too long." };
  const vehicle =
    typeof body.vehicle_info === "string" ? body.vehicle_info.trim() : "";
  if (role === "delivery" && (!vehicle || vehicle.length > 500))
    return {
      error: "Vehicle information is required (at most 500 characters).",
    };
  if (body.confirm_password !== undefined && body.confirm_password !== password)
    return { error: "Passwords do not match." };
  return {
    name,
    email,
    password,
    role,
    phone,
    pfp,
    streetAddress,
    postalCode,
    city,
    stateProvince,
    countryId,
    vehicle,
  };
}

function publicUser(user) {
  return {
    user_id: user.user_id,
    name: user.name,
    email: user.email,
    role: user.role_name,
  };
}

async function register(req, res) {
  const adminCreation = req.user?.role_name === "admin";
  const input = cleanRegistrationInput(req.body || {}, adminCreation);

  if (input.error) {
    return res.status(400).json({ message: input.error }); // 400 Bad Request: required input is missing or invalid.
  }

  let client;

  try {
    client = await pool.connect();
    await client.query(BEGIN_TRANSACTION);

    const roleResult = await client.query(FIND_ROLE_BY_NAME, [input.role]);

    if (roleResult.rows.length === 0) {
      await client.query(ROLLBACK_TRANSACTION);
      return res
        .status(400)
        .json({ message: "That account type is unavailable." }); // 400 Bad Request: required input is missing or invalid.
    }
    const country = await client.query(COUNTRY_EXISTS, [input.countryId]);
    if (!country.rows.length) {
      await client.query(ROLLBACK_TRANSACTION);
      return res.status(400).json({ message: "Choose a valid country." }); // 400 Bad Request: unknown country ID.
    }

    const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);
    const location = await client.query(CREATE_LOCATION, [
      input.streetAddress,
      input.postalCode,
      input.city,
      input.stateProvince,
      input.countryId,
    ]);
    const userResult = await client.query(CREATE_USER, [
      roleResult.rows[0].role_id,
      input.name,
      passwordHash,
      input.email,
      input.phone,
      input.pfp,
      location.rows[0].location_id,
    ]);

    const user = {
      ...userResult.rows[0],
      role_name: roleResult.rows[0].role_name,
    };

    if (user.role_name === "delivery") {
      await client.query(CREATE_DELIVERY_PERSONNEL, [
        user.user_id,
        input.vehicle,
      ]);
    }

    const token = adminCreation ? null : createAuthToken(user); // Signing must succeed before saving the account.
    await client.query(COMMIT_TRANSACTION);
    if (token) setAuthCookie(res, token);
    return res
      .status(201)
      .json({ message: "Account created.", user: publicUser(user) }); // 201 Created: a new account or collection item was added.
  } catch (error) {
    if (client) await client.query(ROLLBACK_TRANSACTION).catch(() => {});

    if (error.code === "23505") {
      // PostgreSQL unique_violation: a value duplicates a UNIQUE key.
      return res
        .status(409)
        .json({ message: "An account with that email already exists." }); // 409 Conflict: the request conflicts with existing data or product availability.
    }

    console.error("Registration error:", error);
    return res.status(500).json({ message: "Could not create the account." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  } finally {
    client?.release();
  }
}

async function login(req, res) {
  const email =
    typeof req.body?.email === "string"
      ? req.body.email.trim().toLowerCase()
      : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." }); // 400 Bad Request: required input is missing or invalid.
  }

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 60 ||
    Buffer.byteLength(password, "utf8") > 72
  ) {
    return res
      .status(400)
      .json({
        message: "Enter a valid email and a password of at most 72 bytes.",
      });
  }

  try {
    const result = await pool.query(FIND_USER_BY_EMAIL, [email]);
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ message: "Invalid email or password." }); // 401 Unauthorized: valid login credentials or a valid session are required.
    }

    if (user.active_status !== "active") {
      return res.status(403).json({ message: "This account is disabled." }); // 403 Forbidden: this account is not allowed to perform the action.
    }

    setAuthCookie(res, createAuthToken(user));
    return res.json({ message: "Login successful.", user: publicUser(user) });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({ message: "Could not log in." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function logout(req, res) {
  try {
    await pool.query(INCREMENT_TOKEN_VERSION, [req.user.user_id]);
    clearAuthCookie(res);
    return res.status(204).send(); // 204 No Content: the action succeeded; no response body is sent.
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({ message: "Could not log out." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

function me(req, res) {
  return res.json({ user: publicUser(req.user) });
}

module.exports = { login, logout, me, register };
