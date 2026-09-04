const express = require("express");
const {
    addCartItem,
    getCart,
    removeCartItem,
    updateCartItem
} = require("../controllers/cartController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// A cart is a customer feature. Every request must carry a valid login cookie.
router.use(requireAuth, requireRole("customer"));

router.route("/")
    .get(getCart)
    .post(addCartItem);

router.route("/:productId")
    .put(updateCartItem)
    .delete(removeCartItem);

module.exports = router;
