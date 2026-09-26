const pool = require("../db/pool");
const transaction = require("../db/transaction");
const v = require("../utils/input");
const { CREATE_LOCATION } = require("../db/queries/authQueries");
const q = require("../db/queries/profileQueries");
async function countries(req, res) {
  res.json(
    (
      await pool.query(q.LIST_COUNTRIES)
    ).rows,
  );
}
async function getProfile(req, res) {
  res.json((await pool.query(q.PROFILE, [req.user.user_id])).rows[0]);
}
async function updateProfile(req, res) {
  const b = req.body || {},
    name = v.string(b.name, "Name", 100, true),
    phone = v.phone(b.phone),
    pfp = v.url(b.pfp),
    location = v.address(b);
  const email = v.string(b.email, "Email", 60, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    v.fail(400, "Enter a valid email address.");
  const vehicle = v.string(
    b.vehicle_info,
    "Vehicle information",
    500,
    req.user.role_name === "delivery",
  );
  const profile = await transaction(async (c) => {
    // No explicit row lock on users is needed, and an earlier one was removed:
    // UPDATE_PROFILE below takes that same row lock itself, so a second save of
    // this profile waits there. Taking it here instead would only have held the
    // lock across the address insert, which touches no row the lock protects.
    // Insert a new address so shared shop addresses and old orders remain unchanged.
    const address = await c.query(CREATE_LOCATION, location);
    await c.query(
      q.UPDATE_PROFILE,
      [name, email, phone, pfp, address.rows[0].location_id, req.user.user_id],
    );
    if (req.user.role_name === "delivery")
      await c.query(
        q.UPDATE_DELIVERY_VEHICLE,
        [vehicle, req.user.user_id],
      );
    return (await c.query(q.PROFILE, [req.user.user_id])).rows[0];
  });
  res.json({ message: "Profile saved.", profile });
}
module.exports = { countries, getProfile, updateProfile };
