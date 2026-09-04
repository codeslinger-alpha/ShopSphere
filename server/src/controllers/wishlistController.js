const pool = require("../config/db");

function parsePositiveInteger(value) {
    const number = Number(value);

    return Number.isSafeInteger(number) && number > 0 ? number : null;
}

async function getWishlist(req, res) {
    try {
        const result = await pool.query(
            `SELECT w.prod_id, p.name, p.unit_price, p.images, p.in_stock,
                    s.name AS shop_name
             FROM wish_list_items w
             JOIN products p ON p.prod_id = w.prod_id
             JOIN shops s ON s.shop_id = p.shop_id
             WHERE w.user_id = $1
             ORDER BY p.name`,
            [req.user.user_id]
        );

        return res.json(result.rows);
    } catch (error) {
        console.error("Get wishlist error:", error);
        return res.status(500).json({ message: "Could not load the wishlist." });
    }
}

async function addWishlistItem(req, res) {
    const productId = parsePositiveInteger(req.body?.prod_id);

    if (!productId) {
        return res.status(400).json({ message: "Product ID must be a positive integer." });
    }

    try {
        const result = await pool.query(
            `INSERT INTO wish_list_items (user_id, prod_id)
             SELECT $1, p.prod_id
             FROM products p
             JOIN shops s ON s.shop_id = p.shop_id
             JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
             WHERE p.prod_id = $2
               AND p.discontinued = false
               AND s.active_status = 'active'
               AND mp.active_status = 'available'
             ON CONFLICT (user_id, prod_id) DO NOTHING
             RETURNING user_id, prod_id`,
            [req.user.user_id, productId]
        );

        if (result.rows.length === 0) {
            const existingItem = await pool.query(
                `SELECT 1
                 FROM wish_list_items
                 WHERE user_id = $1 AND prod_id = $2`,
                [req.user.user_id, productId]
            );

            if (existingItem.rows.length > 0) {
                return res.status(200).json({ message: "Product is already in your wishlist." });
            }

            const product = await pool.query(
                "SELECT prod_id FROM products WHERE prod_id = $1",
                [productId]
            );

            if (product.rows.length === 0) {
                return res.status(404).json({ message: "Product not found." });
            }

            return res.status(409).json({ message: "This product is currently unavailable." });
        }

        return res.status(201).json({ message: "Added to wishlist.", item: result.rows[0] });
    } catch (error) {
        console.error("Add wishlist item error:", error);
        return res.status(500).json({ message: "Could not add the item to the wishlist." });
    }
}

async function removeWishlistItem(req, res) {
    const productId = parsePositiveInteger(req.params.productId);

    if (!productId) {
        return res.status(400).json({ message: "Product ID must be a positive integer." });
    }

    try {
        const result = await pool.query(
            `DELETE FROM wish_list_items
             WHERE user_id = $1 AND prod_id = $2
             RETURNING prod_id`,
            [req.user.user_id, productId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ message: "Wishlist item not found." });
        }

        return res.status(204).send();
    } catch (error) {
        console.error("Remove wishlist item error:", error);
        return res.status(500).json({ message: "Could not remove the wishlist item." });
    }
}

module.exports = { addWishlistItem, getWishlist, removeWishlistItem };
