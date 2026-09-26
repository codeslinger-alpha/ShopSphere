const transaction = require("../db/transaction");
const pool = require("../db/pool");
const {
  ADD_WISHLIST_ITEM,
  DELETE_WISHLIST_ITEM,
  GET_WISHLIST_BY_USER_ID,
  PRODUCT_EXISTS,
  WISHLIST_ITEM_EXISTS,
} = require("../db/queries/wishlistQueries");

const { parsePositiveInteger } = require("../utils/validation");

async function getWishlist(req, res) {
  const result = await pool.query(GET_WISHLIST_BY_USER_ID, [
    req.user.user_id,
  ]);

  return res.json(result.rows);
}

async function addWishlistItem(req, res) {
  const productId = parsePositiveInteger(req.body?.prod_id);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." });
  }

  const result = await transaction.query(ADD_WISHLIST_ITEM, [
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
        .json({ message: "Product is already in your wishlist." });
    }

    const product = await pool.query(PRODUCT_EXISTS, [productId]);

    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }

    return res
      .status(409)
      .json({ message: "This product is currently unavailable." });
  }

  return res
    .status(201)
    .json({ message: "Added to wishlist.", item: result.rows[0] });
}

async function removeWishlistItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." });
  }

  const result = await transaction.query(DELETE_WISHLIST_ITEM, [
    req.user.user_id,
    productId,
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "Wishlist item not found." });
  }

  return res.status(204).send();
}

module.exports = { addWishlistItem, getWishlist, removeWishlistItem };
