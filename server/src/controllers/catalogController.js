const pool = require("../config/db");
const {
  GET_PRODUCT_BY_ID,
  LIST_CATEGORIES,
  LIST_PRODUCTS,
  LIST_ROLES,
  LIST_SHOPS,
  LIST_USERS,
} = require("../queries/catalogQueries");
const { CHECK_DATABASE_CONNECTION } = require("../queries/systemQueries");

const { parsePositiveInteger } = require("../utils/validation");

async function listRoles(req, res) {
  try {
    const result = await pool.query(LIST_ROLES);
    return res.json(result.rows);
  } catch (error) {
    console.error("List roles error:", error);
    return res.status(500).json({ message: "Could not load roles." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function listProducts(req, res) {
  try {
    const result = await pool.query(LIST_PRODUCTS);
    return res.json(result.rows);
  } catch (error) {
    console.error("List products error:", error);
    return res.status(500).json({ message: "Could not load products." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function getProduct(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(GET_PRODUCT_BY_ID, [productId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Product not found." }); // 404 Not Found: the requested route or record could not be found.
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error("Get product error:", error);
    return res.status(500).json({ message: "Could not load the product." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function listCategories(req, res) {
  try {
    const result = await pool.query(LIST_CATEGORIES);
    return res.json(result.rows);
  } catch (error) {
    console.error("List categories error:", error);
    return res.status(500).json({ message: "Could not load categories." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function listShops(req, res) {
  try {
    const result = await pool.query(LIST_SHOPS);
    return res.json(result.rows);
  } catch (error) {
    console.error("List shops error:", error);
    return res.status(500).json({ message: "Could not load shops." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function listUsers(req, res) {
  try {
    const result = await pool.query(LIST_USERS);
    return res.json(result.rows);
  } catch (error) {
    console.error("List users error:", error);
    return res.status(500).json({ message: "Could not load users." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function healthCheck(req, res) {
  try {
    const result = await pool.query(CHECK_DATABASE_CONNECTION);
    return res.json({
      success: true,
      database: result.rows[0].database_connected === 1,
    });
  } catch (error) {
    return res
      .status(503)
      .json({ success: false, message: "Database is unavailable." }); // 503 Service Unavailable: the database is currently unreachable.
  }
}

module.exports = {
  getProduct,
  healthCheck,
  listCategories,
  listProducts,
  listRoles,
  listShops,
  listUsers,
};
