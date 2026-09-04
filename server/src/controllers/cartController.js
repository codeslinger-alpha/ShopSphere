const pool = require("../config/db");

function parsePositiveInteger(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function getCart(req, res) {
    try {
        const result = await pool.query(
            `SELECT c.prod_id, c.quantity, p.name, p.unit_price, p.images,
                    c.quantity * p.unit_price AS subtotal
             FROM cart_items c
             JOIN products p ON p.prod_id = c.prod_id
             WHERE c.user_id = $1
             ORDER BY p.name`,
            [req.user.user_id]
        );

        return res.json(result.rows);
    } catch (error) {
        console.error("Get cart error:", error);
        return res.status(500).json({ message: "Could not load the cart." });
    }
}

async function addCartItem(req, res) {
    const productId = parsePositiveInteger(req.body?.prod_id);
    const quantity = parsePositiveInteger(req.body?.quantity);

    if (!productId || !quantity) {
        return res.status(400).json({ message: "Product ID and quantity must be positive integers." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO cart_items (user_id, prod_id, quantity)
             SELECT $1, p.prod_id, $3
             FROM products p
             JOIN shops s ON s.shop_id = p.shop_id
             JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
             WHERE p.prod_id = $2
               AND p.discontinued = false
               AND p.in_stock >= $3
               AND s.active_status = 'active'
               AND mp.active_status = 'available'
             ON CONFLICT (user_id, prod_id)
             DO UPDATE SET quantity = cart_items.quantity + EXCLUDED.quantity
             WHERE cart_items.quantity + EXCLUDED.quantity <= (
                 SELECT in_stock FROM products WHERE prod_id = EXCLUDED.prod_id
             )
             RETURNING user_id, prod_id, quantity`,
            [req.user.user_id, productId, quantity]
        );

        if (result.rows.length === 0) {
            return res.status(409).json({
                message: "This product is unavailable or the requested quantity exceeds stock."
            });
        }

        return res.status(201).json({ message: "Added to cart.", item: result.rows[0] });
    } catch (error) {
        console.error("Add cart item error:", error);
        return res.status(500).json({ message: "Could not add the item to the cart." });
    }
}

async function updateCartItem(req, res) {
    const productId = parsePositiveInteger(req.params.productId);
    const quantity = parsePositiveInteger(req.body?.quantity);

    if (!productId || !quantity) {
        return res.status(400).json({ message: "Product ID and quantity must be positive integers." });
    }

    try {
        const result = await pool.query(
            `UPDATE cart_items c
             SET quantity = $1
             FROM products p
             WHERE c.user_id = $2
               AND c.prod_id = $3
               AND p.prod_id = c.prod_id
               AND p.in_stock >= $1
             RETURNING c.user_id, c.prod_id, c.quantity`,
            [quantity, req.user.user_id, productId]
        );

        if (result.rows.length === 0) {
            const cartItem = await pool.query(
                `SELECT p.in_stock
                 FROM cart_items c
                 JOIN products p ON p.prod_id = c.prod_id
                 WHERE c.user_id = $1 AND c.prod_id = $2`,
                [req.user.user_id, productId]
            );

            if (cartItem.rows.length === 0) {
                return res.status(404).json({ message: "Cart item not found." });
            }

            return res.status(409).json({
                message: "The requested quantity exceeds available stock."
            });
        }

        return res.json({ message: "Cart quantity updated.", item: result.rows[0] });
    } catch (error) {
        console.error("Update cart item error:", error);
        return res.status(500).json({ message: "Could not update the cart item." });
    }
}

async function removeCartItem(req, res) {
    const productId = parsePositiveInteger(req.params.productId);

    if (!productId) {
        return res.status(400).json({ message: "Product ID must be a positive integer." });
    }

    try {
        const result = await pool.query(
            `DELETE FROM cart_items
             WHERE user_id = $1 AND prod_id = $2
             RETURNING prod_id`,
            [req.user.user_id, productId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Cart item not found." });
        }

        return res.status(204).send();
    } catch (error) {
        console.error("Remove cart item error:", error);
        return res.status(500).json({ message: "Could not remove the cart item." });
    }
}

module.exports = { addCartItem, getCart, removeCartItem, updateCartItem };
