const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const profile = require("../controllers/profileController");
const vendor = require("../controllers/vendorController");
const catalog = require("../controllers/adminCatalogController");
const reviews = require("../controllers/reviewController");
const role = require("../controllers/roleController");
const auth = require("../controllers/authController");
const router = express.Router();
router.get("/countries", profile.countries);
router.get("/products/:productId/reviews", reviews.list);
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
router.use("/vendor", requireAuth, requireRole("vendor"));
router.get("/vendor/shops", vendor.shops);
router.post("/vendor/shops", vendor.saveShop);
router.put("/vendor/shops/:shopId", vendor.saveShop);
router.get("/vendor/master-products", catalog.availableMasters);
router.get("/vendor/listings", vendor.listings);
router.post("/vendor/listings", vendor.buy);
router.put("/vendor/listings/:productId", vendor.updateListing);
router.get("/vendor/purchases", vendor.purchases);
router.use("/delivery", requireAuth, requireRole("delivery"));
router.get("/delivery/profile", role.deliveryStatus);
router.put("/delivery/profile", role.updateDeliveryStatus);
router.use("/admin", requireAuth, requireRole("admin"));
router.post("/admin/users", auth.register);
router.put("/admin/users/:userId/status", role.updateUserStatus);
router.get("/admin/catalog-metadata", catalog.metadata);
router.post("/admin/attributes", catalog.createAttribute);
router.post("/admin/categories", catalog.saveCategory);
router.put("/admin/categories/:categoryId", catalog.saveCategory);
router.delete("/admin/categories/:categoryId", catalog.deleteCategory);
router.get("/admin/master-products", catalog.listMasters);
router.post("/admin/master-products", catalog.saveMaster);
router.put("/admin/master-products/:masterId", catalog.saveMaster);
router.delete("/admin/master-products/:masterId", catalog.deleteMaster);
module.exports = router;
