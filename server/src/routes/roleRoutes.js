const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const profile = require("../controllers/profileController");
const vendor = require("../controllers/vendorController");
const catalog = require("../controllers/adminCatalogController");
const reviews = require("../controllers/reviewController");
const shopReviews = require("../controllers/shopReviewController");
const payments = require("../controllers/paymentController");
const role = require("../controllers/roleController");
const order = require("../controllers/orderController");
const router = express.Router();
router.get("/countries", profile.countries);
router.get("/products/:productId/reviews", reviews.list);
// Public, like the listing's reviews beside it: a shop's rating is part of what
// a shopper is deciding on, and reading it needs no account.
router.get("/shops/:shopId/reviews", shopReviews.list);
router.get("/profile", requireAuth, profile.getProfile);
router.put("/profile", requireAuth, profile.updateProfile);
router.get(
  "/products/:productId/review-eligibility",
  requireAuth,
  requireRole("customer"),
  reviews.eligibility,
);
router.put(
  "/products/:productId/review",
  requireAuth,
  requireRole("customer"),
  reviews.save,
);
router.delete(
  "/products/:productId/review",
  requireAuth,
  requireRole("customer"),
  reviews.remove,
);
// A shop review is gated on a delivered order from that shop, so it follows the
// product-review trio exactly; the difference is the proof, not the guard.
router.get(
  "/shops/:shopId/review-eligibility",
  requireAuth,
  requireRole("customer"),
  shopReviews.eligibility,
);
router.put(
  "/shops/:shopId/review",
  requireAuth,
  requireRole("customer"),
  shopReviews.save,
);
router.delete(
  "/shops/:shopId/review",
  requireAuth,
  requireRole("customer"),
  shopReviews.remove,
);
// A customer's own payment history. Scoped to the caller inside the query, so
// there is no parameter here through which to ask for anybody else's.
router.get(
  "/account/payments",
  requireAuth,
  requireRole("customer"),
  payments.accountPayments,
);
router.use("/vendor", requireAuth, requireRole("vendor"));
router.get("/vendor/shops", vendor.shops);
router.post("/vendor/shops", vendor.saveShop);
router.put("/vendor/shops/:shopId", vendor.saveShop);
router.get("/vendor/master-products", catalog.availableMasters);
router.get("/vendor/listings", vendor.listings);
router.post("/vendor/listings", vendor.buy);
router.put("/vendor/listings/:productId", vendor.updateListing);
router.get("/vendor/purchases", vendor.purchases);
// Sales, purchases, refunds and the earnings balance in one response: the four
// belong on one screen, and four round trips to build one page is three more
// than it needs.
router.get("/vendor/payments", payments.vendorPayments);
router.use("/delivery", requireAuth, requireRole("delivery"));
router.get("/delivery/profile", role.deliveryStatus);
router.put("/delivery/profile", role.updateDeliveryStatus);
// The courier's run. These are order endpoints, but they belong behind this
// guard rather than the customer one in orderRoutes.js.
router.get("/delivery/deliveries", order.listDeliveries);
router.put("/delivery/orders/:orderId/status", order.advanceDelivery);
// The /admin surface lives in adminRoutes.js, mounted at /api/admin.
module.exports = router;
