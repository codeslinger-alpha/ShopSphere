const express = require("express");
const {
  getProduct,
  healthCheck,
  listCategories,
  listProducts,
  listRoles,
  listShops,
  listUsers,
} = require("../controllers/catalogController");
const { requireAuth, requireRole } = require("../middleware/authMiddleware");

const router = express.Router();

router.get("/health", healthCheck);
router.get("/roles", listRoles);
router.get("/products", listProducts);
router.get("/products/:productId", getProduct);
router.get("/categories", listCategories);
router.get("/shops", listShops);
router.get("/users", requireAuth, requireRole("admin"), listUsers);

module.exports = router;
