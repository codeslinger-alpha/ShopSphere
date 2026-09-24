const express = require("express");
const {
  getProduct,
  healthCheck,
  listCategories,
  listProductFacets,
  listProducts,
  listRoles,
  listShops,
} = require("../controllers/catalogController");

const router = express.Router();

router.get("/health", healthCheck);
router.get("/roles", listRoles);
router.get("/products", listProducts);
// Must stay above /products/:productId: Express matches in order, and the
// literal path would otherwise be read as a product ID and rejected with a 400.
router.get("/products/facets", listProductFacets);
router.get("/products/:productId", getProduct);
router.get("/categories", listCategories);
router.get("/shops", listShops);

module.exports = router;
