/*Current API map:
| HTTP   | Endpoint                | PostgreSQL operation                        |
| ------ | ----------------------- | ------------------------------------------- |
| GET    | `/test-db`              | `SELECT 1`                                  |
| GET    | `/api/roles`            | `SELECT roles`                              |
| POST   | `/api/signup`           | `INSERT users`                              |
| POST   | `/api/login`            | `SELECT users`                              |
| GET    | `/api/users`            | `SELECT users`                              |
| GET    | `/api/products`         | `SELECT products + shops + master_products` |
| GET    | `/api/products/:id`     | `SELECT one product`                        |
| GET    | `/api/categories`       | `SELECT categories`                         |
| GET    | `/api/shops`            | `SELECT shops`                              |
| GET    | `/api/cart/:userId`     | `SELECT cart`                               |
| POST   | `/api/cart`             | `INSERT/UPDATE cart`                        |
| PUT    | `/api/cart`             | `UPDATE cart`                               |
| DELETE | `/api/cart`             | `DELETE cart item`                          |
| GET    | `/api/wishlist/:userId` | `SELECT wishlist`                           |
| POST   | `/api/wishlist`         | `INSERT wishlist`                           |
*/
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const pool = require("./config/db");
const authRoutes = require("./routes/authRoutes");

const app = express();

const PORT = process.env.PORT || 5000;


// --------------------------------------------------
// Middleware
// --------------------------------------------------

app.use(cors({
    origin: process.env.CLIENT_ORIGIN || "http://localhost:5173",
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());
app.use("/api", authRoutes);


// Serve files inside public/

app.use(express.static("public"));


// --------------------------------------------------
// Home
// --------------------------------------------------

app.get("/", (req, res) => {
    res.sendFile("index.html", {
        root: "public"
    });
});


// --------------------------------------------------
// DATABASE TEST
// --------------------------------------------------

app.get("/test-db", async (req, res) => {
    try {
        const result = await pool.query("SELECT 1");

        res.json({
            success: true,
            result: result.rows
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});


// ==================================================
// ROLES
// ==================================================

app.get("/api/roles", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT role_id, role_name, description
            FROM roles
            ORDER BY role_id
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


/*
// ==================================================
// SIGN UP
// ==================================================

app.post("/api/signup", async (req, res) => {

    const {
        name,
        email,
        password,
        role
    } = req.body;


    try {

        // Find role ID

        const roleResult = await pool.query(
            `
            SELECT role_id
            FROM roles
            WHERE role_name = $1
            `,
            [role]
        );


        if (roleResult.rows.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Invalid account type"
            });
        }


        const roleId = roleResult.rows[0].role_id;


        // Check existing email

        const existing = await pool.query(
            `
            SELECT user_id
            FROM users
            WHERE email = $1
            `,
            [email]
        );


        if (existing.rows.length > 0) {

            return res.status(409).json({
                success: false,
                message: "Email already exists"
            });
        }


        // Create user

        const result = await pool.query(
            `
            INSERT INTO users
                (user_role, name, password_hash, email)
            VALUES
                ($1, $2, $3, $4)
            RETURNING
                user_id,
                name,
                email
            `,
            [
                roleId,
                name,
                password,
                email
            ]
        );


        res.status(201).json({
            success: true,
            message: "Account created",
            user: result.rows[0]
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});


// ==================================================
// LOGIN
// ==================================================

app.post("/api/login", async (req, res) => {

    const {
        email,
        password,
        role
    } = req.body;


    try {

        const result = await pool.query(
            `
            SELECT
                u.user_id,
                u.name,
                u.email,
                u.password_hash,
                u.active_status,
                r.role_name
            FROM users u
            JOIN roles r
                ON u.user_role = r.role_id
            WHERE u.email = $1
              AND r.role_name = $2
            `,
            [email, role]
        );


        if (result.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Invalid login information"
            });
        }


        const user = result.rows[0];


        if (user.active_status === "disabled") {

            return res.status(403).json({
                success: false,
                message: "Account is disabled"
            });
        }


        // TEMPORARY.
        // Password hashing will be added later.

        if (password !== user.password_hash) {

            return res.status(401).json({
                success: false,
                message: "Invalid login information"
            });
        }


        res.json({
            success: true,
            message: "Login successful",

            user: {
                user_id: user.user_id,
                name: user.name,
                email: user.email,
                role: user.role_name
            }
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database error"
        });
    }
});


// ==================================================
// PRODUCTS
// ==================================================
*/

app.get("/api/products", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                p.prod_id,
                p.name,
                p.images,
                p.description,
                p.in_stock,
                p.unit_price,

                s.shop_id,
                s.name AS shop_name,

                mp.master_prod_id,
                mp.manufacturer

            FROM products p

            JOIN shops s
                ON p.shop_id = s.shop_id

            JOIN master_products mp
                ON p.master_prod_id = mp.master_prod_id

            WHERE p.discontinued = false
              AND s.active_status = 'active'
              AND mp.active_status = 'available'

            ORDER BY p.prod_id
        `);


        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// --------------------------------------------------
// One product
// --------------------------------------------------

app.get("/api/products/:id", async (req, res) => {

    const productId = req.params.id;


    try {

        const result = await pool.query(
            `
            SELECT
                p.prod_id,
                p.name,
                p.images,
                p.description,
                p.in_stock,
                p.unit_price,

                s.shop_id,
                s.name AS shop_name,

                mp.master_prod_id,
                mp.manufacturer,
                mp.description AS master_description

            FROM products p

            JOIN shops s
                ON p.shop_id = s.shop_id

            JOIN master_products mp
                ON p.master_prod_id = mp.master_prod_id

            WHERE p.prod_id = $1
            `,
            [productId]
        );


        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Product not found"
            });
        }


        res.json(result.rows[0]);


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// ==================================================
// CATEGORIES
// ==================================================

app.get("/api/categories", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                category_id,
                name,
                description,
                parent_category
            FROM categories
            ORDER BY name
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// ==================================================
// SHOPS
// ==================================================

app.get("/api/shops", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                shop_id,
                name,
                logo,
                description,
                phone_numbers
            FROM shops
            WHERE active_status = 'active'
            ORDER BY name
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// ==================================================
// USERS
// ==================================================

app.get("/api/users", async (req, res) => {

    try {

        const result = await pool.query(`
            SELECT
                u.user_id,
                u.name,
                u.email,
                u.active_status,
                r.role_name
            FROM users u
            LEFT JOIN roles r
                ON u.user_role = r.role_id
            ORDER BY u.user_id
        `);

        res.json(result.rows);

    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// ==================================================
// CART
// ==================================================


// Get user's cart

app.get("/api/cart/:userId", async (req, res) => {

    const userId = req.params.userId;


    try {

        const result = await pool.query(
            `
            SELECT
                c.user_id,
                c.prod_id,
                c.quantity,

                p.name,
                p.unit_price,
                p.images,

                c.quantity * p.unit_price AS subtotal

            FROM cart_items c

            JOIN products p
                ON c.prod_id = p.prod_id

            WHERE c.user_id = $1

            ORDER BY p.name
            `,
            [userId]
        );


        res.json(result.rows);


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


// Add product to cart

app.post("/api/cart", async (req, res) => {

    const {
        user_id,
        prod_id,
        quantity
    } = req.body;


    try {

        const result = await pool.query(
            `
            INSERT INTO cart_items
                (user_id, prod_id, quantity)
            VALUES
                ($1, $2, $3)

            ON CONFLICT (user_id, prod_id)
            DO UPDATE SET
                quantity = cart_items.quantity + EXCLUDED.quantity

            RETURNING *
            `,
            [
                user_id,
                prod_id,
                quantity
            ]
        );


        res.status(201).json({
            success: true,
            item: result.rows[0]
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not add to cart"
        });
    }
});


// Change cart quantity

app.put("/api/cart", async (req, res) => {

    const {
        user_id,
        prod_id,
        quantity
    } = req.body;


    try {

        const result = await pool.query(
            `
            UPDATE cart_items
            SET quantity = $1
            WHERE user_id = $2
              AND prod_id = $3
            RETURNING *
            `,
            [
                quantity,
                user_id,
                prod_id
            ]
        );


        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Cart item not found"
            });
        }


        res.json({
            success: true,
            item: result.rows[0]
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Database error"
        });
    }
});


// Remove item from cart

app.delete("/api/cart", async (req, res) => {

    const {
        user_id,
        prod_id
    } = req.body;


    try {

        const result = await pool.query(
            `
            DELETE FROM cart_items
            WHERE user_id = $1
              AND prod_id = $2
            RETURNING *
            `,
            [
                user_id,
                prod_id
            ]
        );


        if (result.rows.length === 0) {

            return res.status(404).json({
                message: "Cart item not found"
            });
        }


        res.json({
            success: true,
            message: "Removed from cart"
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            message: "Database error"
        });
    }
});


// ==================================================
// WISHLIST
// ==================================================

app.get("/api/wishlist/:userId", async (req, res) => {

    const userId = req.params.userId;


    try {

        const result = await pool.query(
            `
            SELECT
                w.user_id,
                w.prod_id,
                p.name,
                p.unit_price,
                p.images

            FROM wish_list_items w

            JOIN products p
                ON w.prod_id = p.prod_id

            WHERE w.user_id = $1

            ORDER BY p.name
            `,
            [userId]
        );


        res.json(result.rows);


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Database error"
        });
    }
});


app.post("/api/wishlist", async (req, res) => {

    const {
        user_id,
        prod_id
    } = req.body;


    try {

        const result = await pool.query(
            `
            INSERT INTO wish_list_items
                (user_id, prod_id)
            VALUES
                ($1, $2)

            ON CONFLICT (user_id, prod_id)
            DO NOTHING

            RETURNING *
            `,
            [
                user_id,
                prod_id
            ]
        );


        res.status(201).json({
            success: true,
            item: result.rows[0] || null
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message: "Could not add to wishlist"
        });
    }
});


// ==================================================
// START SERVER
// ==================================================

app.listen(PORT, () => {

    console.log(`Server running at http://localhost:${PORT}`);

});
