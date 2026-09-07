const pool = require("../config/db");
const {
  ADD_WISHLIST_ITEM,
  DELETE_WISHLIST_ITEM,
  GET_WISHLIST_BY_USER_ID,
  PRODUCT_EXISTS,
  WISHLIST_ITEM_EXISTS,
} = require("../queries/wishlistQueries");

const { parsePositiveInteger } = require("../utils/validation");

async function getWishlist(req, res) {
  try {
    const result = await pool.query(GET_WISHLIST_BY_USER_ID, [
      req.user.user_id,
    ]);

    return res.json(result.rows);
  } catch (error) {
    console.error("Get wishlist error:", error);
    return res.status(500).json({ message: "Could not load the wishlist." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function addWishlistItem(req, res) {
  const productId = parsePositiveInteger(req.body?.prod_id);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(ADD_WISHLIST_ITEM, [
      req.user.user_id,
      productId,
    ]);

    if (result.rows.length === 0) {
      const existingItem = await pool.query(WISHLIST_ITEM_EXISTS, [
        req.user.user_id,
        productId,
      ]);

      if (existingItem.rows.length > 0) {
        return res
          .status(200)
          .json({ message: "Product is already in your wishlist." }); // 200 OK: the request succeeded.
      }

      const product = await pool.query(PRODUCT_EXISTS, [productId]);

      if (product.rows.length === 0) {
        return res.status(404).json({ message: "Product not found." }); // 404 Not Found: the requested route or record could not be found.
      }

      return res
        .status(409)
        .json({ message: "This product is currently unavailable." }); // 409 Conflict: the request conflicts with existing data or product availability.
    }

    return res
      .status(201)
      .json({ message: "Added to wishlist.", item: result.rows[0] }); // 201 Created: a new account or collection item was added.
  } catch (error) {
    console.error("Add wishlist item error:", error);
    return res
      .status(500)
      .json({ message: "Could not add the item to the wishlist." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function removeWishlistItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(DELETE_WISHLIST_ITEM, [
      req.user.user_id,
      productId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Wishlist item not found." }); // 404 Not Found: the requested route or record could not be found.
    }

    return res.status(204).send(); // 204 No Content: the action succeeded; no response body is sent.
  } catch (error) {
    console.error("Remove wishlist item error:", error);
    return res
      .status(500)
      .json({ message: "Could not remove the wishlist item." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

module.exports = { addWishlistItem, getWishlist, removeWishlistItem };
