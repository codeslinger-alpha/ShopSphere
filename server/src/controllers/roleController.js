const pool = require("../config/db");
const { parsePositiveInteger } = require("../utils/validation");
const q = require("../queries/roleQueries");

async function deliveryStatus(req, res) {
  const result = await pool.query(q.GET_DELIVERY_PROFILE, [req.user.user_id]);
  return res.json(result.rows[0] || {});
}
async function updateDeliveryStatus(req, res) {
  const v = require("../utils/input");
  const status = req.body?.active_status;
  if (!["available", "unavailable"].includes(status))
    v.fail(400, "Choose a valid availability.");
  const vehicle = v.string(
    req.body?.vehicle_info,
    "Vehicle information",
    500,
    true,
  );
  const profile = (
    await pool.query(q.UPDATE_DELIVERY_PROFILE, [status, vehicle, req.user.user_id])
  ).rows[0];
  return res.json({ message: "Delivery availability updated.", profile });
}
async function updateUserStatus(req, res) {
  const id = parsePositiveInteger(req.params.userId),
    status = req.body?.active_status;
  if (!id || !["active", "disabled"].includes(status))
    return res
      .status(400)
      .json({
        message: "A user ID and active or disabled status are required.",
      }); // 400 Bad Request: invalid status.
  if (id === req.user.user_id)
    return res
      .status(409)
      .json({ message: "You cannot disable your own administrator account." }); // 409 Conflict: prevents loss of admin access.
  const result = await pool.query(q.UPDATE_USER_STATUS, [status, id]);
  if (!result.rows.length)
    return res.status(404).json({ message: "User not found." }); // 404 Not Found: no such user.
  return res.json({ message: "User status updated.", user: result.rows[0] });
}

module.exports = { deliveryStatus, updateDeliveryStatus, updateUserStatus };
