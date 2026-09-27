-- LOCAL DEMO DATA ONLY. Run with `npm run seed` from server/.
-- The runner wraps the whole seed in one transaction: all rows succeed or none do.
-- Identity IDs are looked up through stable demo names/emails, never assumed.
-- Existing rows are left unchanged; rerunning does not reset stock or passwords.
--
-- Every statement is followed by a line holding only "/", which is what the
-- runner splits the file on: Oracle prepares one statement at a time, so a file
-- of them cannot be handed over in a single call.
--
-- Two spellings recur. PostgreSQL wrote a literal table as `FROM (VALUES ...) AS
-- v(cols)`; Oracle has no such form, so each is a `SELECT ... FROM dual` with the
-- rest UNION ALLed onto it — dual being the one-row table a SELECT with no table
-- of its own selects from. And `ON CONFLICT DO NOTHING` is a NOT EXISTS in the
-- select that feeds the insert: the row simply is not produced when it is already
-- there, which is the same outcome and needs no conflict clause.

-- 1. Reference data must exist before rows that reference it.
INSERT INTO roles (role_name, description)
SELECT v.role_name, v.description
FROM (
    SELECT 'customer' AS role_name, 'Normal customer' AS description FROM dual
    UNION ALL SELECT 'vendor', 'Shop vendor' FROM dual
    UNION ALL SELECT 'delivery', 'Delivery personnel' FROM dual
    UNION ALL SELECT 'admin', 'System administrator' FROM dual
) v
WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.role_name = v.role_name)
/

INSERT INTO countries (country_id, country_name)
SELECT 'BD', 'Bangladesh' FROM dual
WHERE NOT EXISTS (SELECT 1 FROM countries c WHERE c.country_id = 'BD')
/

INSERT INTO locations (street_address, postal_code, city, state_province, country_id)
SELECT v.street, '1205', 'Dhaka', 'Dhaka', c.country_id
FROM (
    SELECT 'Demo Customer House, Road 1' AS street FROM dual
    UNION ALL SELECT 'Demo Customer House, Road 2' FROM dual
    UNION ALL SELECT 'Demo Tech Shop, Road 3' FROM dual
    UNION ALL SELECT 'Demo Gadget Shop, Road 4' FROM dual
    UNION ALL SELECT 'Demo Delivery House, Road 5' FROM dual
    UNION ALL SELECT 'Demo Admin House, Road 6' FROM dual
) v
JOIN countries c ON c.country_name = 'Bangladesh'
WHERE NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.street_address = v.street AND l.country_id = c.country_id
)
/

-- 2. Six accounts: two customers/vendors allow ownership-isolation demonstrations.
-- Each hash uses its own bcrypt salt, with cost 12.
-- Customers: CustomerPass123! | Vendors: VendorPass123!
-- Delivery: DeliveryPass123!  | Admin: AdminPass123!
INSERT INTO users (user_role, name, email, password_hash, phone_numbers, address)
SELECT r.role_id, v.name, v.email, v.password_hash, v.phone, l.location_id
FROM (
    SELECT 'customer' AS role_name, 'Demo Customer' AS name, 'customer@shopsphere.test' AS email,
           '$2b$12$0FsSWCFEJmzpYgpeDsJM8.jZUrx23lA6NS2GqlY45PN7qMYZosMXu' AS password_hash,
           '01000000001' AS phone, 'Demo Customer House, Road 1' AS street FROM dual
    UNION ALL SELECT 'customer', 'Demo Customer Two', 'customer2@shopsphere.test',
           '$2b$12$Avry/G0gUXfeqTtnM.X6N.QmfjGGMOKshNtpztrIzgU/jyn553tY.',
           '01000000002', 'Demo Customer House, Road 2' FROM dual
    UNION ALL SELECT 'vendor', 'Demo Vendor', 'vendor@shopsphere.test',
           '$2b$12$kl8MER9AlKkJds8vf5vd1O63gKUSMRmLp2HS4L8EbY3n7gZnD6gwS',
           '01000000003', 'Demo Tech Shop, Road 3' FROM dual
    UNION ALL SELECT 'vendor', 'Demo Vendor Two', 'vendor2@shopsphere.test',
           '$2b$12$BBaKPoIyhMUY6BgUck9l5OAApfpiZbnHsyPfronBpu.vbY1Q3bbV.',
           '01000000004', 'Demo Gadget Shop, Road 4' FROM dual
    UNION ALL SELECT 'delivery', 'Demo Delivery', 'delivery@shopsphere.test',
           '$2b$12$YGw9lBHq6E7pThCFvDHCN.gNkXG2NpQCgsMjzaAAv2uEe7GE2f32q',
           '01000000005', 'Demo Delivery House, Road 5' FROM dual
    UNION ALL SELECT 'admin', 'Demo Admin', 'admin@shopsphere.test',
           '$2b$12$YphciKYSXIqqLaGDGQt1ZuUzK6WPcwG72brCR2.gyJzgZGUgJrbKa',
           '01000000006', 'Demo Admin House, Road 6' FROM dual
) v
JOIN roles r ON r.role_name = v.role_name
JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.email = v.email)
/

INSERT INTO delivery_personnel (delivery_person_id, vehicle_info, active_status, earnings)
SELECT u.user_id, 'Demo bicycle; carrier bag', 'available', 0
FROM users u JOIN roles r ON r.role_id = u.user_role
WHERE u.email = 'delivery@shopsphere.test' AND r.role_name = 'delivery'
  AND NOT EXISTS (
    SELECT 1 FROM delivery_personnel d WHERE d.delivery_person_id = u.user_id)
/

-- 3. Shops belong to vendors. Existing demo accounts keep their current profile.
INSERT INTO shops (owner, name, description, phone_numbers, address)
SELECT u.user_id, v.name, v.description, v.phone, l.location_id
FROM (
    SELECT 'vendor@shopsphere.test' AS email, 'Demo Tech Corner' AS name,
           'Demo electronics and everyday accessories.' AS description,
           '01000000003' AS phone, 'Demo Tech Shop, Road 3' AS street FROM dual
    UNION ALL SELECT 'vendor2@shopsphere.test', 'Demo Gadget House',
           'A second seller for price and ownership comparisons.',
           '01000000004', 'Demo Gadget Shop, Road 4' FROM dual
) v
JOIN users u ON u.email = v.email
JOIN roles r ON r.role_id = u.user_role AND r.role_name = 'vendor'
JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
WHERE NOT EXISTS (SELECT 1 FROM shops s WHERE s.owner = u.user_id AND s.name = v.name)
/

INSERT INTO categories (name, description)
SELECT v.name, v.description
FROM (
    SELECT 'Demo Electronics' AS name, 'Fictional electronics for testing.' AS description FROM dual
    UNION ALL SELECT 'Demo Home', 'Fictional home accessories for testing.' FROM dual
) v
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = v.name AND c.parent_category IS NULL)
/

INSERT INTO master_products (manufacturer, name, description, category_id, wholesale_price)
SELECT 'ShopSphere Demo', v.name, v.description, c.category_id, v.price
FROM (
    SELECT 'Demo Wireless Keyboard' AS name, 'Compact wireless keyboard.' AS description,
           'Demo Electronics' AS category, 25.00 AS price FROM dual
    UNION ALL SELECT 'Demo Bluetooth Headphones', 'Over-ear wireless headphones.',
           'Demo Electronics', 40.00 FROM dual
    UNION ALL SELECT 'Demo Fitness Watch', 'A watch for everyday activity tracking.',
           'Demo Electronics', 60.00 FROM dual
    UNION ALL SELECT 'Demo Desk Lamp', 'USB-powered adjustable desk lamp.',
           'Demo Home', 12.00 FROM dual
) v
JOIN categories c ON c.name = v.category AND c.parent_category IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM master_products mp WHERE mp.name = v.name AND mp.manufacturer = 'ShopSphere Demo'
)
/

-- The same master product has different prices at different shops.
-- Stock is the remaining sample stock AFTER the historical orders below.
-- One out-of-stock listing is intentional, to exercise the cart error message.
INSERT INTO products (name, master_prod_id, description, shop_id, in_stock, unit_price)
SELECT mp.name, mp.master_prod_id, mp.description, s.shop_id, v.stock, v.price
FROM (
    SELECT 'vendor@shopsphere.test' AS email, 'Demo Tech Corner' AS shop,
           'Demo Wireless Keyboard' AS product, 20 AS stock, 35.00 AS price FROM dual
    UNION ALL SELECT 'vendor@shopsphere.test', 'Demo Tech Corner',
           'Demo Bluetooth Headphones', 12, 55.00 FROM dual
    UNION ALL SELECT 'vendor@shopsphere.test', 'Demo Tech Corner',
           'Demo Fitness Watch', 8, 80.00 FROM dual
    UNION ALL SELECT 'vendor@shopsphere.test', 'Demo Tech Corner',
           'Demo Desk Lamp', 15, 20.00 FROM dual
    UNION ALL SELECT 'vendor2@shopsphere.test', 'Demo Gadget House',
           'Demo Wireless Keyboard', 18, 33.00 FROM dual
    UNION ALL SELECT 'vendor2@shopsphere.test', 'Demo Gadget House',
           'Demo Bluetooth Headphones', 10, 52.00 FROM dual
    UNION ALL SELECT 'vendor2@shopsphere.test', 'Demo Gadget House',
           'Demo Fitness Watch', 6, 78.00 FROM dual
    UNION ALL SELECT 'vendor2@shopsphere.test', 'Demo Gadget House',
           'Demo Desk Lamp', 0, 19.00 FROM dual
) v
JOIN users u ON u.email = v.email
JOIN shops s ON s.owner = u.user_id AND s.name = v.shop
JOIN master_products mp ON mp.name = v.product AND mp.manufacturer = 'ShopSphere Demo'
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.shop_id = s.shop_id AND p.master_prod_id = mp.master_prod_id)
/

-- Historical wholesale acquisitions corresponding to the demo listings. The
-- balance is debited for exactly the rows this statement is about to insert, so
-- the fixture replays its own ledger instead of leaving the spend unrecorded: the
-- balance identity the tests assert — delivered sales + top-ups − purchases +
-- refunds — can only hold if the stock a shop bought was actually taken out of
-- its money.
--
-- The debit comes first and carries the same NOT EXISTS the insert does, which is
-- what makes it "the rows about to be added". A reseed finds the purchases
-- already there, so neither statement matches anything and nothing is debited.
-- PostgreSQL did this the other way round, with INSERT ... RETURNING feeding the
-- UPDATE; Oracle has no RETURNING that answers with every row it wrote.
UPDATE shops
SET balance = balance - (
    SELECT COALESCE(SUM((p.in_stock + 5) * mp.wholesale_price), 0)
    FROM products p
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.shop_id = shops.shop_id
      AND mp.manufacturer = 'ShopSphere Demo'
      AND NOT EXISTS (
        SELECT 1 FROM shop_purchases sp
        WHERE sp.shop_id = p.shop_id AND sp.master_prod_id = p.master_prod_id)
)
WHERE EXISTS (
    SELECT 1 FROM products p
    JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
    WHERE p.shop_id = shops.shop_id
      AND mp.manufacturer = 'ShopSphere Demo'
      AND NOT EXISTS (
        SELECT 1 FROM shop_purchases sp
        WHERE sp.shop_id = p.shop_id AND sp.master_prod_id = p.master_prod_id)
)
/

INSERT INTO shop_purchases (shop_id, master_prod_id, quantity, wholesale_unit_price)
SELECT p.shop_id, p.master_prod_id, p.in_stock + 5, mp.wholesale_price
FROM products p JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
WHERE mp.manufacturer = 'ShopSphere Demo'
  AND NOT EXISTS (SELECT 1 FROM shop_purchases sp WHERE sp.shop_id=p.shop_id AND sp.master_prod_id=p.master_prod_id)
/

-- 4. Attribute definitions, allowed category attributes, and product values.
INSERT INTO attributes (name, description)
SELECT v.name, v.description
FROM (
    SELECT 'Demo Color' AS name, 'Color of the demo product.' AS description FROM dual
    UNION ALL SELECT 'Demo Connection', 'Connection or power type.' FROM dual
) v
WHERE NOT EXISTS (SELECT 1 FROM attributes a WHERE a.name = v.name)
/

INSERT INTO category_attributes (category_id, attribute_id)
SELECT c.category_id, a.attribute_id
FROM categories c CROSS JOIN attributes a
WHERE c.name IN ('Demo Electronics', 'Demo Home') AND c.parent_category IS NULL
  AND a.name IN ('Demo Color', 'Demo Connection')
  AND NOT EXISTS (
    SELECT 1 FROM category_attributes ca
    WHERE ca.category_id = c.category_id AND ca.attribute_id = a.attribute_id)
/

INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
SELECT mp.master_prod_id, a.attribute_id, v.attrib_value
FROM (
    SELECT 'Demo Wireless Keyboard' AS product, 'Demo Color' AS attribute_name,
           'Black' AS attrib_value FROM dual
    UNION ALL SELECT 'Demo Wireless Keyboard', 'Demo Connection', 'Bluetooth' FROM dual
    UNION ALL SELECT 'Demo Bluetooth Headphones', 'Demo Color', 'Blue' FROM dual
    UNION ALL SELECT 'Demo Bluetooth Headphones', 'Demo Connection', 'Bluetooth' FROM dual
    UNION ALL SELECT 'Demo Fitness Watch', 'Demo Color', 'Black' FROM dual
    UNION ALL SELECT 'Demo Fitness Watch', 'Demo Connection', 'Bluetooth' FROM dual
    UNION ALL SELECT 'Demo Desk Lamp', 'Demo Color', 'White' FROM dual
    UNION ALL SELECT 'Demo Desk Lamp', 'Demo Connection', 'USB' FROM dual
) v
JOIN master_products mp ON mp.name = v.product AND mp.manufacturer = 'ShopSphere Demo'
JOIN attributes a ON a.name = v.attribute_name
WHERE NOT EXISTS (
    SELECT 1 FROM attribute_values av
    WHERE av.master_prod_id = mp.master_prod_id AND av.attribute_id = a.attribute_id)
/

-- 5. Each customer's collections are independent.
INSERT INTO cart_items (user_id, prod_id, quantity)
SELECT u.user_id, p.prod_id, v.quantity
FROM (
    SELECT 'customer@shopsphere.test' AS customer, 'vendor@shopsphere.test' AS vendor,
           'Demo Tech Corner' AS shop, 'Demo Wireless Keyboard' AS product,
           2 AS quantity FROM dual
    UNION ALL SELECT 'customer@shopsphere.test', 'vendor2@shopsphere.test',
           'Demo Gadget House', 'Demo Fitness Watch', 1 FROM dual
    UNION ALL SELECT 'customer2@shopsphere.test', 'vendor@shopsphere.test',
           'Demo Tech Corner', 'Demo Bluetooth Headphones', 1 FROM dual
) v
JOIN users u ON u.email = v.customer
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE p.in_stock >= v.quantity AND p.discontinued = 0
  AND s.active_status = 'active' AND mp.active_status = 'available'
  AND NOT EXISTS (
    SELECT 1 FROM cart_items c WHERE c.user_id = u.user_id AND c.prod_id = p.prod_id)
/

INSERT INTO wish_list_items (user_id, prod_id)
SELECT u.user_id, p.prod_id
FROM (
    SELECT 'customer@shopsphere.test' AS customer, 'vendor@shopsphere.test' AS vendor,
           'Demo Tech Corner' AS shop, 'Demo Bluetooth Headphones' AS product FROM dual
    UNION ALL SELECT 'customer@shopsphere.test', 'vendor2@shopsphere.test',
           'Demo Gadget House', 'Demo Desk Lamp' FROM dual
    UNION ALL SELECT 'customer2@shopsphere.test', 'vendor2@shopsphere.test',
           'Demo Gadget House', 'Demo Wireless Keyboard' FROM dual
) v
JOIN users u ON u.email = v.customer
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE p.discontinued = 0 AND s.active_status = 'active' AND mp.active_status = 'available'
  AND NOT EXISTS (
    SELECT 1 FROM wish_list_items w WHERE w.user_id = u.user_id AND w.prod_id = p.prod_id)
/

-- 6. Fixed timestamps identify the two historical demo orders across reruns.
-- The delivered order spans both shops; the other order awaits assignment.
--
-- The orders this run inserts have to be told apart from the ones an earlier run
-- left behind, because the money movements near the end of this file pay out for
-- what this run delivered and must not pay for it twice. So the insert is a loop
-- over the two rows, one guarded insert at a time, and the id of each row that was
-- actually written goes into seed_run_orders. A rerun inserts nothing and leaves
-- that table empty, which is what makes the movements no-ops.
--
-- PostgreSQL could write this as INSERT ... RETURNING inside a CTE. Oracle has no
-- RETURNING that answers with every row it wrote — and this loop is one row at a
-- time, which is all a fixture needs.
DECLARE
    v_found    NUMBER;
    v_order_id orders.order_id%TYPE;

    CURSOR plan IS
        SELECT u.user_id, l.location_id AS address, v.status,
               c.delivery_person_id AS courier_id
        FROM (
            SELECT 'customer@shopsphere.test' AS email, 'delivered' AS status,
                   'Demo Customer House, Road 1' AS street FROM dual
            UNION ALL SELECT 'customer2@shopsphere.test', 'pending',
                   'Demo Customer House, Road 2' FROM dual
        ) v
        JOIN users u ON u.email = v.email
        JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
        CROSS JOIN (
            SELECT courier.delivery_person_id
            FROM delivery_personnel courier
            JOIN users cu ON cu.user_id = courier.delivery_person_id
            WHERE cu.email = 'delivery@shopsphere.test'
        ) c;
BEGIN
    FOR row_plan IN plan LOOP
        SELECT COUNT(*) INTO v_found
        FROM orders o
        WHERE o.user_id = row_plan.user_id
          AND o.created_at = TIMESTAMP '2026-09-01 10:00:00';

        IF v_found = 0 THEN
            INSERT INTO orders (user_id, order_status, shipping_address,
                                delivery_person_id, created_at, delivered_at)
            VALUES (row_plan.user_id, row_plan.status, row_plan.address,
                    CASE WHEN row_plan.status = 'delivered'
                         THEN row_plan.courier_id END,
                    TIMESTAMP '2026-09-01 10:00:00',
                    CASE WHEN row_plan.status = 'delivered'
                         THEN TIMESTAMP '2026-09-03 15:00:00' END)
            RETURNING order_id INTO v_order_id;

            INSERT INTO seed_run_orders (order_id) VALUES (v_order_id);
        END IF;
    END LOOP;
END;
/

-- The schema trigger calculates total_amount from these price snapshots.
INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
SELECT o.order_id, p.prod_id, v.quantity, p.unit_price
FROM (
    SELECT 'customer@shopsphere.test' AS customer, 'vendor@shopsphere.test' AS vendor,
           'Demo Tech Corner' AS shop, 'Demo Wireless Keyboard' AS product,
           1 AS quantity FROM dual
    UNION ALL SELECT 'customer@shopsphere.test', 'vendor@shopsphere.test',
           'Demo Tech Corner', 'Demo Bluetooth Headphones', 1 FROM dual
    UNION ALL SELECT 'customer@shopsphere.test', 'vendor2@shopsphere.test',
           'Demo Gadget House', 'Demo Fitness Watch', 1 FROM dual
    UNION ALL SELECT 'customer2@shopsphere.test', 'vendor2@shopsphere.test',
           'Demo Gadget House', 'Demo Wireless Keyboard', 1 FROM dual
) v
JOIN users u ON u.email = v.customer
JOIN orders o ON o.user_id = u.user_id AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE o.order_id IN (SELECT order_id FROM seed_run_orders)
  AND NOT EXISTS (
    SELECT 1 FROM order_items oi WHERE oi.order_id = o.order_id AND oi.prod_id = p.prod_id)
/

-- Price the trip the way RECORD_DELIVERY_COST does at placement. This has to
-- land before the payment below, because the payment is the goods plus this
-- charge — the customer's delivery charge and the courier's pay are one number.
--
-- COURIER_BASE_FEE and COURIER_RATE are repeated from
-- src/db/queries/orderQueries.js, the one place they are defined. A .sql file
-- cannot import a JavaScript constant, so changing a rate means changing both.
UPDATE orders
SET delivery_cost = ROUND(3 + 0.02 * total_amount, 2)
WHERE order_id IN (SELECT order_id FROM seed_run_orders)
/

-- No money is charged: these are fictional cash-on-delivery records.
INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
SELECT o.order_id, o.total_amount + o.delivery_cost, 'cash_on_delivery',
       CASE WHEN o.order_status = 'delivered' THEN 'completed' ELSE 'pending' END,
       CASE WHEN o.order_status = 'delivered' THEN o.delivered_at END
FROM orders o
WHERE o.order_id IN (SELECT order_id FROM seed_run_orders)
  AND o.order_status IN ('delivered', 'pending')
  AND NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.order_id)
/

-- 7. Reviews are only attached to products/shops in a delivered demo order.
INSERT INTO product_reviews (user_id, prod_id, rating, review)
SELECT o.user_id, oi.prod_id, 5, 'Demo review: the product arrived as described.'
FROM orders o
JOIN users u ON u.user_id = o.user_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE u.email = 'customer@shopsphere.test' AND o.order_status = 'delivered'
  AND o.order_id IN (SELECT order_id FROM seed_run_orders)
  AND NOT EXISTS (
    SELECT 1 FROM product_reviews pr
    WHERE pr.user_id = o.user_id AND pr.prod_id = oi.prod_id)
/

INSERT INTO shop_reviews (user_id, shop_id, rating, review)
SELECT DISTINCT o.user_id, p.shop_id, 5, 'Demo review: helpful seller and careful packaging.'
FROM orders o
JOIN users u ON u.user_id = o.user_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p ON p.prod_id = oi.prod_id
WHERE u.email = 'customer@shopsphere.test' AND o.order_status = 'delivered'
  AND o.order_id IN (SELECT order_id FROM seed_run_orders)
  AND NOT EXISTS (
    SELECT 1 FROM shop_reviews sr
    WHERE sr.user_id = o.user_id AND sr.shop_id = p.shop_id)
/

-- 8. The courier earnings and shop balances the placement and delivery rules fill.
-- Both rules were written after this file was, so a seeded delivered order would
-- otherwise leave the courier a balance that never moved and the shops unpaid for
-- stock that had demonstrably sold. The figures below are exactly what settling
-- those orders would have produced.
--
-- Scoped to the orders this run inserted by seed_run_orders, so this never
-- rewrites a real order, and a rerun credits nothing a second time.
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

-- Each shop is paid for its own lines, in full, the way settle_delivery does it.
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

-- The capital each shop bought its stock with, and the charge for it.
--
-- shops.balance is a running total of sales, top-ups, purchases and refunds, so a
-- fixture that wrote the purchases above without the money that funded them would
-- leave a balance reconciling with nothing. Each shop is brought up to its
-- purchases plus a float, and the ledger row is written for exactly the gap.
--
-- seed_extended.sql carries the same statement, so the two compose: whichever
-- runs second funds only what it added, and a reseed finds no gap and writes
-- nothing at all.
--
-- The float is deliberate: a shop with no capital could not buy anything through
-- the API, which is the whole point of the column.
--
-- A cursor rather than PostgreSQL's INSERT ... RETURNING feeding an UPDATE, for
-- the same reason as the orders above: the gap has to be computed before the
-- top-up row that closes it is written, and Oracle can only give the inserted
-- value back one row at a time.
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

-- The scratch table has done its job. It is ON COMMIT DELETE ROWS, so it would
-- empty itself at the commit anyway; emptying it here says so at the point the
-- last reader of it has finished.
DELETE FROM seed_run_orders
/
