const pool = require("../config/db");
const {
  ADD_CART_ITEM,
  DELETE_CART_ITEM,
  GET_CART_BY_USER_ID,
  GET_CART_ITEM_BY_PRODUCT_ID,
  UPDATE_CART_ITEM,
} = require("../queries/cartQueries");

const { PRODUCT_EXISTS } = require("../queries/wishlistQueries");
const { parsePositiveInteger } = require("../utils/validation");

async function getCart(req, res) {
  try {
    const result = await pool.query(GET_CART_BY_USER_ID, [req.user.user_id]);

    return res.json(result.rows);
  } catch (error) {
    console.error("Get cart error:", error);
    return res.status(500).json({ message: "Could not load the cart." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function addCartItem(req, res) {
  const productId = parsePositiveInteger(req.body?.prod_id);
  const quantity = parsePositiveInteger(req.body?.quantity);

  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity must be positive integers." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(ADD_CART_ITEM, [
      req.user.user_id,
      productId,
      quantity,
    ]);

    if (result.rows.length === 0) {
      const product = await pool.query(PRODUCT_EXISTS, [productId]);
      if (product.rows.length === 0) {
        return res.status(404).json({ message: "Product not found." }); // 404 Not Found: this product ID does not exist.
      }
      return res.status(409).json({
        // 409 Conflict: the request conflicts with existing data or product availability.
        message:
          "This product is unavailable or the requested quantity exceeds stock.",
      });
    }

    return res
      .status(201)
      .json({ message: "Added to cart.", item: result.rows[0] }); // 201 Created: a new account or collection item was added.
  } catch (error) {
    console.error("Add cart item error:", error);
    return res
      .status(500)
      .json({ message: "Could not add the item to the cart." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function updateCartItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);
  const quantity = parsePositiveInteger(req.body?.quantity);

  if (!productId || !quantity) {
    return res
      .status(400)
      .json({ message: "Product ID and quantity must be positive integers." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(UPDATE_CART_ITEM, [
      quantity,
      req.user.user_id,
      productId,
    ]);

    if (result.rows.length === 0) {
      const cartItem = await pool.query(GET_CART_ITEM_BY_PRODUCT_ID, [
        req.user.user_id,
        productId,
      ]);

      if (cartItem.rows.length === 0) {
        return res.status(404).json({ message: "Cart item not found." }); // 404 Not Found: the requested route or record could not be found.
      }

      return res.status(409).json({
        // 409 Conflict: the request conflicts with existing data or product availability.
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
  } catch (error) {
    console.error("Update cart item error:", error);
    return res.status(500).json({ message: "Could not update the cart item." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

async function removeCartItem(req, res) {
  const productId = parsePositiveInteger(req.params.productId);

  if (!productId) {
    return res
      .status(400)
      .json({ message: "Product ID must be a positive integer." }); // 400 Bad Request: required input is missing or invalid.
  }

  try {
    const result = await pool.query(DELETE_CART_ITEM, [
      req.user.user_id,
      productId,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Cart item not found." }); // 404 Not Found: the requested route or record could not be found.
    }

    return res.status(204).send(); // 204 No Content: the action succeeded; no response body is sent.
  } catch (error) {
    console.error("Remove cart item error:", error);
    return res.status(500).json({ message: "Could not remove the cart item." }); // 500 Internal Server Error: an unexpected server or database failure occurred.
  }
}

module.exports = { addCartItem, getCart, removeCartItem, updateCartItem };
