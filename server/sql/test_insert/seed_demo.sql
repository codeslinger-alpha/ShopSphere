-- LOCAL DEMO DATA ONLY. Run with `npm run seed` from server/.
-- The runner wraps this entire file in one transaction: all rows succeed or none do.
-- Identity IDs are looked up through stable demo names/emails, never assumed.
-- Existing rows are left unchanged; rerunning does not reset stock or passwords.

-- 1. Reference data must exist before rows that reference it.
INSERT INTO roles (role_name, description)
VALUES ('customer', 'Normal customer'), ('vendor', 'Shop vendor'),
       ('delivery', 'Delivery personnel'), ('admin', 'System administrator')
ON CONFLICT (role_name) DO NOTHING;

INSERT INTO countries (country_id, country_name)
VALUES ('BD', 'Bangladesh')
ON CONFLICT DO NOTHING;

INSERT INTO locations (street_address, postal_code, city, state_province, country_id)
SELECT v.street, '1205', 'Dhaka', 'Dhaka', c.country_id
FROM (VALUES
    ('Demo Customer House, Road 1'), ('Demo Customer House, Road 2'),
    ('Demo Tech Shop, Road 3'), ('Demo Gadget Shop, Road 4'),
    ('Demo Delivery House, Road 5'), ('Demo Admin House, Road 6')
) AS v(street)
JOIN countries c ON c.country_name = 'Bangladesh'
WHERE NOT EXISTS (
    SELECT 1 FROM locations l WHERE l.street_address = v.street AND l.country_id = c.country_id
);

-- No permission or grant rows: those tables are gone (see
-- sql/migrations/009_drop_permissions.sql). Authorization here is
-- requireRole(roleName) on a mounted router, and the seed only has to create the
-- users that hold those roles.

-- 2. Six accounts: two customers/vendors allow ownership-isolation demonstrations.
-- Each hash uses its own bcrypt salt, with cost 12.
-- Customers: CustomerPass123! | Vendors: VendorPass123!
-- Delivery: DeliveryPass123!  | Admin: AdminPass123!
INSERT INTO users (user_role, name, email, password_hash, phone_numbers, address)
SELECT r.role_id, v.name, v.email, v.password_hash, v.phone, l.location_id
FROM (VALUES
    ('customer', 'Demo Customer', 'customer@shopsphere.test', '$2b$12$0FsSWCFEJmzpYgpeDsJM8.jZUrx23lA6NS2GqlY45PN7qMYZosMXu', '01000000001', 'Demo Customer House, Road 1'),
    ('customer', 'Demo Customer Two', 'customer2@shopsphere.test', '$2b$12$Avry/G0gUXfeqTtnM.X6N.QmfjGGMOKshNtpztrIzgU/jyn553tY.', '01000000002', 'Demo Customer House, Road 2'),
    ('vendor', 'Demo Vendor', 'vendor@shopsphere.test', '$2b$12$kl8MER9AlKkJds8vf5vd1O63gKUSMRmLp2HS4L8EbY3n7gZnD6gwS', '01000000003', 'Demo Tech Shop, Road 3'),
    ('vendor', 'Demo Vendor Two', 'vendor2@shopsphere.test', '$2b$12$BBaKPoIyhMUY6BgUck9l5OAApfpiZbnHsyPfronBpu.vbY1Q3bbV.', '01000000004', 'Demo Gadget Shop, Road 4'),
    ('delivery', 'Demo Delivery', 'delivery@shopsphere.test', '$2b$12$YGw9lBHq6E7pThCFvDHCN.gNkXG2NpQCgsMjzaAAv2uEe7GE2f32q', '01000000005', 'Demo Delivery House, Road 5'),
    ('admin', 'Demo Admin', 'admin@shopsphere.test', '$2b$12$YphciKYSXIqqLaGDGQt1ZuUzK6WPcwG72brCR2.gyJzgZGUgJrbKa', '01000000006', 'Demo Admin House, Road 6')
) AS v(role_name, name, email, password_hash, phone, street)
JOIN roles r ON r.role_name = v.role_name
JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
ON CONFLICT (email) DO NOTHING;

INSERT INTO delivery_personnel (delivery_person_id, vehicle_info, active_status, earnings)
SELECT u.user_id, 'Demo bicycle; carrier bag', 'available', 0
FROM users u JOIN roles r ON r.role_id = u.user_role
WHERE u.email = 'delivery@shopsphere.test' AND r.role_name = 'delivery'
ON CONFLICT DO NOTHING;

-- 3. Shops belong to vendors. Existing demo accounts keep their current profile.
INSERT INTO shops (owner, name, description, phone_numbers, address)
SELECT u.user_id, v.name, v.description, v.phone, l.location_id
FROM (VALUES
    ('vendor@shopsphere.test', 'Demo Tech Corner', 'Demo electronics and everyday accessories.', '01000000003', 'Demo Tech Shop, Road 3'),
    ('vendor2@shopsphere.test', 'Demo Gadget House', 'A second seller for price and ownership comparisons.', '01000000004', 'Demo Gadget Shop, Road 4')
) AS v(email, name, description, phone, street)
JOIN users u ON u.email = v.email
JOIN roles r ON r.role_id = u.user_role AND r.role_name = 'vendor'
JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
WHERE NOT EXISTS (SELECT 1 FROM shops s WHERE s.owner = u.user_id AND s.name = v.name);

INSERT INTO categories (name, description)
SELECT v.name, v.description
FROM (VALUES ('Demo Electronics', 'Fictional electronics for testing.'),
             ('Demo Home', 'Fictional home accessories for testing.')) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM categories c WHERE c.name = v.name AND c.parent_category IS NULL);

INSERT INTO master_products (manufacturer, name, description, category_id, wholesale_price)
SELECT 'ShopSphere Demo', v.name, v.description, c.category_id, v.price
FROM (VALUES
    ('Demo Wireless Keyboard', 'Compact wireless keyboard.', 'Demo Electronics', 25.00),
    ('Demo Bluetooth Headphones', 'Over-ear wireless headphones.', 'Demo Electronics', 40.00),
    ('Demo Fitness Watch', 'A watch for everyday activity tracking.', 'Demo Electronics', 60.00),
    ('Demo Desk Lamp', 'USB-powered adjustable desk lamp.', 'Demo Home', 12.00)
) AS v(name, description, category, price)
JOIN categories c ON c.name = v.category AND c.parent_category IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM master_products mp WHERE mp.name = v.name AND mp.manufacturer = 'ShopSphere Demo'
);

-- The same master product has different prices at different shops.
-- Stock is the remaining sample stock AFTER the historical orders below.
-- One out-of-stock listing is intentional, to exercise the cart error message.
INSERT INTO products (name, master_prod_id, description, shop_id, in_stock, unit_price)
SELECT mp.name, mp.master_prod_id, mp.description, s.shop_id, v.stock, v.price
FROM (VALUES
    ('vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Wireless Keyboard', 20, 35.00),
    ('vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Bluetooth Headphones', 12, 55.00),
    ('vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Fitness Watch', 8, 80.00),
    ('vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Desk Lamp', 15, 20.00),
    ('vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Wireless Keyboard', 18, 33.00),
    ('vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Bluetooth Headphones', 10, 52.00),
    ('vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Fitness Watch', 6, 78.00),
    ('vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Desk Lamp', 0, 19.00)
) AS v(email, shop, product, stock, price)
JOIN users u ON u.email = v.email
JOIN shops s ON s.owner = u.user_id AND s.name = v.shop
JOIN master_products mp ON mp.name = v.product AND mp.manufacturer = 'ShopSphere Demo'
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.shop_id = s.shop_id AND p.master_prod_id = mp.master_prod_id);

-- Historical wholesale acquisitions corresponding to the demo listings.
INSERT INTO shop_purchases (shop_id, master_prod_id, quantity, wholesale_unit_price)
SELECT p.shop_id, p.master_prod_id, p.in_stock + 5, mp.wholesale_price
FROM products p JOIN master_products mp ON mp.master_prod_id = p.master_prod_id
WHERE mp.manufacturer = 'ShopSphere Demo'
  AND NOT EXISTS (SELECT 1 FROM shop_purchases sp WHERE sp.shop_id=p.shop_id AND sp.master_prod_id=p.master_prod_id);

-- 4. Attribute definitions, allowed category attributes, and product values.
INSERT INTO attributes (name, description)
SELECT v.name, v.description
FROM (VALUES ('Demo Color', 'Color of the demo product.'),
             ('Demo Connection', 'Connection or power type.')) AS v(name, description)
WHERE NOT EXISTS (SELECT 1 FROM attributes a WHERE a.name = v.name);

INSERT INTO category_attributes (category_id, attribute_id)
SELECT c.category_id, a.attribute_id
FROM categories c CROSS JOIN attributes a
WHERE c.name IN ('Demo Electronics', 'Demo Home') AND c.parent_category IS NULL
  AND a.name IN ('Demo Color', 'Demo Connection')
ON CONFLICT DO NOTHING;

INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
SELECT mp.master_prod_id, a.attribute_id, v.value
FROM (VALUES
    ('Demo Wireless Keyboard', 'Demo Color', 'Black'), ('Demo Wireless Keyboard', 'Demo Connection', 'Bluetooth'),
    ('Demo Bluetooth Headphones', 'Demo Color', 'Blue'), ('Demo Bluetooth Headphones', 'Demo Connection', 'Bluetooth'),
    ('Demo Fitness Watch', 'Demo Color', 'Black'), ('Demo Fitness Watch', 'Demo Connection', 'Bluetooth'),
    ('Demo Desk Lamp', 'Demo Color', 'White'), ('Demo Desk Lamp', 'Demo Connection', 'USB')
) AS v(product, attribute, value)
JOIN master_products mp ON mp.name = v.product AND mp.manufacturer = 'ShopSphere Demo'
JOIN attributes a ON a.name = v.attribute
ON CONFLICT DO NOTHING;

-- 5. Each customer's collections are independent.
INSERT INTO cart_items (user_id, prod_id, quantity)
SELECT u.user_id, p.prod_id, v.quantity
FROM (VALUES
    ('customer@shopsphere.test', 'vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Wireless Keyboard', 2),
    ('customer@shopsphere.test', 'vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Fitness Watch', 1),
    ('customer2@shopsphere.test', 'vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Bluetooth Headphones', 1)
) AS v(customer, vendor, shop, product, quantity)
JOIN users u ON u.email = v.customer
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE p.in_stock >= v.quantity AND p.discontinued = false
  AND s.active_status = 'active' AND mp.active_status = 'available'
ON CONFLICT DO NOTHING;

INSERT INTO wish_list_items (user_id, prod_id)
SELECT u.user_id, p.prod_id
FROM (VALUES
    ('customer@shopsphere.test', 'vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Bluetooth Headphones'),
    ('customer@shopsphere.test', 'vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Desk Lamp'),
    ('customer2@shopsphere.test', 'vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Wireless Keyboard')
) AS v(customer, vendor, shop, product)
JOIN users u ON u.email = v.customer
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE p.discontinued = false AND s.active_status = 'active' AND mp.active_status = 'available'
ON CONFLICT DO NOTHING;

-- 6. Fixed timestamps identify the two historical demo orders across reruns.
-- The delivered order spans both shops; the other order awaits assignment.
INSERT INTO orders (user_id, order_status, shipping_address, delivery_person_id, created_at, delivered_at)
SELECT u.user_id, v.status, l.location_id,
       CASE WHEN v.status = 'delivered' THEN d.delivery_person_id ELSE NULL END,
       TIMESTAMP '2026-09-01 10:00:00',
       CASE WHEN v.status = 'delivered' THEN TIMESTAMP '2026-09-03 15:00:00' ELSE NULL END
FROM (VALUES
    ('customer@shopsphere.test', 'delivered', 'Demo Customer House, Road 1'),
    ('customer2@shopsphere.test', 'pending', 'Demo Customer House, Road 2')
) AS v(email, status, street)
JOIN users u ON u.email = v.email
JOIN locations l ON l.street_address = v.street AND l.city = 'Dhaka'
JOIN users courier ON courier.email = 'delivery@shopsphere.test'
JOIN delivery_personnel d ON d.delivery_person_id = courier.user_id
WHERE NOT EXISTS (
    SELECT 1 FROM orders o WHERE o.user_id = u.user_id AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
);

-- The schema trigger calculates total_amount from these price snapshots.
INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
SELECT o.order_id, p.prod_id, v.quantity, p.unit_price
FROM (VALUES
    ('customer@shopsphere.test', 'vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Wireless Keyboard', 1),
    ('customer@shopsphere.test', 'vendor@shopsphere.test', 'Demo Tech Corner', 'Demo Bluetooth Headphones', 1),
    ('customer@shopsphere.test', 'vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Fitness Watch', 1),
    ('customer2@shopsphere.test', 'vendor2@shopsphere.test', 'Demo Gadget House', 'Demo Wireless Keyboard', 1)
) AS v(customer, vendor, shop, product, quantity)
JOIN users u ON u.email = v.customer
JOIN orders o ON o.user_id = u.user_id AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
JOIN users owner_user ON owner_user.email = v.vendor
JOIN shops s ON s.owner = owner_user.user_id AND s.name = v.shop
JOIN products p ON p.shop_id = s.shop_id AND p.name = v.product
JOIN master_products mp ON mp.master_prod_id = p.master_prod_id AND mp.manufacturer = 'ShopSphere Demo'
WHERE o.order_status <> 'cancelled'
ON CONFLICT DO NOTHING;

-- No money is charged: these are fictional cash-on-delivery records.
INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
SELECT o.order_id, o.total_amount + o.delivery_cost, 'cash_on_delivery',
       CASE WHEN o.order_status = 'delivered' THEN 'completed' ELSE 'pending' END,
       CASE WHEN o.order_status = 'delivered' THEN o.delivered_at ELSE NULL END
FROM orders o JOIN users u ON u.user_id = o.user_id
WHERE u.email IN ('customer@shopsphere.test', 'customer2@shopsphere.test')
  AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
  AND o.order_status IN ('delivered', 'pending')
  AND NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.order_id = o.order_id);

-- 7. Reviews are only attached to products/shops in a delivered demo order.
INSERT INTO product_reviews (user_id, prod_id, rating, review)
SELECT o.user_id, oi.prod_id, 5, 'Demo review: the product arrived as described.'
FROM orders o
JOIN users u ON u.user_id = o.user_id
JOIN order_items oi ON oi.order_id = o.order_id
WHERE u.email = 'customer@shopsphere.test' AND o.order_status = 'delivered'
  AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
ON CONFLICT DO NOTHING;

INSERT INTO shop_reviews (user_id, shop_id, rating, review)
SELECT DISTINCT o.user_id, p.shop_id, 5, 'Demo review: helpful seller and careful packaging.'
FROM orders o
JOIN users u ON u.user_id = o.user_id
JOIN order_items oi ON oi.order_id = o.order_id
JOIN products p ON p.prod_id = oi.prod_id
WHERE u.email = 'customer@shopsphere.test' AND o.order_status = 'delivered'
  AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
ON CONFLICT DO NOTHING;

-- 8. The money columns the placement and delivery rules fill.
-- The commission and courier-pay rules were written after this file was, so a
-- seeded order would otherwise show the admin payments screen a column of zeroes
-- and the courier a balance that never moved. The figures below are exactly what
-- placing and delivering these orders would have produced.
--
-- The rates mirror PLATFORM_COMMISSION_RATE, COURIER_BASE_FEE and COURIER_RATE in
-- src/db/queries/orderQueries.js — the one place they are defined. They are repeated
-- here because a .sql file cannot import a JavaScript constant, and changing a
-- rate means changing both.
--
-- Scoped to the seed's own orders by created_at, so this never rewrites a real
-- order. Cancelled orders are skipped: fn_cleanup_cancelled_order zeroes their
-- commission on purpose.
UPDATE order_items oi
SET platform_commission = ROUND(oi.quantity * oi.unit_price * 0.05, 2)
FROM orders o
WHERE o.order_id = oi.order_id
  AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
  AND o.order_status <> 'cancelled';

-- Summed from the lines, the way RECORD_PLATFORM_COMMISSION does it at placement.
UPDATE orders o
SET platform_commission = (
    SELECT COALESCE(SUM(oi.platform_commission), 0)
    FROM order_items oi WHERE oi.order_id = o.order_id
)
WHERE o.created_at = TIMESTAMP '2026-09-01 10:00:00'
  AND o.order_status <> 'cancelled';

UPDATE delivery_personnel d
SET earnings = 3 + ROUND(0.02 * o.total_amount, 2)
FROM orders o
WHERE o.delivery_person_id = d.delivery_person_id
  AND o.created_at = TIMESTAMP '2026-09-01 10:00:00'
  AND o.order_status = 'delivered';

