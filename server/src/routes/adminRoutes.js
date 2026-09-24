const express = require("express");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");
const auth = require("../controllers/authController");
const admin = require("../controllers/adminController");
const catalog = require("../controllers/adminCatalogController");
const payments = require("../controllers/paymentController");

const router = express.Router();

// Every route in this file is administrative. Guarding the whole router once
// means a new endpoint cannot be added without a role check by omission.
router.use(requireAuth, requireRole("admin"));

router.get("/users", admin.listUsers);
router.post("/users", auth.register);
router.put("/users/:userId/status", admin.updateUserStatus);

router.get("/shops", admin.listShops);
router.put("/shops/:shopId/status", admin.updateShopStatus);
// A shop's listings, with the refund each removal would pay — the admin path is
// a separate controller from the vendor's own listing view, so a vendor cannot
// reach this even by guessing the shop id.
router.get("/shops/:shopId/listings", catalog.listShopListings);

router.get("/catalog-metadata", catalog.metadata);
router.post("/attributes", catalog.createAttribute);
router.post("/categories", catalog.saveCategory);
router.put("/categories/:categoryId", catalog.saveCategory);
router.delete("/categories/:categoryId", catalog.deleteCategory);
router.get("/master-products", catalog.listMasters);
router.post("/master-products", catalog.saveMaster);
router.put("/master-products/:masterId", catalog.saveMaster);
// Discontinues the master and refunds every vendor still holding stock of it.
router.delete("/master-products/:masterId", catalog.deleteMaster);
router.put("/listings/:prodId/discontinue", catalog.removeListing);

// The money the rest of the schema records but nobody could read.
router.get("/payments", payments.listPayments);
router.get("/refunds", payments.listRefunds);

module.exports = router;
