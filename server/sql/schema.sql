/*
descriptions should support markdown formatting
*/
--To drop everything, run:
/* DROP SCHEMA public CASCADE;
CREATE SCHEMA public; */

--tables
CREATE table countries(
    country_id VARCHAR PRIMARY KEY,
    country_name VARCHAR not null UNIQUE
);
create table locations(
    location_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY ,
    street_address TEXT not null,
    postal_code VARCHAR,
    city VARCHAR not null,
    state_province VARCHAR,
    country_id VARCHAR REFERENCES countries(country_id)  on delete cascade not null
);
create table roles(
    role_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR not null UNIQUE,
    description TEXT default null
);
-- There is deliberately no permissions/role_permissions pair here. They existed
-- as seed-only data that no code ever consulted: authorization is
-- requireRole(roleName) on a mounted router, which is a check per role and never
-- per capability. A table that looks like an authorization model and is not one
-- is worse than no table at all, so 009_drop_permissions.sql removes them and the
-- grants they held.
--raise exception when deleting  from users
create table users
(
    user_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_role INT REFERENCES roles(role_id) on delete set null,--call a trigger to disable user
    name VARCHAR not null,
    password_hash TEXT not null,
    phone_numbers VARCHAR(20),
    pfp TEXT,
    email varchar(60) unique not null,
    address INT REFERENCES locations(location_id) on delete set null,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    point int default 0 not null,
    token_version INT NOT NULL DEFAULT 0,
    active_status varchar check(active_status in ('active','disabled')) default 'active'--call a trigger to disable shops, delivery_personnel 
);
--raise exception when deleting from shops 
create table shops(
    shop_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner INT REFERENCES users(user_id) not null ,
    name VARCHAR not null,
    logo TEXT,
    cover_photo TEXT,
    description TEXT,
    earnings decimal default 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active_status varchar check(active_status in ('active','disabled','pending')) default 'active',--'pending' until an administrator approves the shop; when disabled,call a trigger to set product(discontinued) to true   --kept 'active' by default so seeded data and direct inserts stay live; the vendor path writes 'pending' explicitly
    phone_numbers VARCHAR(20),
    address INT REFERENCES locations(location_id) on delete set null
);
create table categories(
    category_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    description TEXT,
    parent_category INT REFERENCES categories(category_id) on delete cascade  default null 
);
--raise exception when deleting from master_products
create table master_products(
    master_prod_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manufacturer VARCHAR not null,
    images TEXT,--will use table for images later
    description TEXT,
    category_id INT REFERENCES categories(category_id) on delete restrict not null ,
    wholesale_price NUMERIC(12,2) NOT NULL CHECK (wholesale_price >= 0),
    name VARCHAR not null,
    active_status VARCHAR check(active_status in ('available','discontinued')) default 'available',
    date_created TIMESTAMP default CURRENT_TIMESTAMP
);
--raise exception when deleting from products

create table products(
    prod_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    images TEXT,--will use table for images later
    master_prod_id INT REFERENCES master_products(master_prod_id) on delete restrict not null ,
    description TEXT,
    shop_id INT references shops(shop_id) not null,
    in_stock INT NOT NULL DEFAULT 0 CHECK (in_stock >= 0),
    discontinued boolean default false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
-- Records a vendor's wholesale acquisition before the item is offered for sale.
create table shop_purchases(
    purchase_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    master_prod_id INT REFERENCES master_products(master_prod_id) ON DELETE RESTRICT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    wholesale_unit_price NUMERIC(12,2) NOT NULL CHECK (wholesale_unit_price >= 0),
    purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The compensation half of removing a listing. A hard DELETE from products is
-- impossible (see fn_prevent_delete below), so an administrator "removing" a
-- listing means discontinued = true plus paying the vendor back for the stock
-- they still hold. This is the ledger of those payments; shops.earnings is the
-- running total. Also supplied as migration 006.
create table vendor_refunds(
    refund_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    prod_id INT REFERENCES products(prod_id) ON DELETE RESTRICT NOT NULL,
    master_prod_id INT REFERENCES master_products(master_prod_id) ON DELETE RESTRICT NOT NULL,
    units INT NOT NULL CHECK (units >= 0),
    -- amount / units, and therefore NULL when units is 0: the price of no units
    -- is not a number. See 006_vendor_refunds.sql for why it is an average.
    unit_amount NUMERIC(12,2),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    reason VARCHAR NOT NULL CHECK (reason IN ('admin_removal', 'shop_closed')),
    removed_by INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
create table attributes(
    attribute_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    description TEXT
);
create table category_attributes(
    category_id INT REFERENCES categories(category_id)on delete cascade not null ,
    attribute_id INT REFERENCES attributes(attribute_id)on delete cascade not null ,
    PRIMARY KEY(category_id,attribute_id)
);
create table attribute_values(
    master_prod_id INT REFERENCES master_products(master_prod_id)  on delete cascade not null,
    attribute_id INT REFERENCES attributes(attribute_id) on delete cascade not null ,
    attrib_value VARCHAR not null,
    PRIMARY KEY(master_prod_id,attribute_id)
);
create table cart_items(
    user_id INT REFERENCES users(user_id) on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id) on delete cascade not null ,
   quantity INT NOT NULL CHECK (quantity > 0),
    PRIMARY KEY(user_id,prod_id)
);
create table wish_list_items(
    user_id INT REFERENCES users(user_id) on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id) on delete cascade not null ,
    PRIMARY KEY(user_id,prod_id)
);
create table product_reviews(
    user_id INT REFERENCES users(user_id)on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id)on delete cascade not null ,
    rating INT check(rating between 1 and 5) not null,
    review TEXT,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,prod_id)
);
create table shop_reviews(
    user_id INT REFERENCES users(user_id) on delete cascade not null,
    shop_id INT REFERENCES shops(shop_id) on delete cascade not null,
    rating INT check(rating between 1 and 5) not null,
    review TEXT,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,shop_id)
);
--raise exception when deleting from delivery_personnel
create table delivery_personnel(
    delivery_person_id INT references users(user_id)  on delete restrict  primary key,
    vehicle_info TEXT,--free-text notes; the fields below are the parts worth filtering on
    vehicle_type VARCHAR,--motorcycle/car/van/bicycle
    vehicle_number VARCHAR,--registration or plate
    license_number VARCHAR,
    vehicle_model VARCHAR,
    active_status varchar check(active_status in ('available','on_delivery','unavailable')) default 'available',--when :new.active_status='unavailable' when order still 'shipped' or 'pending', set orders.delivery personnel:=null and order_status:='pending'
    earnings decimal

);
--restrict deletion 
create table orders(
    order_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 
    order_status VARCHAR check(order_status in ('pending','shipped','delivered','cancelled')) default 'pending',-- cancellation preserves history and restores stock
    user_id INT REFERENCES users(user_id) not null,
    delivery_person_id INT REFERENCES delivery_personnel(delivery_person_id) default null,
    delivered_at TIMESTAMP default null,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    platform_commission DECIMAL default 0,
    delivery_cost NUMERIC(12,2) default 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipping_address INT REFERENCES locations(location_id)on delete restrict not null 
);

create table payments(
    transaction_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT REFERENCES orders(order_id) not null,
    amount DECIMAL not null,
    payment_method VARCHAR check(payment_method in ('prepaid','cash_on_delivery')) not null,
    payment_status VARCHAR check(payment_status in ('pending','completed','failed')) default 'pending',
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

create table order_items(
    order_id INT REFERENCES orders(order_id) not null,
    prod_id INT REFERENCES products(prod_id) not null,
    quantity INT not null CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    platform_commission DECIMAL default 0,
    PRIMARY KEY(order_id,prod_id)
);

--triggers
-- =========================================================
-- 1. Generic "no hard deletes" guard
--    Used by: users, shops, master_products, products,
--             delivery_personnel, orders
-- =========================================================
CREATE OR REPLACE FUNCTION fn_prevent_delete()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Deletion from table "%" is not allowed. Use an active_status/discontinued flag instead.', TG_TABLE_NAME;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_delete_users
BEFORE DELETE ON users
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();

CREATE TRIGGER trg_prevent_delete_shops
BEFORE DELETE ON shops
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();

CREATE TRIGGER trg_prevent_delete_master_products
BEFORE DELETE ON master_products
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();

CREATE TRIGGER trg_prevent_delete_products
BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();

CREATE TRIGGER trg_prevent_delete_delivery_personnel
BEFORE DELETE ON delivery_personnel
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();

CREATE TRIGGER trg_prevent_delete_orders
BEFORE DELETE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_prevent_delete();


-- =========================================================
-- 2. Keep orders.total_amount in sync with order_items
--    ("--for calculating order.total_amount")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_recalc_order_total()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        UPDATE orders SET total_amount = COALESCE((SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = OLD.order_id), 0) WHERE order_id = OLD.order_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        UPDATE orders SET total_amount = COALESCE((SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = NEW.order_id), 0) WHERE order_id = NEW.order_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_items_recalc_total
AFTER INSERT OR UPDATE OR DELETE ON order_items
FOR EACH ROW EXECUTE FUNCTION fn_recalc_order_total();


-- =========================================================
-- 3. Disable a user when their role is removed
--    ("user_role ... on delete set null -- call a trigger to disable user")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_disable_user_on_role_removal()
RETURNS TRIGGER AS $$
BEGIN
    NEW.active_status := 'disabled';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disable_user_on_role_removal
BEFORE UPDATE ON users
FOR EACH ROW
WHEN (NEW.user_role IS NULL AND OLD.user_role IS NOT NULL)
EXECUTE FUNCTION fn_disable_user_on_role_removal();


-- =========================================================
-- 4. Discontinue all of a shop's products when the shop is disabled
--    ("active_status ... -- when disabled, call a trigger to set product(discontinued) to true")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_discontinue_products_on_shop_disable()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products
    SET discontinued = true
    WHERE shop_id = NEW.shop_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_discontinue_products_on_shop_disable
AFTER UPDATE ON shops
FOR EACH ROW
WHEN (NEW.active_status = 'disabled' AND OLD.active_status IS DISTINCT FROM 'disabled')
EXECUTE FUNCTION fn_discontinue_products_on_shop_disable();


-- =========================================================
-- 5. Free up affected orders when a courier goes "unavailable"
--    ("active_status ... -- when :new.active_status='unavailable' when order
--      still 'shipped' or 'pending', set orders.delivery_person_id:=null
--      and order_status:='pending'")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_release_orders_on_personnel_unavailable()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET delivery_person_id = NULL,
        order_status = 'pending'
    WHERE delivery_person_id = NEW.delivery_person_id
      AND order_status IN ('shipped', 'pending');

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_release_orders_on_personnel_unavailable
AFTER UPDATE ON delivery_personnel
FOR EACH ROW
WHEN (NEW.active_status = 'unavailable' AND OLD.active_status IS DISTINCT FROM 'unavailable')
EXECUTE FUNCTION fn_release_orders_on_personnel_unavailable();


-- =========================================================
-- 6. Clean up an order when it's cancelled
--    Preserve the purchase history and return reserved stock once.
-- =========================================================
CREATE OR REPLACE FUNCTION fn_cleanup_cancelled_order()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products p SET in_stock = p.in_stock + oi.quantity
    FROM order_items oi WHERE oi.order_id = NEW.order_id AND oi.prod_id = p.prod_id;
    -- The commission goes with everything else: a cancelled order earned the
    -- platform nothing, and a stale positive figure would show as revenue next
    -- to a failed payment. See migrations/008.
    UPDATE orders SET delivery_person_id = NULL, platform_commission = 0
    WHERE order_id = NEW.order_id;
    UPDATE payments SET payment_status = 'failed', paid_at = NULL
    WHERE order_id = NEW.order_id AND payment_status = 'pending';
    UPDATE order_items SET platform_commission = 0 WHERE order_id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_cleanup_cancelled_order
AFTER UPDATE ON orders
FOR EACH ROW
WHEN (NEW.order_status = 'cancelled' AND OLD.order_status IS DISTINCT FROM 'cancelled')
EXECUTE FUNCTION fn_cleanup_cancelled_order();
-- =========================================================
-- 7. Cascade a user disable down to their shops and
--    delivery-personnel status
--    ("active_status ... -- call a trigger to disable shops, delivery_personnel")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_disable_user_dependents()
RETURNS TRIGGER AS $$
BEGIN
    -- disable any shops this user owns
    UPDATE shops
    SET active_status = 'disabled'
    WHERE owner = NEW.user_id
      AND active_status IS DISTINCT FROM 'disabled';

    -- if this user is also delivery personnel, take them off duty
    UPDATE delivery_personnel
    SET active_status = 'unavailable'
    WHERE delivery_person_id = NEW.user_id
      AND active_status IS DISTINCT FROM 'unavailable';

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_disable_user_dependents
AFTER UPDATE ON users
FOR EACH ROW
WHEN (NEW.active_status = 'disabled' AND OLD.active_status IS DISTINCT FROM 'disabled')
EXECUTE FUNCTION fn_disable_user_dependents();

-- =========================================================
-- 7b. Undo the shop half of the cascade when a user is restored
--     An administrator un-banning a user expects the user's shops to come back.
--     Listings deliberately stay discontinued (fn_discontinue_products_on_shop_disable
--     is one-way), so a vendor consciously relists rather than having retired
--     listings silently resurrected.
--     delivery_personnel is deliberately left alone: the disable direction sets a
--     courier 'unavailable', which also releases their in-flight orders, and
--     returning them to 'available' would put them back on duty without opting in.
--     Couriers set their own availability from the delivery workspace.
-- =========================================================
CREATE OR REPLACE FUNCTION fn_enable_user_dependents()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE shops
    SET active_status = 'active'
    WHERE owner = NEW.user_id
      AND active_status = 'disabled';

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_enable_user_dependents
AFTER UPDATE ON users
FOR EACH ROW
WHEN (NEW.active_status = 'active' AND OLD.active_status IS DISTINCT FROM 'active')
EXECUTE FUNCTION fn_enable_user_dependents();

-- Complete application invariants (also supplied as migration 003).
-- Additive and rerunnable. Existing orders, products and reviews are preserved.
-- A completed delivery is the proof of purchase for a product review.
CREATE OR REPLACE FUNCTION fn_verify_product_review_purchase()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM orders o JOIN order_items oi ON oi.order_id = o.order_id
        JOIN users u ON u.user_id = o.user_id JOIN roles r ON r.role_id = u.user_role
        WHERE o.user_id = NEW.user_id AND oi.prod_id = NEW.prod_id
          AND o.order_status = 'delivered' AND r.role_name = 'customer'
    ) THEN
        RAISE EXCEPTION 'Only customers with a delivered purchase of this listing can review it.';
    END IF;
    NEW.last_modified := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_verify_product_review_purchase ON product_reviews;
CREATE TRIGGER trg_verify_product_review_purchase
BEFORE INSERT OR UPDATE ON product_reviews
FOR EACH ROW EXECUTE FUNCTION fn_verify_product_review_purchase();

-- The same rule for shop reviews: a delivered order containing one of the
-- shop's listings is the proof of purchase. Also supplied as migration 007.
CREATE OR REPLACE FUNCTION fn_verify_shop_review_purchase()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM orders o
        JOIN order_items oi ON oi.order_id = o.order_id
        JOIN products p ON p.prod_id = oi.prod_id
        JOIN users u ON u.user_id = o.user_id
        JOIN roles r ON r.role_id = u.user_role
        WHERE o.user_id = NEW.user_id
          AND p.shop_id = NEW.shop_id
          AND o.order_status = 'delivered'
          AND r.role_name = 'customer'
    ) THEN
        RAISE EXCEPTION 'Only customers with a delivered order from this shop can review it.';
    END IF;
    NEW.last_modified := CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_verify_shop_review_purchase ON shop_reviews;
CREATE TRIGGER trg_verify_shop_review_purchase
BEFORE INSERT OR UPDATE ON shop_reviews
FOR EACH ROW EXECUTE FUNCTION fn_verify_shop_review_purchase();

-- Restrict order lifecycle transitions.
CREATE OR REPLACE FUNCTION fn_guard_order_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.order_status IS DISTINCT FROM NEW.order_status AND NOT (
        (OLD.order_status = 'pending' AND NEW.order_status IN ('shipped', 'cancelled')) OR
        (OLD.order_status = 'shipped' AND NEW.order_status IN ('pending', 'delivered'))
    ) THEN RAISE EXCEPTION 'That order status transition is not allowed.'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_guard_order_transition ON orders;
CREATE TRIGGER trg_guard_order_transition BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_guard_order_transition();

-- Deferred so a master and all its values can be saved in a single transaction.
-- Category requirements apply to the directly assigned category (no inheritance).
CREATE OR REPLACE FUNCTION fn_require_category_values()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM master_products mp
        JOIN category_attributes ca ON ca.category_id = mp.category_id
        LEFT JOIN attribute_values av ON av.master_prod_id = mp.master_prod_id AND av.attribute_id = ca.attribute_id
        WHERE mp.active_status = 'available' AND (av.attrib_value IS NULL OR btrim(av.attrib_value) = '')
    ) THEN RAISE EXCEPTION 'Every available master product must have all required category attribute values.'; END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_master_required_values ON master_products;
CREATE CONSTRAINT TRIGGER trg_master_required_values AFTER INSERT OR UPDATE ON master_products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();
DROP TRIGGER IF EXISTS trg_category_required_values ON category_attributes;
CREATE CONSTRAINT TRIGGER trg_category_required_values AFTER INSERT OR UPDATE ON category_attributes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();
DROP TRIGGER IF EXISTS trg_attribute_required_values ON attribute_values;
CREATE CONSTRAINT TRIGGER trg_attribute_required_values AFTER INSERT OR UPDATE OR DELETE ON attribute_values
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();

UPDATE users SET active_status='active' WHERE active_status IS NULL;
ALTER TABLE users ALTER COLUMN active_status SET NOT NULL;
UPDATE shops SET active_status='active' WHERE active_status IS NULL;
ALTER TABLE shops ALTER COLUMN active_status SET NOT NULL;
UPDATE master_products SET active_status='available' WHERE active_status IS NULL;
ALTER TABLE master_products ALTER COLUMN active_status SET NOT NULL;
UPDATE products SET discontinued=false WHERE discontinued IS NULL;
ALTER TABLE products ALTER COLUMN discontinued SET NOT NULL;
UPDATE orders SET order_status='pending' WHERE order_status IS NULL;
ALTER TABLE orders ALTER COLUMN order_status SET NOT NULL;
UPDATE delivery_personnel SET active_status='available' WHERE active_status IS NULL;
ALTER TABLE delivery_personnel ALTER COLUMN active_status SET NOT NULL;
UPDATE payments SET payment_status='pending' WHERE payment_status IS NULL;
ALTER TABLE payments ALTER COLUMN payment_status SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_id, order_status);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(prod_id);
CREATE INDEX IF NOT EXISTS idx_products_shop_master ON products(shop_id, master_prod_id);
