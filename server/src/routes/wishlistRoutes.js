const express = require("express");
const {
  addWishlistItem,
  getWishlist,
  removeWishlistItem,
} = require("../controllers/wishlistController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

// Wishlists belong to customers and are identified from the verified login cookie.
router.use(requireAuth, requireRole("customer"));

router.route("/").get(getWishlist).post(addWishlistItem);

router.delete("/:productId", removeWishlistItem);

module.exports = router;
