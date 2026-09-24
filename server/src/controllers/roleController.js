const pool = require("../config/db");
const q = require("../queries/roleQueries");
const v = require("../utils/input");

// The same three values the schema's CHECK allows. 'on_delivery' is a courier's
// own declaration that they are mid-run; nothing sets it on their behalf.
const AVAILABILITY = ["available", "on_delivery", "unavailable"];
// A closed list keeps a typo out of the column, and gives the workspace something
// to render as a select rather than a free-text box.
const VEHICLE_TYPES = ["motorcycle", "car", "van", "bicycle"];

async function deliveryStatus(req, res) {
  try {
    const result = await pool.query(q.GET_DELIVERY_PROFILE, [req.user.user_id]);
    return res.json(result.rows[0] || {});
  } catch (error) {
    console.error("Get delivery profile error:", error);
    return res
      .status(500)
      .json({ message: "Could not load your delivery profile." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function updateDeliveryStatus(req, res) {
  const status = req.body?.active_status;
  if (!AVAILABILITY.includes(status))
    v.fail(400, "Choose a valid availability.");

  const vehicleType = v.string(req.body?.vehicle_type, "Vehicle type", 40);
  if (vehicleType && !VEHICLE_TYPES.includes(vehicleType))
    v.fail(400, `Vehicle type must be one of: ${VEHICLE_TYPES.join(", ")}.`);

  // Only vehicle_info is required. A courier who walks their deliveries has no
  // registration to give, and demanding one would lock them out of the workspace
  // they need to go on duty.
  const fields = [
    status,
    v.string(req.body?.vehicle_info, "Vehicle information", 500, true),
    vehicleType,
    v.string(req.body?.vehicle_number, "Vehicle number", 40),
    v.string(req.body?.license_number, "Licence number", 60),
    v.string(req.body?.vehicle_model, "Vehicle model", 100),
  ];

  try {
    const profile = (
      await pool.query(q.UPDATE_DELIVERY_PROFILE, [
        ...fields,
        req.user.user_id,
      ])
    ).rows[0];
    return res.json({ message: "Delivery availability updated.", profile });
  } catch (error) {
    console.error("Update delivery profile error:", error);
    return res
      .status(500)
      .json({ message: "Could not update your delivery profile." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

module.exports = { deliveryStatus, updateDeliveryStatus };
