-- Expanded fictional demo data. Loaded after seed_demo.sql in the same transaction.
-- Stable emails/names/timestamps identify fixtures; reruns do not reset existing rows.
-- Generated accounts reuse the public base-demo password hash for their role.
--
-- PostgreSQL built this file out of six CREATE TEMP TABLE ... AS SELECT statements
-- and then read them back by name. Oracle has temporary tables too, but it commits
-- implicitly at every DDL statement, so a CREATE in the middle of the seed would end
-- the seed's transaction and give up the all-or-nothing promise the runner makes.
-- Instead each generated set is a subquery factoing clause — a WITH — written inline
-- where it is read. Nothing is materialised and nothing has to be dropped at the end.
--
-- The one set that genuinely has to survive from one statement to the next is the
-- orders this run inserted, because the money movements near the end pay out for
-- those and must not pay twice; that set lives in seed_run_orders, the runner's own
-- scratch table, which seed_demo.sql fills too.

-- 1. Forty generated accounts: 30 customers, 6 vendors, 4 couriers. The account
-- number is carried in the email and read back out of it below, which is why the
-- later statements can be driven off `users` rather than regenerating the list.
-- The city cycles the way PostgreSQL's array subscript did, one per account.
INSERT INTO locations (street_address, postal_code, city, state_province, country_id)
WITH accounts (role_name, n) AS (
    SELECT 'customer', LEVEL FROM dual CONNECT BY LEVEL <= 30
    UNION ALL SELECT 'vendor', LEVEL FROM dual CONNECT BY LEVEL <= 6
    UNION ALL SELECT 'delivery', LEVEL FROM dual CONNECT BY LEVEL <= 4
)
SELECT 'Expanded Demo ' || a.role_name || ' House ' || TO_CHAR(a.n),
       '1200',
       CASE MOD(a.n, 4) WHEN 0 THEN 'Dhaka' WHEN 1 THEN 'Chattogram'
                        WHEN 2 THEN 'Sylhet' ELSE 'Rajshahi' END,
       CASE MOD(a.n, 4) WHEN 0 THEN 'Dhaka' WHEN 1 THEN 'Chattogram'
                        WHEN 2 THEN 'Sylhet' ELSE 'Rajshahi' END,
       'BD'
FROM accounts a
WHERE NOT EXISTS (
    SELECT 1 FROM locations l
    WHERE l.street_address = 'Expanded Demo ' || a.role_name || ' House ' || TO_CHAR(a.n)
      AND l.country_id = 'BD')
/

-- Each account borrows the password hash of its role's base demo account, so the
-- credentials documented in server/README.md still work for every generated one.
-- PostgreSQL numbered the phone numbers with a row_number over the whole set; the
-- role is a digit here instead, which is unique for the same reason and does not
-- have to be kept in step with how many accounts each role has.
INSERT INTO users (user_role, name, email, password_hash, phone_numbers, address)
WITH accounts (role_name, n) AS (
    SELECT 'customer', LEVEL FROM dual CONNECT BY LEVEL <= 30
    UNION ALL SELECT 'vendor', LEVEL FROM dual CONNECT BY LEVEL <= 6
    UNION ALL SELECT 'delivery', LEVEL FROM dual CONNECT BY LEVEL <= 4
)
SELECT r.role_id,
       'Demo ' || INITCAP(a.role_name) || ' ' || TO_CHAR(a.n, 'FM00'),
       a.role_name || TO_CHAR(a.n, 'FM00') || '@shopsphere.test',
       base.password_hash,
       '017' || CASE a.role_name WHEN 'customer' THEN '0' WHEN 'vendor' THEN '1'
                                 ELSE '2' END || TO_CHAR(a.n, 'FM0000000'),
       l.location_id
FROM accounts a
JOIN roles r ON r.role_name = a.role_name
JOIN users base ON base.email = a.role_name || '@shopsphere.test'
JOIN locations l
  ON l.street_address = 'Expanded Demo ' || a.role_name || ' House ' || TO_CHAR(a.n)
 AND l.country_id = 'BD'
WHERE NOT EXISTS (
    SELECT 1 FROM users u
    WHERE u.email = a.role_name || TO_CHAR(a.n, 'FM00') || '@shopsphere.test')
/

-- The fourth courier is deliberately off duty.
INSERT INTO delivery_personnel (delivery_person_id, vehicle_info, vehicle_type, vehicle_number, active_status, earnings)
SELECT u.user_id, 'Demo vehicle and insulated delivery bag',
       CASE MOD(TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')), 4)
         WHEN 1 THEN 'bicycle' WHEN 2 THEN 'motorcycle'
         WHEN 3 THEN 'car' ELSE 'van' END,
       'DEMO-' || TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')),
       CASE WHEN TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')) = 4
            THEN 'unavailable' ELSE 'available' END,
       0
FROM users u
WHERE REGEXP_LIKE(u.email, '^delivery[0-9]{2}@shopsphere\.test$')
  AND NOT EXISTS (
    SELECT 1 FROM delivery_personnel d WHERE d.delivery_person_id = u.user_id)
/

-- Vendor 5's shop waits for an administrator, and vendor 6's is disabled, which the
-- schema's own trigger answers by discontinuing every listing in it.
INSERT INTO shops (owner, name, description, phone_numbers, address, active_status)
SELECT u.user_id,
       'Demo Marketplace ' || TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')),
       '**Fictional seller** with a broad range for browsing and comparison.',
       u.phone_numbers, u.address,
       CASE TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+'))
         WHEN 5 THEN 'pending' WHEN 6 THEN 'disabled' ELSE 'active' END
FROM users u
WHERE REGEXP_LIKE(u.email, '^vendor[0-9]{2}@shopsphere\.test$')
  AND NOT EXISTS (
    SELECT 1 FROM shops s
    WHERE s.owner = u.user_id
      AND s.name = 'Demo Marketplace ' || TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')))
/

-- 2. The expanded catalog: eight more categories and 48 master products.
INSERT INTO categories (name, description)
SELECT v.name, 'Fictional products for the expanded demonstration.'
FROM (
    SELECT 'Demo Electronics' AS name FROM dual
    UNION ALL SELECT 'Demo Home' FROM dual
    UNION ALL SELECT 'Demo Books' FROM dual
    UNION ALL SELECT 'Demo Apparel' FROM dual
    UNION ALL SELECT 'Demo Sports' FROM dual
    UNION ALL SELECT 'Demo Beauty' FROM dual
    UNION ALL SELECT 'Demo Groceries' FROM dual
    UNION ALL SELECT 'Demo Toys' FROM dual
) v
WHERE NOT EXISTS (
    SELECT 1 FROM categories c WHERE c.name = v.name AND c.parent_category IS NULL)
/

INSERT INTO master_products (manufacturer, name, description, category_id, wholesale_price)
SELECT 'ShopSphere Expanded Demo', v.name, '**Demo item.** For testing only.',
       c.category_id, v.price
FROM (
    SELECT 'Demo Electronics' AS category, 'Demo USB-C Hub' AS name, 18 AS price FROM dual
    UNION ALL SELECT 'Demo Electronics', 'Demo Portable Speaker', 22 FROM dual
    UNION ALL SELECT 'Demo Electronics', 'Demo Webcam', 28 FROM dual
    UNION ALL SELECT 'Demo Electronics', 'Demo Power Bank', 15 FROM dual
    UNION ALL SELECT 'Demo Electronics', 'Demo Gaming Mouse', 16 FROM dual
    UNION ALL SELECT 'Demo Electronics', 'Demo Tablet Stand', 8 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Cotton Towel', 6 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Ceramic Mug', 4 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Storage Basket', 9 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Wall Clock', 11 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Cushion Cover', 5 FROM dual
    UNION ALL SELECT 'Demo Home', 'Demo Water Bottle', 7 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo SQL Workbook', 10 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo Programming Guide', 14 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo Travel Journal', 5 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo Bengali Stories', 8 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo Science Atlas', 12 FROM dual
    UNION ALL SELECT 'Demo Books', 'Demo Sketchbook', 6 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Cotton T-Shirt', 9 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Denim Jacket', 28 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Running Socks', 3 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Canvas Cap', 5 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Raincoat', 18 FROM dual
    UNION ALL SELECT 'Demo Apparel', 'Demo Linen Scarf', 7 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Yoga Mat', 12 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Football', 14 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Badminton Racket', 19 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Jump Rope', 4 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Resistance Bands', 8 FROM dual
    UNION ALL SELECT 'Demo Sports', 'Demo Training Gloves', 10 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Hand Cream', 5 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Herbal Soap', 3 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Travel Mirror', 4 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Hair Brush', 6 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Face Towel Set', 7 FROM dual
    UNION ALL SELECT 'Demo Beauty', 'Demo Toiletry Bag', 8 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Tea Selection', 6 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Coffee Beans', 10 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Honey Jar', 7 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Oat Biscuits', 3 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Spice Box', 9 FROM dual
    UNION ALL SELECT 'Demo Groceries', 'Demo Rice Pack', 5 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Wooden Puzzle', 8 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Building Blocks', 14 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Toy Train', 12 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Plush Bear', 9 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Board Game', 15 FROM dual
    UNION ALL SELECT 'Demo Toys', 'Demo Art Kit', 11 FROM dual
) v
JOIN categories c ON c.name = v.category AND c.parent_category IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM master_products mp
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo' AND mp.name = v.name)
/

-- Every expanded master product gets both of its category's attributes, so the
-- catalog still filters on something after this file has run. The value is chosen
-- by the length of the product's name, which is arbitrary but stable.
INSERT INTO attributes (name, description)
SELECT 'Demo Material', 'Material or format for catalog filtering.' FROM dual
WHERE NOT EXISTS (SELECT 1 FROM attributes a WHERE a.name = 'Demo Material')
/

INSERT INTO category_attributes (category_id, attribute_id)
SELECT c.category_id, a.attribute_id
FROM categories c CROSS JOIN attributes a
WHERE c.name IN ('Demo Books', 'Demo Apparel', 'Demo Sports', 'Demo Beauty',
                 'Demo Groceries', 'Demo Toys')
  AND c.parent_category IS NULL
  AND a.name IN ('Demo Material', 'Demo Color')
  AND NOT EXISTS (
    SELECT 1 FROM category_attributes ca
    WHERE ca.category_id = c.category_id AND ca.attribute_id = a.attribute_id)
/

INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
SELECT mp.master_prod_id, a.attribute_id,
       CASE a.name
         WHEN 'Demo Color' THEN
           CASE MOD(LENGTH(mp.name), 4) WHEN 0 THEN 'Blue' WHEN 1 THEN 'Black'
                WHEN 2 THEN 'White' ELSE 'Green' END
         WHEN 'Demo Connection' THEN 'USB'
         ELSE
           CASE MOD(LENGTH(mp.name), 4) WHEN 0 THEN 'Cotton' WHEN 1 THEN 'Paper'
                WHEN 2 THEN 'Wood' ELSE 'Mixed' END
       END
FROM master_products mp
JOIN category_attributes ca ON ca.category_id = mp.category_id
JOIN attributes a ON a.attribute_id = ca.attribute_id
WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
  AND NOT EXISTS (
    SELECT 1 FROM attribute_values av
    WHERE av.master_prod_id = mp.master_prod_id AND av.attribute_id = a.attribute_id)
/

-- 3. Every vendor lists every expanded master product, at a price derived from the
-- wholesale one and that vendor's own number. The rank `n` is by product name over
-- this manufacturer's catalog, which is the fixture's product identity: it decides
-- the stock, the price and which listings are retired.
INSERT INTO products (name, master_prod_id, description, shop_id, in_stock, unit_price, discontinued)
WITH masters AS (
    SELECT mp.master_prod_id, mp.name, mp.wholesale_price,
           ROW_NUMBER() OVER (ORDER BY mp.name) AS n
    FROM master_products mp
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
)
SELECT m.name, m.master_prod_id, 'Demo retail listing with seller-specific pricing.',
       shop.shop_id,
       CASE WHEN MOD(m.n, 6) = 0 THEN 0 ELSE 10 + MOD(m.n, 31) END,
       ROUND(m.wholesale_price * (1.20 + shop.vendor_n * 0.05), 2),
       CASE WHEN shop.active_status = 'disabled' OR MOD(m.n, 12) = 0 THEN 1 ELSE 0 END
FROM masters m
JOIN (
    SELECT s.shop_id, s.active_status,
           TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')) AS vendor_n
    FROM users u
    JOIN shops s
      ON s.owner = u.user_id
     AND s.name = 'Demo Marketplace ' || TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+'))
    WHERE REGEXP_LIKE(u.email, '^vendor[0-9]{2}@shopsphere\.test$')
) shop ON 1 = 1
WHERE NOT EXISTS (
    SELECT 1 FROM products p
    WHERE p.master_prod_id = m.master_prod_id AND p.shop_id = shop.shop_id)
/

-- 4. Thirty-two historical orders on fixed timestamps, which are their identity: an
-- order is one this run placed exactly when no order exists for that customer at
-- that moment. Their ids are remembered in seed_run_orders so that the items,
-- payments, earnings and balances below can be scoped to them.
--
-- PostgreSQL wrote this as INSERT ... RETURNING inside a CTE. Oracle has no
-- RETURNING that answers with every row it wrote from plain SQL, but PL/SQL does:
-- the clause collects the ids into a collection, and FORALL writes them across.
DECLARE
    v_order_id orders.order_id%TYPE;
BEGIN
    FOR planned IN (
    SELECT p.user_id, p.address, p.status,
           CASE WHEN p.status IN ('delivered', 'shipped') THEN p.courier_id END AS courier_id,
           p.created_at,
           CASE WHEN p.status = 'delivered'
                THEN p.created_at + NUMTODSINTERVAL(2, 'DAY') END AS delivered_at
    FROM (
        SELECT s.n,
               TIMESTAMP '2026-08-01 10:00:00' + NUMTODSINTERVAL(s.n, 'DAY') AS created_at,
               CASE MOD(s.n - 1, 4) WHEN 0 THEN 'delivered' WHEN 1 THEN 'shipped'
                    WHEN 2 THEN 'pending' ELSE 'cancelled' END AS status,
               customer.user_id, customer.address,
               courier.user_id AS courier_id
        FROM (SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 32) s
        JOIN users customer
          ON customer.email = 'customer' || TO_CHAR(1 + MOD(s.n - 1, 30), 'FM00')
                              || '@shopsphere.test'
        JOIN users courier
          ON courier.email = 'delivery' || TO_CHAR(1 + MOD(s.n - 1, 3), 'FM00')
                             || '@shopsphere.test'
    ) p
    WHERE NOT EXISTS (
        SELECT 1 FROM orders o
        WHERE o.user_id = p.user_id AND o.created_at = p.created_at)
    ) LOOP
        INSERT INTO orders (user_id, shipping_address, order_status, delivery_person_id, created_at, delivered_at)
        VALUES (planned.user_id, planned.address, planned.status, planned.courier_id, planned.created_at, planned.delivered_at)
        RETURNING order_id INTO v_order_id;
        INSERT INTO seed_run_orders (order_id) VALUES (v_order_id);
    END LOOP;
END;
/

-- Two lines per order, both of them sellable listings. The listing is picked by
-- position in the sellable set, so the choice is spread across the catalog rather
-- than piling onto the first few products the way an ordered pick would.
-- `JOIN ... ON 1 = 1` is how a cross join is written here: a CROSS JOIN cannot be
-- chained with the ON joins around it, and both tables of this one are wanted.
INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
WITH sellable AS (
    SELECT p.prod_id, p.unit_price, ROW_NUMBER() OVER (ORDER BY p.prod_id) AS n
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
      AND s.active_status = 'active'
      AND p.discontinued = 0
      AND p.in_stock > 0
),
plan AS (
    SELECT s.n,
           TIMESTAMP '2026-08-01 10:00:00' + NUMTODSINTERVAL(s.n, 'DAY') AS created_at,
           customer.user_id
    FROM (SELECT LEVEL AS n FROM dual CONNECT BY LEVEL <= 32) s
    JOIN users customer
      ON customer.email = 'customer' || TO_CHAR(1 + MOD(s.n - 1, 30), 'FM00')
                          || '@shopsphere.test'
)
SELECT o.order_id, p.prod_id, 1 + MOD(plan.n, 3), p.unit_price
FROM seed_run_orders fresh
JOIN orders o ON o.order_id = fresh.order_id
JOIN plan ON plan.user_id = o.user_id AND plan.created_at = o.created_at
JOIN (SELECT 0 AS line FROM dual UNION ALL SELECT 1 AS line FROM dual) lines ON 1 = 1
JOIN sellable p
  ON p.n = 1 + MOD(plan.n * 2 + lines.line, (SELECT COUNT(*) FROM sellable))
/

-- Price each trip the way RECORD_DELIVERY_COST does at placement, which has to
-- follow the items because it is a share of the total they produce. The same
-- constants as src/db/queries/orderQueries.js, repeated because a .sql file
-- cannot import a JavaScript constant.
UPDATE orders
SET delivery_cost = ROUND(3 + 0.02 * total_amount, 2)
WHERE order_id IN (SELECT order_id FROM seed_run_orders)
/

INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
SELECT o.order_id, o.total_amount + o.delivery_cost, 'cash_on_delivery',
       CASE o.order_status WHEN 'delivered' THEN 'completed'
                           WHEN 'cancelled' THEN 'failed' ELSE 'pending' END,
       o.delivered_at
FROM seed_run_orders fresh
JOIN orders o ON o.order_id = fresh.order_id
WHERE NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.order_id)
/

-- settle_delivery credits the order's own delivery_cost, once, on delivery.
UPDATE delivery_personnel
SET earnings = COALESCE(earnings, 0) + (
    SELECT COALESCE(SUM(o.delivery_cost), 0)
    FROM orders o
    WHERE o.delivery_person_id = delivery_personnel.delivery_person_id
      AND o.order_id IN (SELECT order_id FROM seed_run_orders)
      AND o.order_status = 'delivered')
WHERE delivery_person_id IN (
    SELECT o.delivery_person_id FROM orders o
    WHERE o.order_id IN (SELECT order_id FROM seed_run_orders)
      AND o.order_status = 'delivered')
/

-- Each shop is paid for its own delivered lines, in full, the same way. Scoped to
-- the orders inserted on this run, so a reseed credits nothing twice.
UPDATE shops
SET balance = balance + (
    SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    WHERE p.shop_id = shops.shop_id
      AND o.order_id IN (SELECT order_id FROM seed_run_orders)
      AND o.order_status = 'delivered')
WHERE shop_id IN (
    SELECT p.shop_id
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    JOIN products p ON p.prod_id = oi.prod_id
    WHERE o.order_id IN (SELECT order_id FROM seed_run_orders)
      AND o.order_status = 'delivered')
/

-- 5. Reviews, which the schema's triggers only accept for a delivered order.
INSERT INTO product_reviews (user_id, prod_id, rating, review)
SELECT o.user_id, oi.prod_id, 3 + MOD(o.user_id, 3), 'Demo review: delivered and tested.'
FROM seed_run_orders fresh
JOIN orders o ON o.order_id = fresh.order_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE o.order_status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM product_reviews pr
    WHERE pr.user_id = o.user_id AND pr.prod_id = oi.prod_id)
/

INSERT INTO shop_reviews (user_id, shop_id, rating, review)
SELECT DISTINCT o.user_id, p.shop_id, 3 + MOD(o.user_id, 3), 'Demo review: prompt service.'
FROM seed_run_orders fresh
JOIN orders o ON o.order_id = fresh.order_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p ON p.prod_id = oi.prod_id
WHERE o.order_status = 'delivered'
  AND NOT EXISTS (
    SELECT 1 FROM shop_reviews sr
    WHERE sr.user_id = o.user_id AND sr.shop_id = p.shop_id)
/

-- 6. An admin withdrew these already-empty listings. Ledger balances are credited
-- only for refund rows inserted on this run; existing balances are never reset.
--
-- The credit comes first, guarded by the same NOT EXISTS the insert uses, so it is
-- the money for exactly the rows that are about to appear. PostgreSQL did it the
-- other way round, with INSERT ... RETURNING feeding the UPDATE.
UPDATE shops
SET balance = balance + (
    SELECT COALESCE(SUM(4 * mp.wholesale_price), 0)
    FROM products p
    JOIN (
        SELECT mp.master_prod_id, mp.wholesale_price,
               ROW_NUMBER() OVER (ORDER BY mp.name) AS n
        FROM master_products mp
        WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
    ) mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.shop_id = shops.shop_id
      AND MOD(mp.n, 12) = 0
      AND shops.name LIKE 'Demo Marketplace %'
      AND NOT EXISTS (
        SELECT 1 FROM vendor_refunds r
        WHERE r.prod_id = p.prod_id
          AND r.created_at = TIMESTAMP '2026-08-15 09:00:00'))
WHERE EXISTS (
    SELECT 1 FROM products p
    JOIN (
        SELECT mp.master_prod_id, mp.wholesale_price,
               ROW_NUMBER() OVER (ORDER BY mp.name) AS n
        FROM master_products mp
        WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
    ) mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.shop_id = shops.shop_id
      AND MOD(mp.n, 12) = 0
      AND shops.name LIKE 'Demo Marketplace %'
      AND NOT EXISTS (
        SELECT 1 FROM vendor_refunds r
        WHERE r.prod_id = p.prod_id
          AND r.created_at = TIMESTAMP '2026-08-15 09:00:00'))
/

INSERT INTO vendor_refunds (shop_id, prod_id, master_prod_id, units, unit_amount, amount, reason, removed_by, created_at)
SELECT p.shop_id, p.prod_id, p.master_prod_id, 4, mp.wholesale_price,
       4 * mp.wholesale_price, 'admin_removal', admin.user_id,
       TIMESTAMP '2026-08-15 09:00:00'
FROM products p
JOIN (
    SELECT mp.master_prod_id, mp.wholesale_price,
           ROW_NUMBER() OVER (ORDER BY mp.name) AS n
    FROM master_products mp
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
) mp ON mp.master_prod_id = p.master_prod_id
JOIN shops s ON s.shop_id = p.shop_id
JOIN users admin ON admin.email = 'admin@shopsphere.test'
WHERE MOD(mp.n, 12) = 0
  AND s.name LIKE 'Demo Marketplace %'
  AND NOT EXISTS (
    SELECT 1 FROM vendor_refunds r
    WHERE r.prod_id = p.prod_id
      AND r.created_at = TIMESTAMP '2026-08-15 09:00:00')
/

-- 7. Stock is the remaining stock AFTER these historical orders and refunds.
-- Acquisitions reconcile to remaining + non-cancelled order quantities +
-- compensated units.
--
-- As in the small fixture, the balance is debited for exactly the rows inserted on
-- this run, so the purchases appear in the ledger the money came out of. A cursor
-- rather than PostgreSQL's INSERT ... RETURNING feeding an UPDATE: the same two
-- statements, but the quantity — which is a sum across three tables and therefore
-- long to repeat — is computed once per listing and read twice.
DECLARE
    v_exists NUMBER;
    CURSOR acquisitions IS
        SELECT p.shop_id, p.master_prod_id, mp.wholesale_price,
               p.in_stock
               + COALESCE((SELECT SUM(oi.quantity)
                           FROM order_items oi
                           JOIN orders o ON o.order_id = oi.order_id
                           WHERE oi.prod_id = p.prod_id
                             AND o.order_status <> 'cancelled'), 0)
               + COALESCE((SELECT SUM(r.units) FROM vendor_refunds r
                           WHERE r.prod_id = p.prod_id), 0) AS quantity
        FROM products p
        JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
        WHERE mp.manufacturer = 'ShopSphere Expanded Demo';
BEGIN
    FOR a IN acquisitions LOOP
        SELECT COUNT(*) INTO v_exists
        FROM shop_purchases sp
        WHERE sp.shop_id = a.shop_id AND sp.master_prod_id = a.master_prod_id;

        IF a.quantity > 0 AND v_exists = 0 THEN
            INSERT INTO shop_purchases (shop_id, master_prod_id, quantity,
                                        wholesale_unit_price, purchased_at)
            VALUES (a.shop_id, a.master_prod_id, a.quantity, a.wholesale_price,
                    TIMESTAMP '2026-07-01 09:00:00');

            UPDATE shops SET balance = balance - a.quantity * a.wholesale_price
            WHERE shop_id = a.shop_id;
        END IF;
    END LOOP;
END;
/

-- The capital each shop bought its stock with, and the charge for it.
--
-- shops.balance is a running total of sales, top-ups, purchases and refunds, so a
-- fixture that wrote the purchases without the money that funded them would leave a
-- balance reconciling with nothing. Each shop is therefore brought up to its
-- purchases plus a float, and the ledger row is written for exactly the gap.
--
-- Measuring the gap rather than checking whether a shop has been funded at all is
-- what makes the two seed files compose: whichever runs second funds only what it
-- added, and a reseed finds no gap, inserts nothing, and leaves every balance and
-- top-up row untouched.
--
-- The float is deliberate: a shop with no capital could not buy anything through
-- the API, which is the whole point of the column.
DECLARE
    CURSOR gaps IS
        SELECT s.shop_id,
               COALESCE(sp.purchases, 0) + 500 - COALESCE(t.funded, 0) AS amount
        FROM shops s
        LEFT JOIN (
            SELECT shop_id, SUM(quantity * wholesale_unit_price) AS purchases
            FROM shop_purchases GROUP BY shop_id
        ) sp ON sp.shop_id = s.shop_id
        LEFT JOIN (
            SELECT shop_id, SUM(amount) AS funded
            FROM shop_topups GROUP BY shop_id
        ) t ON t.shop_id = s.shop_id
        WHERE COALESCE(sp.purchases, 0) + 500 - COALESCE(t.funded, 0) > 0;
BEGIN
    FOR g IN gaps LOOP
        INSERT INTO shop_topups (shop_id, amount, method, created_at)
        VALUES (g.shop_id, g.amount, 'bank_transfer', TIMESTAMP '2026-07-01 08:00:00');

        UPDATE shops SET balance = balance + g.amount WHERE shop_id = g.shop_id;
    END LOOP;
END;
/

-- 8. Each customer collects one listing, so the cart and wish-list pages have
-- something on them in every generated account.
--
-- The listing is picked by the account's own number against the sellable set, so
-- the two statements need that set twice. Its definition is repeated rather than
-- shared; nothing about it changes between the two, because inserting order items
-- does not touch products.in_stock — the stock a listing carries is already the
-- remainder after the orders above.
INSERT INTO cart_items (user_id, prod_id, quantity)
WITH sellable AS (
    SELECT p.prod_id, ROW_NUMBER() OVER (ORDER BY p.prod_id) AS n
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
      AND s.active_status = 'active'
      AND p.discontinued = 0
      AND p.in_stock > 0
)
SELECT u.user_id, p.prod_id, 1
FROM users u
JOIN sellable p ON p.n = TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+'))
WHERE REGEXP_LIKE(u.email, '^customer[0-9]{2}@shopsphere\.test$')
  AND NOT EXISTS (
    SELECT 1 FROM cart_items c WHERE c.user_id = u.user_id AND c.prod_id = p.prod_id)
/

INSERT INTO wish_list_items (user_id, prod_id)
WITH sellable AS (
    SELECT p.prod_id, ROW_NUMBER() OVER (ORDER BY p.prod_id) AS n
    FROM products p
    JOIN shops s ON s.shop_id = p.shop_id
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE mp.manufacturer = 'ShopSphere Expanded Demo'
      AND s.active_status = 'active'
      AND p.discontinued = 0
      AND p.in_stock > 0
)
SELECT u.user_id, p.prod_id
FROM users u
JOIN sellable p ON p.n = TO_NUMBER(REGEXP_SUBSTR(u.email, '[0-9]+')) + 1
WHERE REGEXP_LIKE(u.email, '^customer[0-9]{2}@shopsphere\.test$')
  AND NOT EXISTS (
    SELECT 1 FROM wish_list_items w WHERE w.user_id = u.user_id AND w.prod_id = p.prod_id)
/
