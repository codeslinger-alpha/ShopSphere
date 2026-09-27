const transaction = require("../db/transaction");
const pool = require("../db/pool");
const {
  ADD_CART_ITEM,
  DELETE_CART_ITEM,
  GET_CART_BY_USER_ID,
  GET_CART_ITEM_BY_PRODUCT_ID,
  UPDATE_CART_ITEM,
} = require("../db/queries/cartQueries");

const { PRODUCT_EXISTS } = require("../db/queries/wishlistQueries");
const { parsePositiveInteger } = require("../utils/validation");

async function getCart(req, res) {
  const result = await pool.query(GET_CART_BY_USER_ID, [req.user.user_id]);

  return res.json(result.rows);
}

async function addCartItem(req, res) {
  const productId = parsePositiveInteger(req.body?.prod_id);
  const quantity = parsePositiveInteger(req.body?.quantity);

  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity must be positive integers." });
  }

  // The insert-or-top-up is PL/SQL: Oracle cannot express it as one statement
  // that also reports what it wrote, so the statement carries its own binds.
  const result = await transaction.query(
    ADD_CART_ITEM.text,
    ADD_CART_ITEM.binds(req.user.user_id, productId, quantity),
  );

  if (result.rows.length === 0) {
    const product = await pool.query(PRODUCT_EXISTS, [productId]);
    if (product.rows.length === 0) {
      return res.status(404).json({ message: "Product not found." });
    }
    return res.status(409).json({
      message:
        "This product is unavailable or the requested quantity exceeds stock.",
    });
  }

  return res
    .status(201)
    .json({ message: "Added to cart.", item: result.rows[0] });
}

async function updateCartItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);
  const quantity = parsePositiveInteger(req.body?.quantity);

  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity must be positive integers." });
  }

  // Two statements in one transaction, because Oracle will not return the row's
  // expressions from the UPDATE that changed it. The first is still the whole of
  // the guard — availability, stock and the caller's own cart row are all in its
  // predicate — so a row coming back means the write happened, and the read that
  // follows is reporting it rather than deciding anything.
  const result = await transaction(async (client) => {
    const updated = await client.query(UPDATE_CART_ITEM, [
      quantity,
      req.user.user_id,
      productId,
    ]);
    if (!updated.rows.length) return updated;
    return client.query(GET_CART_ITEM_BY_PRODUCT_ID, [
      req.user.user_id,
      productId,
    ]);
  });

  if (result.rows.length === 0) {
    const cartItem = await pool.query(GET_CART_ITEM_BY_PRODUCT_ID, [
      req.user.user_id,
      productId,
    ]);

    if (cartItem.rows.length === 0) {
      return res.status(404).json({ message: "Cart item not found." });
    }

    return res.status(409).json({
      message: cartItem.rows[0].available
        ? `Only ${cartItem.rows[0].in_stock} units are currently available.`
        : "This product is currently unavailable. You can remove it from your cart.",
      item: cartItem.rows[0], // Return saved quantity/current stock so the UI can recover.
    });
  }

  return res.json({
    message: "Cart quantity updated.",
    item: result.rows[0],
  });
}

async function removeCartItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." });
  }

  const result = await transaction.query(DELETE_CART_ITEM, [
    req.user.user_id,
    productId,
  ]);

  if (result.rows.length === 0) {
    return res.status(404).json({ message: "Cart item not found." });
  }

  return res.status(204).send();
}

module.exports = { addCartItem, getCart, removeCartItem, updateCartItem };
