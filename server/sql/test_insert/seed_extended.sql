-- Expanded fictional demo data. Loaded after seed_demo.sql in the same transaction.
-- Stable emails/names/timestamps identify fixtures; reruns do not reset existing rows.
-- Generated accounts reuse the public base-demo password hash for their role.
CREATE TEMP TABLE seed_accounts ON COMMIT DROP AS
SELECT role, n, format('%s%s@shopsphere.test', role, lpad(n::text, 2, '0')) AS email,
       format('Demo %s %s', initcap(role), lpad(n::text, 2, '0')) AS name,
       format('Expanded Demo %s House %s', role, n) AS street,
       (ARRAY['Dhaka', 'Chattogram', 'Sylhet', 'Rajshahi'])[1 + n % 4] AS city
FROM (VALUES ('customer', 30), ('vendor', 6), ('delivery', 4)) AS roles(role, count)
CROSS JOIN LATERAL generate_series(1, count) AS n;

INSERT INTO locations (street_address, postal_code, city, state_province, country_id)
SELECT a.street, '1200', a.city, a.city, 'BD' FROM seed_accounts a
WHERE NOT EXISTS (SELECT 1 FROM locations l WHERE l.street_address=a.street AND l.country_id='BD');

INSERT INTO users (user_role, name, email, password_hash, phone_numbers, address)
SELECT r.role_id, a.name, a.email, base.password_hash,
       '017' || lpad((row_number() OVER (ORDER BY a.email))::text, 8, '0'), l.location_id
FROM seed_accounts a JOIN roles r ON r.role_name=a.role
JOIN users base ON base.email=a.role || '@shopsphere.test'
JOIN locations l ON l.street_address=a.street AND l.country_id='BD'
ON CONFLICT (email) DO NOTHING;

INSERT INTO delivery_personnel (delivery_person_id, vehicle_info, vehicle_type, vehicle_number, active_status, earnings)
SELECT u.user_id, 'Demo vehicle and insulated delivery bag',
       (ARRAY['bicycle','motorcycle','car','van'])[a.n], 'DEMO-' || a.n,
       CASE WHEN a.n=4 THEN 'unavailable' ELSE 'available' END, 0
FROM seed_accounts a JOIN users u USING(email) WHERE a.role='delivery'
ON CONFLICT DO NOTHING;

INSERT INTO shops (owner, name, description, phone_numbers, address, active_status)
SELECT u.user_id, 'Demo Marketplace ' || a.n,
       '**Fictional seller** with a broad range for browsing and comparison.',
       u.phone_numbers, u.address,
       CASE a.n WHEN 5 THEN 'pending' WHEN 6 THEN 'disabled' ELSE 'active' END
FROM seed_accounts a JOIN users u USING(email) WHERE a.role='vendor'
AND NOT EXISTS (SELECT 1 FROM shops s WHERE s.owner=u.user_id AND s.name='Demo Marketplace ' || a.n);

CREATE TEMP TABLE seed_catalog (category TEXT, name TEXT, price NUMERIC(12,2)) ON COMMIT DROP;
INSERT INTO seed_catalog VALUES
('Demo Electronics','Demo USB-C Hub',18), ('Demo Electronics','Demo Portable Speaker',22),
('Demo Electronics','Demo Webcam',28), ('Demo Electronics','Demo Power Bank',15),
('Demo Electronics','Demo Gaming Mouse',16), ('Demo Electronics','Demo Tablet Stand',8),
('Demo Home','Demo Cotton Towel',6), ('Demo Home','Demo Ceramic Mug',4),
('Demo Home','Demo Storage Basket',9), ('Demo Home','Demo Wall Clock',11),
('Demo Home','Demo Cushion Cover',5), ('Demo Home','Demo Water Bottle',7),
('Demo Books','Demo SQL Workbook',10), ('Demo Books','Demo Programming Guide',14),
('Demo Books','Demo Travel Journal',5), ('Demo Books','Demo Bengali Stories',8),
('Demo Books','Demo Science Atlas',12), ('Demo Books','Demo Sketchbook',6),
('Demo Apparel','Demo Cotton T-Shirt',9), ('Demo Apparel','Demo Denim Jacket',28),
('Demo Apparel','Demo Running Socks',3), ('Demo Apparel','Demo Canvas Cap',5),
('Demo Apparel','Demo Raincoat',18), ('Demo Apparel','Demo Linen Scarf',7),
('Demo Sports','Demo Yoga Mat',12), ('Demo Sports','Demo Football',14),
('Demo Sports','Demo Badminton Racket',19), ('Demo Sports','Demo Jump Rope',4),
('Demo Sports','Demo Resistance Bands',8), ('Demo Sports','Demo Training Gloves',10),
('Demo Beauty','Demo Hand Cream',5), ('Demo Beauty','Demo Herbal Soap',3),
('Demo Beauty','Demo Travel Mirror',4), ('Demo Beauty','Demo Hair Brush',6),
('Demo Beauty','Demo Face Towel Set',7), ('Demo Beauty','Demo Toiletry Bag',8),
('Demo Groceries','Demo Tea Selection',6), ('Demo Groceries','Demo Coffee Beans',10),
('Demo Groceries','Demo Honey Jar',7), ('Demo Groceries','Demo Oat Biscuits',3),
('Demo Groceries','Demo Spice Box',9), ('Demo Groceries','Demo Rice Pack',5),
('Demo Toys','Demo Wooden Puzzle',8), ('Demo Toys','Demo Building Blocks',14),
('Demo Toys','Demo Toy Train',12), ('Demo Toys','Demo Plush Bear',9),
('Demo Toys','Demo Board Game',15), ('Demo Toys','Demo Art Kit',11);

INSERT INTO categories (name, description)
SELECT DISTINCT c.category, 'Fictional products for the expanded demonstration.' FROM seed_catalog c
WHERE NOT EXISTS (SELECT 1 FROM categories existing WHERE existing.name=c.category AND existing.parent_category IS NULL);

INSERT INTO master_products (manufacturer, name, description, category_id, wholesale_price)
SELECT 'ShopSphere Expanded Demo', c.name, '**Demo item.** For testing only.', category.category_id, c.price
FROM seed_catalog c JOIN categories category ON category.name=c.category AND category.parent_category IS NULL
WHERE NOT EXISTS (SELECT 1 FROM master_products mp WHERE mp.manufacturer='ShopSphere Expanded Demo' AND mp.name=c.name);

INSERT INTO attributes (name, description)
SELECT 'Demo Material', 'Material or format for catalog filtering.'
WHERE NOT EXISTS (SELECT 1 FROM attributes WHERE name='Demo Material');
INSERT INTO category_attributes (category_id, attribute_id)
SELECT c.category_id, a.attribute_id FROM categories c CROSS JOIN attributes a
WHERE c.name IN ('Demo Books','Demo Apparel','Demo Sports','Demo Beauty','Demo Groceries','Demo Toys')
AND a.name IN ('Demo Material','Demo Color') ON CONFLICT DO NOTHING;
INSERT INTO attribute_values (master_prod_id, attribute_id, attrib_value)
SELECT mp.master_prod_id, a.attribute_id,
       CASE a.name WHEN 'Demo Color' THEN (ARRAY['Blue','Black','White','Green'])[1+length(mp.name)%4]
         WHEN 'Demo Connection' THEN 'USB'
         ELSE (ARRAY['Cotton','Paper','Wood','Mixed'])[1+length(mp.name)%4] END
FROM master_products mp JOIN category_attributes ca ON ca.category_id=mp.category_id
JOIN attributes a USING(attribute_id)
WHERE mp.manufacturer='ShopSphere Expanded Demo' ON CONFLICT DO NOTHING;

CREATE TEMP TABLE seed_masters ON COMMIT DROP AS
SELECT mp.*, row_number() OVER (ORDER BY mp.name) AS n
FROM master_products mp WHERE mp.manufacturer='ShopSphere Expanded Demo';
INSERT INTO products (name, master_prod_id, description, shop_id, in_stock, unit_price, discontinued)
SELECT mp.name, mp.master_prod_id, 'Demo retail listing with seller-specific pricing.', s.shop_id,
       CASE WHEN mp.n%6=0 THEN 0 ELSE 10+mp.n%31 END,
       ROUND(mp.wholesale_price * (1.20 + a.n * 0.05), 2),
       s.active_status='disabled' OR mp.n%12=0
FROM seed_masters mp CROSS JOIN seed_accounts a JOIN users u ON u.email=a.email
JOIN shops s ON s.owner=u.user_id AND s.name='Demo Marketplace ' || a.n
WHERE a.role='vendor' AND NOT EXISTS (
    SELECT 1 FROM products p WHERE p.master_prod_id=mp.master_prod_id AND p.shop_id=s.shop_id
);

-- Orders use deterministic timestamps as fixture keys. Only newly inserted orders
-- receive items, payment records and earnings, so running the seed twice is safe.
CREATE TEMP TABLE seed_order_plan ON COMMIT DROP AS
SELECT n, u.user_id, u.address, TIMESTAMP '2026-08-01 10:00:00' + n * INTERVAL '1 day' AS created_at,
       (ARRAY['delivered','shipped','pending','cancelled'])[1+(n-1)%4] AS status,
       courier.user_id AS courier_id
FROM generate_series(1,32) n
JOIN users u ON u.email=format('customer%s@shopsphere.test', lpad((1+(n-1)%30)::text,2,'0'))
JOIN users courier ON courier.email=format('delivery%s@shopsphere.test',lpad((1+(n-1)%3)::text,2,'0'));
CREATE TEMP TABLE seed_new_orders (order_id INT PRIMARY KEY) ON COMMIT DROP;
WITH inserted AS (
    INSERT INTO orders (user_id, shipping_address, order_status, delivery_person_id, created_at, delivered_at)
    SELECT p.user_id, p.address, p.status,
           CASE WHEN p.status IN ('delivered','shipped') THEN p.courier_id END,
           p.created_at, CASE WHEN p.status='delivered' THEN p.created_at + INTERVAL '2 days' END
    FROM seed_order_plan p
    WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.user_id=p.user_id AND o.created_at=p.created_at)
    RETURNING order_id
) INSERT INTO seed_new_orders SELECT order_id FROM inserted;

CREATE TEMP TABLE seed_sellable ON COMMIT DROP AS
SELECT p.*, row_number() OVER (ORDER BY p.prod_id) AS n
FROM products p JOIN shops s USING(shop_id) JOIN master_products mp USING(master_prod_id)
WHERE mp.manufacturer='ShopSphere Expanded Demo' AND s.active_status='active'
AND NOT p.discontinued AND p.in_stock>0;
INSERT INTO order_items (order_id, prod_id, quantity, unit_price)
SELECT o.order_id, p.prod_id, 1+plan.n%3, p.unit_price
FROM seed_new_orders fresh JOIN orders o USING(order_id)
JOIN seed_order_plan plan ON plan.user_id=o.user_id AND plan.created_at=o.created_at
CROSS JOIN generate_series(0,1) line
JOIN seed_sellable p ON p.n=1+(plan.n*2+line)%(SELECT count(*) FROM seed_sellable);

-- Price each trip the way RECORD_DELIVERY_COST does at placement, which has to
-- follow the items because it is a share of the total they produce. The same
-- constants as src/db/queries/orderQueries.js, repeated because a .sql file
-- cannot import a JavaScript constant.
UPDATE orders o SET delivery_cost=ROUND(3+0.02*o.total_amount,2)
FROM seed_new_orders fresh WHERE fresh.order_id=o.order_id;

INSERT INTO payments (order_id, amount, payment_method, payment_status, paid_at)
SELECT o.order_id, o.total_amount+o.delivery_cost, 'cash_on_delivery',
       CASE o.order_status WHEN 'delivered' THEN 'completed' WHEN 'cancelled' THEN 'failed' ELSE 'pending' END,
       o.delivered_at
FROM seed_new_orders fresh JOIN orders o USING(order_id);
-- settle_delivery credits the order's own delivery_cost, once, on delivery.
UPDATE delivery_personnel d SET earnings=COALESCE(d.earnings,0)+earned.amount
FROM (
    SELECT o.delivery_person_id, SUM(o.delivery_cost) AS amount
    FROM seed_new_orders fresh JOIN orders o USING(order_id)
    WHERE o.order_status='delivered' GROUP BY o.delivery_person_id
) earned WHERE earned.delivery_person_id=d.delivery_person_id;
-- Each shop is paid for its own delivered lines, in full, the same way. Scoped to
-- the orders inserted on this run, so a reseed credits nothing twice.
UPDATE shops s SET balance=s.balance+goods.amount
FROM (
    SELECT p.shop_id, SUM(oi.quantity*oi.unit_price) AS amount
    FROM seed_new_orders fresh JOIN orders o USING(order_id)
    JOIN order_items oi USING(order_id) JOIN products p USING(prod_id)
    WHERE o.order_status='delivered' GROUP BY p.shop_id
) goods WHERE goods.shop_id=s.shop_id;

INSERT INTO product_reviews (user_id, prod_id, rating, review)
SELECT o.user_id, oi.prod_id, 3+o.user_id%3, 'Demo review: delivered and tested.'
FROM seed_new_orders fresh JOIN orders o USING(order_id) JOIN order_items oi USING(order_id)
WHERE o.order_status='delivered' ON CONFLICT DO NOTHING;
INSERT INTO shop_reviews (user_id, shop_id, rating, review)
SELECT DISTINCT o.user_id, p.shop_id, 3+o.user_id%3, 'Demo review: prompt service.'
FROM seed_new_orders fresh JOIN orders o USING(order_id) JOIN order_items oi USING(order_id)
JOIN products p USING(prod_id) WHERE o.order_status='delivered' ON CONFLICT DO NOTHING;

-- An admin withdrew these already-empty listings. Ledger balances are credited
-- only for refund rows inserted on this run; existing balances are never reset.
WITH refunds AS (
    INSERT INTO vendor_refunds (shop_id, prod_id, master_prod_id, units, unit_amount, amount, reason, removed_by, created_at)
    SELECT p.shop_id, p.prod_id, p.master_prod_id, 4, mp.wholesale_price, 4*mp.wholesale_price,
           'admin_removal', admin.user_id, TIMESTAMP '2026-08-15 09:00:00'
    FROM products p JOIN seed_masters mp USING(master_prod_id)
    JOIN shops s USING(shop_id) JOIN users admin ON admin.email='admin@shopsphere.test'
    WHERE mp.n%12=0 AND s.name LIKE 'Demo Marketplace %' AND NOT EXISTS (
        SELECT 1 FROM vendor_refunds r WHERE r.prod_id=p.prod_id AND r.created_at=TIMESTAMP '2026-08-15 09:00:00'
    ) RETURNING shop_id, amount
)
UPDATE shops s SET balance=s.balance+r.amount
FROM (SELECT shop_id,SUM(amount) AS amount FROM refunds GROUP BY shop_id) r WHERE r.shop_id=s.shop_id;

-- Stock is the remaining stock AFTER these historical orders/refunds. Acquisitions
-- reconcile to remaining + non-cancelled order quantities + compensated units.
--
-- As in the small fixture, the balance is debited for exactly the rows inserted
-- on this run, so the purchases appear in the ledger that the money came out of.
WITH acquisitions AS (
    SELECT p.shop_id, p.master_prod_id, mp.wholesale_price,
           p.in_stock + COALESCE((SELECT SUM(oi.quantity) FROM order_items oi JOIN orders o USING(order_id)
               WHERE oi.prod_id=p.prod_id AND o.order_status<>'cancelled'),0)
           + COALESCE((SELECT SUM(r.units) FROM vendor_refunds r WHERE r.prod_id=p.prod_id),0) AS quantity
    FROM products p JOIN master_products mp USING(master_prod_id)
    WHERE mp.manufacturer='ShopSphere Expanded Demo'
), bought AS (
    INSERT INTO shop_purchases (shop_id, master_prod_id, quantity, wholesale_unit_price, purchased_at)
    SELECT a.shop_id, a.master_prod_id, a.quantity, a.wholesale_price, TIMESTAMP '2026-07-01 09:00:00'
    FROM acquisitions a WHERE a.quantity>0 AND NOT EXISTS (
        SELECT 1 FROM shop_purchases sp WHERE sp.shop_id=a.shop_id AND sp.master_prod_id=a.master_prod_id
    )
    RETURNING shop_id, quantity * wholesale_unit_price AS cost
), spent AS (
    SELECT shop_id, SUM(cost) AS cost FROM bought GROUP BY shop_id
)
UPDATE shops s
SET balance = s.balance - spent.cost
FROM spent
WHERE s.shop_id = spent.shop_id;

-- The capital each shop bought its stock with, and the charge for it.
--
-- shops.balance is a running total of sales, top-ups, purchases and refunds, so a
-- fixture that wrote the purchases without the money that funded them would leave
-- a balance reconciling with nothing. Each shop is therefore brought up to its
-- purchases plus a float, and the ledger row is written for exactly the gap.
--
-- Measuring the gap rather than checking whether a shop has been funded at all is
-- what makes the two seed files compose: whichever runs second funds only what it
-- added, and a reseed finds no gap, inserts nothing, and leaves every balance and
-- top-up row untouched.
--
-- The float is deliberate: a shop with no capital could not buy anything through
-- the API, which is the whole point of the column.
WITH spend AS (
    SELECT s.shop_id, COALESCE(SUM(sp.quantity * sp.wholesale_unit_price), 0) AS purchases
    FROM shops s
    LEFT JOIN shop_purchases sp ON sp.shop_id = s.shop_id
    GROUP BY s.shop_id
), topped AS (
    SELECT t.shop_id, COALESCE(SUM(t.amount), 0) AS funded
    FROM shop_topups t
    GROUP BY t.shop_id
), gap AS (
    SELECT s.shop_id, s.purchases + 500 - COALESCE(t.funded, 0) AS amount
    FROM spend s
    LEFT JOIN topped t ON t.shop_id = s.shop_id
    WHERE s.purchases + 500 - COALESCE(t.funded, 0) > 0
), added AS (
    INSERT INTO shop_topups (shop_id, amount, method, created_at)
    SELECT shop_id, amount, 'bank_transfer', TIMESTAMP '2026-07-01 08:00:00'
    FROM gap
    RETURNING shop_id, amount
)
UPDATE shops s
SET balance = s.balance + a.amount
FROM added a
WHERE a.shop_id = s.shop_id;

INSERT INTO cart_items (user_id, prod_id, quantity)
SELECT u.user_id, p.prod_id, 1 FROM seed_accounts a JOIN users u USING(email)
JOIN seed_sellable p ON p.n=a.n WHERE a.role='customer' ON CONFLICT DO NOTHING;
INSERT INTO wish_list_items (user_id, prod_id)
SELECT u.user_id, p.prod_id FROM seed_accounts a JOIN users u USING(email)
JOIN seed_sellable p ON p.n=a.n+1 WHERE a.role='customer' ON CONFLICT DO NOTHING;

DROP TABLE seed_accounts, seed_catalog, seed_masters, seed_order_plan, seed_new_orders, seed_sellable;
