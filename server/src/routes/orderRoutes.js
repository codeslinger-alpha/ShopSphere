const express = require("express");
const orders = require("../controllers/orderController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// Buying is a customer feature: a vendor or courier has a cart of their own to
// shop with only because they are also a customer account, and the seeded roles
// are separate accounts. Courier-facing order actions live in roleRoutes.js under
// /delivery, where that role's guard already applies.
router.use(requireAuth, requireRole("customer"));

router.route("/").get(orders.listOrders).post(orders.placeOrder);

router.get("/:orderId", orders.getOrder);
router.put("/:orderId/cancel", orders.cancelOrder);

module.exports = router;
