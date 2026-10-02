-- Canonical fresh-database definition. Run once in an empty schema.
-- Descriptions may contain Markdown. Demo rows are loaded separately.

--tables
CREATE TABLE countries(
    country_id VARCHAR PRIMARY KEY,
    country_name VARCHAR not null UNIQUE
);
CREATE TABLE locations(
    location_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY ,
    street_address TEXT not null,
    postal_code VARCHAR,
    city VARCHAR not null,
    state_province VARCHAR,
    country_id VARCHAR REFERENCES countries(country_id)  on delete cascade not null
);
CREATE TABLE roles(
    role_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    role_name VARCHAR not null UNIQUE,
    description TEXT default null
);
-- Authorization uses roles resolved by the API; no unused permission tables.
CREATE TABLE users
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
    active_status varchar NOT NULL check(active_status in ('active','disabled')) default 'active'--call a trigger to disable shops, delivery_personnel
);
--raise exception when deleting from shops
CREATE TABLE shops(
    shop_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner INT REFERENCES users(user_id) not null ,
    name VARCHAR not null,
    logo TEXT,
    cover_photo TEXT,
    description TEXT,
    -- The shop's running balance: sales credit it, wholesale buying debits it,
    -- recharges and admin refunds credit it, approved customer returns debit it.
    -- Deliberately NOT CHECK (balance >= 0). A vendor must not be able to refuse
    -- a customer's return because the shop has already spent the money, so the
    -- column is allowed to go negative; the purchase path is what refuses to
    -- spend money that is not there, with `balance >= cost` in its predicate.
    balance NUMERIC(12,2) NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    active_status varchar NOT NULL check(active_status in ('active','disabled','pending')) default 'active',--'pending' until an administrator approves the shop; when disabled,call a trigger to set product(discontinued) to true   --kept 'active' by default so seeded data and direct inserts stay live; the vendor path writes 'pending' explicitly
    phone_numbers VARCHAR(20),
    address INT REFERENCES locations(location_id) on delete set null
);
CREATE TABLE categories(
    category_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    description TEXT,
    parent_category INT REFERENCES categories(category_id) on delete cascade  default null
);
--raise exception when deleting from master_products
CREATE TABLE master_products(
    master_prod_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    manufacturer VARCHAR not null,
    images TEXT,--will use table for images later
    description TEXT,
    category_id INT REFERENCES categories(category_id) on delete restrict not null ,
    wholesale_price NUMERIC(12,2) NOT NULL CHECK (wholesale_price >= 0),
    name VARCHAR not null,
    active_status VARCHAR NOT NULL check(active_status in ('available','discontinued')) default 'available',
    date_created TIMESTAMP default CURRENT_TIMESTAMP
);
--raise exception when deleting from products

CREATE TABLE products(
    prod_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    images TEXT,--will use table for images later
    master_prod_id INT REFERENCES master_products(master_prod_id) on delete restrict not null ,
    description TEXT,
    shop_id INT references shops(shop_id) not null,
    in_stock INT NOT NULL DEFAULT 0 CHECK (in_stock >= 0),
    discontinued boolean NOT NULL default false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0)
);
-- Records a vendor's wholesale acquisition before the item is offered for sale.
CREATE TABLE shop_purchases(
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
-- they still hold. This is the ledger of those payments; shops.balance is the
-- running total.
CREATE TABLE vendor_refunds(
    refund_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    prod_id INT REFERENCES products(prod_id) ON DELETE RESTRICT NOT NULL,
    master_prod_id INT REFERENCES master_products(master_prod_id) ON DELETE RESTRICT NOT NULL,
    units INT NOT NULL CHECK (units >= 0),
    -- amount / units, and therefore NULL when units is 0: the price of no units
    -- is not a number. This averages the attributed wholesale purchase prices.
    unit_amount NUMERIC(12,2),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    reason VARCHAR NOT NULL CHECK (reason IN ('admin_removal', 'shop_closed')),
    removed_by INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- A shop funding its own balance. There is no payment gateway, so this is a
-- record of a recharge rather than a card charge — the API says as much in its
-- own response. The ledger half of the balance; shops.balance is the running total.
CREATE TABLE shop_topups(
    topup_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method VARCHAR NOT NULL CHECK (method IN ('card', 'bank_transfer', 'cash')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE attributes(
    attribute_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    description TEXT
);
CREATE TABLE category_attributes(
    category_id INT REFERENCES categories(category_id)on delete cascade not null ,
    attribute_id INT REFERENCES attributes(attribute_id)on delete cascade not null ,
    PRIMARY KEY(category_id,attribute_id)
);
CREATE TABLE attribute_values(
    master_prod_id INT REFERENCES master_products(master_prod_id)  on delete cascade not null,
    attribute_id INT REFERENCES attributes(attribute_id) on delete cascade not null ,
    attrib_value VARCHAR not null,
    PRIMARY KEY(master_prod_id,attribute_id)
);
CREATE TABLE cart_items(
    user_id INT REFERENCES users(user_id) on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id) on delete cascade not null ,
   quantity INT NOT NULL CHECK (quantity > 0),
    PRIMARY KEY(user_id,prod_id)
);
CREATE TABLE wish_list_items(
    user_id INT REFERENCES users(user_id) on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id) on delete cascade not null ,
    PRIMARY KEY(user_id,prod_id)
);
CREATE TABLE product_reviews(
    user_id INT REFERENCES users(user_id)on delete cascade not null ,
    prod_id INT REFERENCES products(prod_id)on delete cascade not null ,
    rating INT check(rating between 1 and 5) not null,
    review TEXT,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,prod_id)
);
CREATE TABLE shop_reviews(
    user_id INT REFERENCES users(user_id) on delete cascade not null,
    shop_id INT REFERENCES shops(shop_id) on delete cascade not null,
    rating INT check(rating between 1 and 5) not null,
    review TEXT,
    last_modified TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(user_id,shop_id)
);
--raise exception when deleting from delivery_personnel
CREATE TABLE delivery_personnel(
    delivery_person_id INT references users(user_id)  on delete restrict  primary key,
    vehicle_info TEXT,--free-text notes; the fields below are the parts worth filtering on
    vehicle_type VARCHAR,--motorcycle/car/van/bicycle
    vehicle_number VARCHAR,--registration or plate
    license_number VARCHAR,
    vehicle_model VARCHAR,
    active_status varchar NOT NULL check(active_status in ('available','on_delivery','unavailable')) default 'available',--when :new.active_status='unavailable' when order still 'shipped' or 'pending', set orders.delivery personnel:=null and order_status:='pending'
    earnings decimal

);
--restrict deletion
CREATE TABLE orders(
    order_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_status VARCHAR NOT NULL check(order_status in ('pending','shipped','delivered','cancelled')) default 'pending',-- cancellation preserves history and restores stock
    user_id INT REFERENCES users(user_id) not null,
    delivery_person_id INT REFERENCES delivery_personnel(delivery_person_id) default null,
    delivered_at TIMESTAMP default null,
    total_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
    -- What the customer pays for the trip, and therefore what the courier is
    -- paid for it. Written once at checkout (RECORD_DELIVERY_COST) and read back
    -- by settle_delivery, so changing the pay constants cannot retroactively
    -- move money on an order that was already placed.
    delivery_cost NUMERIC(12,2) NOT NULL default 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    shipping_address INT REFERENCES locations(location_id)on delete restrict not null
);

CREATE TABLE payments(
    transaction_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT REFERENCES orders(order_id) not null,
    amount DECIMAL not null,
    payment_method VARCHAR check(payment_method in ('prepaid','cash_on_delivery')) not null,
    payment_status VARCHAR NOT NULL check(payment_status in ('pending','completed','failed')) default 'pending',
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items(
    order_id INT REFERENCES orders(order_id) not null,
    prod_id INT REFERENCES products(prod_id) not null,
    quantity INT not null CHECK (quantity > 0),
    unit_price NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
    PRIMARY KEY(order_id,prod_id)
);

-- A customer sending goods back, and the vendor's decision on it.
--
-- Declared here, at the end of the tables, because it references orders and
-- delivery_personnel — both of which are themselves declared late, so a
-- definition further up the file could not be parsed.
--
-- Deliberately a table of its own rather than a fifth value in
-- orders.order_status. A return is a fact about one line of an order, not a state
-- of the whole order: an order of three listings can have one returned and two
-- kept. It also keeps the four order states intact, which matters because
-- fn_guard_order_transition, both review-verification triggers and
-- fn_cleanup_cancelled_order all key on them — a 'returned' state would put an
-- order beyond the reach of every one of those.
--
-- Status is a small state machine, and every transition is a compare-and-set in
-- the API rather than a read followed by a check:
--
--   requested ──▶ approved ──▶ collected ──▶ restocked
--       └──────▶ rejected   (and a rejected request may be made again)
--
-- Money and goods move at different moments on purpose. The refund is recorded
-- and the shop's balance debited at approval, because that is when the shop
-- accepts the obligation. products.in_stock rises at restock, because until the
-- parcel is physically back the shop cannot sell the unit again.
CREATE TABLE product_returns(
    return_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT REFERENCES orders(order_id) ON DELETE RESTRICT NOT NULL,
    prod_id INT REFERENCES products(prod_id) ON DELETE RESTRICT NOT NULL,
    user_id INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL, -- the customer
    -- Denormalised from products.shop_id, which is immutable once a listing is
    -- created, so this cannot drift. It is what makes "may this vendor decide it"
    -- and the balance debit single-table predicates.
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    reason TEXT,
    status VARCHAR NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'collected', 'restocked')),
    -- quantity × the order line's unit_price, frozen at request time. The order
    -- line's price is itself a snapshot, so this cannot move afterwards.
    refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0),
    decision_note TEXT,
    decided_at TIMESTAMP,
    -- Any active courier may collect, which is why this records who did rather
    -- than being constrained to the courier who delivered the order: that person
    -- may since have gone unavailable, and a pickup only one person can perform
    -- is a pickup that can stall forever.
    collected_by INT REFERENCES delivery_personnel(delivery_person_id),
    collected_at TIMESTAMP,
    restocked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The customer side of the refund ledger. The mirror of vendor_refunds and the
-- opposite direction of money: that table is platform → shop, this one is
-- shop → customer. They never share a table for the same reason.
CREATE TABLE customer_refunds(
    refund_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_id INT REFERENCES product_returns(return_id) ON DELETE RESTRICT NOT NULL,
    order_id INT REFERENCES orders(order_id) ON DELETE RESTRICT NOT NULL,
    user_id INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL, -- who is paid
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Computed monetary value used by order-total triggers and checkout reads.
CREATE FUNCTION fn_order_subtotal(p_order_id INT)
RETURNS NUMERIC LANGUAGE SQL STABLE AS $$
    SELECT COALESCE(SUM(quantity * unit_price), 0)
    FROM order_items WHERE order_id = p_order_id;
$$;

--triggers
-- =========================================================
-- 1. Generic "no hard deletes" guard
--    Used by: users, shops, master_products, products,
--             delivery_personnel, orders
-- =========================================================
CREATE FUNCTION fn_prevent_delete()
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
CREATE FUNCTION fn_recalc_order_total()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP <> 'INSERT' THEN
        UPDATE orders SET total_amount = fn_order_subtotal(OLD.order_id) WHERE order_id = OLD.order_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
        UPDATE orders SET total_amount = fn_order_subtotal(NEW.order_id) WHERE order_id = NEW.order_id;
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
CREATE FUNCTION fn_disable_user_on_role_removal()
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
CREATE FUNCTION fn_discontinue_products_on_shop_disable()
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
CREATE FUNCTION fn_release_orders_on_personnel_unavailable()
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
CREATE FUNCTION fn_cleanup_cancelled_order()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products p SET in_stock = p.in_stock + oi.quantity
    FROM order_items oi WHERE oi.order_id = NEW.order_id AND oi.prod_id = p.prod_id;
    UPDATE orders SET delivery_person_id = NULL
    WHERE order_id = NEW.order_id;
    UPDATE payments SET payment_status = 'failed', paid_at = NULL
    WHERE order_id = NEW.order_id AND payment_status = 'pending';
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
CREATE FUNCTION fn_disable_user_dependents()
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
CREATE FUNCTION fn_enable_user_dependents()
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


-- A completed delivery is the proof of purchase for a product review.
 CREATE FUNCTION fn_verify_product_review_purchase()
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
CREATE TRIGGER trg_verify_product_review_purchase
BEFORE INSERT OR UPDATE ON product_reviews
FOR EACH ROW EXECUTE FUNCTION fn_verify_product_review_purchase();

-- The same rule for shop reviews: a delivered order containing one of the
-- shop's listings is the proof of purchase.
 CREATE FUNCTION fn_verify_shop_review_purchase()
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
CREATE TRIGGER trg_verify_shop_review_purchase
BEFORE INSERT OR UPDATE ON shop_reviews
FOR EACH ROW EXECUTE FUNCTION fn_verify_shop_review_purchase();


-- What a customer may return, and how much of it.
--
-- Two rules, both of which the API also states as a sentence but neither of which
-- the API is trusted to be the only enforcer of:
--
--   1. Only a delivered order can be returned. This is what makes a return and a
--      cancellation provably disjoint — CANCEL_ORDER requires 'pending' — so the
--      stock restore in fn_cleanup_cancelled_order and the restock here can never
--      both fire for the same unit.
--   2. The units returned across all of a customer's accepted requests for one
--      listing cannot exceed what they bought. Without this, three separate
--      requests of two units each on an order of three would restock six.
--      Rejected requests do not count: a customer whose return was refused is
--      entitled to ask again.
CREATE FUNCTION fn_check_return_quantity()
RETURNS TRIGGER AS $$
DECLARE
    ordered INT;
    order_state VARCHAR;
    already INT;
BEGIN
    SELECT oi.quantity, o.order_status INTO ordered, order_state
    FROM order_items oi
    JOIN orders o ON o.order_id = oi.order_id
    WHERE oi.order_id = NEW.order_id AND oi.prod_id = NEW.prod_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'That listing is not on that order.';
    END IF;
    IF order_state <> 'delivered' THEN
        RAISE EXCEPTION 'Only a delivered order can be returned.';
    END IF;

    SELECT COALESCE(SUM(r.quantity), 0) INTO already
    FROM product_returns r
    WHERE r.order_id = NEW.order_id AND r.prod_id = NEW.prod_id
      AND r.status <> 'rejected'
      AND r.return_id IS DISTINCT FROM NEW.return_id;

    -- A rejected request claims nothing, so the new row only counts against the
    -- order line when it is not itself a rejection. Without this test a refusal
    -- recorded while another request was open would be refused in turn, on the
    -- strength of units it never asked for.
    IF NEW.status <> 'rejected' AND already + NEW.quantity > ordered THEN
        RAISE EXCEPTION 'A customer cannot return more units than they bought of that listing.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_check_return_quantity BEFORE INSERT OR UPDATE ON product_returns
FOR EACH ROW EXECUTE FUNCTION fn_check_return_quantity();

-- Restrict order lifecycle transitions.
CREATE FUNCTION fn_guard_order_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.order_status IS DISTINCT FROM NEW.order_status AND NOT (
        (OLD.order_status = 'pending' AND NEW.order_status IN ('shipped', 'cancelled')) OR
        (OLD.order_status = 'shipped' AND NEW.order_status IN ('pending', 'delivered'))
    ) THEN RAISE EXCEPTION 'That order status transition is not allowed.'; END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_guard_order_transition BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION fn_guard_order_transition();

-- Deferred so a master and all its values can be saved in a single transaction.
-- Category requirements apply to the directly assigned category (no inheritance).
CREATE FUNCTION fn_require_category_values()
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
CREATE CONSTRAINT TRIGGER trg_master_required_values AFTER INSERT OR UPDATE ON master_products
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();
CREATE CONSTRAINT TRIGGER trg_category_required_values AFTER INSERT OR UPDATE ON category_attributes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();
CREATE CONSTRAINT TRIGGER trg_attribute_required_values AFTER INSERT OR UPDATE OR DELETE ON attribute_values
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_require_category_values();


CREATE INDEX idx_orders_user_status ON orders(user_id, order_status);
CREATE INDEX idx_order_items_product ON order_items(prod_id);
CREATE INDEX idx_products_shop_master ON products(shop_id, master_prod_id);
CREATE INDEX idx_vendor_refunds_shop ON vendor_refunds(shop_id, created_at DESC);
CREATE INDEX idx_vendor_refunds_created ON vendor_refunds(created_at DESC);
CREATE INDEX idx_shop_topups_shop ON shop_topups(shop_id, created_at DESC);
CREATE INDEX idx_product_returns_order ON product_returns(order_id, prod_id);
CREATE INDEX idx_product_returns_shop ON product_returns(shop_id, created_at DESC);
CREATE INDEX idx_product_returns_courier ON product_returns(status, collected_at);
-- One open request per order line. A rejected one is not open, which is what lets
-- a customer whose return was refused ask again; the quantity trigger above is
-- what stops the requests that ARE open from adding up to more than they bought.
CREATE UNIQUE INDEX idx_product_returns_open ON product_returns(order_id, prod_id)
WHERE status IN ('requested', 'approved', 'collected');

-- A real multi-table workflow, called by the delivery API inside BEGIN/COMMIT.
-- The guarded transition makes retries safe; a failure rolls back all three writes.
--
-- The courier is paid the order's own delivery_cost rather than a fee computed
-- here. That is the same number the customer was charged, and reading it back
-- from the row means the pay constants in orderQueries.js govern new orders only.
CREATE PROCEDURE settle_delivery(
    IN p_order_id INT, IN p_courier_id INT, INOUT result JSONB
)
LANGUAGE plpgsql AS $$
DECLARE
    delivered orders%ROWTYPE;
    paid JSONB;
    courier JSONB;
BEGIN
    result := NULL;
    UPDATE orders
    SET order_status = 'delivered', delivered_at = CURRENT_TIMESTAMP
    WHERE order_id = p_order_id AND delivery_person_id = p_courier_id
      AND order_status = 'shipped'
    RETURNING * INTO delivered;
    IF NOT FOUND THEN RETURN; END IF;

    UPDATE payments SET payment_status = 'completed', paid_at = delivered.delivered_at
    WHERE order_id = p_order_id AND payment_status = 'pending'
    RETURNING jsonb_build_object('transaction_id', transaction_id,
        'payment_status', payment_status, 'paid_at', paid_at) INTO paid;

    UPDATE delivery_personnel
    SET earnings = COALESCE(earnings, 0) + ROUND(delivered.delivery_cost, 2)
    WHERE delivery_person_id = p_courier_id
    RETURNING jsonb_build_object('delivery_person_id', delivery_person_id,
        'earnings', earnings::text) INTO courier;

    -- Pay each shop for its own lines, in full. There is no commission between
    -- the customer's payment and the shop, and the delivery charge on this order
    -- is the courier's, not the shop's. One statement for however many shops the
    -- order spans, grouped by shop rather than one update per line.
    --
    -- A sale credits the balance when it is delivered, not when it is placed: an
    -- order still in a van is not money the shop can spend on stock.
    UPDATE shops s
    SET balance = s.balance + goods.amount
    FROM (
        SELECT p.shop_id, SUM(oi.quantity * oi.unit_price) AS amount
        FROM order_items oi
        JOIN products p ON p.prod_id = oi.prod_id
        WHERE oi.order_id = p_order_id
        GROUP BY p.shop_id
    ) goods
    WHERE s.shop_id = goods.shop_id;

    result := jsonb_build_object('order_id', delivered.order_id,
        'order_status', delivered.order_status, 'delivered_at', delivered.delivered_at,
        'total_amount', delivered.total_amount::text,
        'delivery_cost', delivered.delivery_cost::text,
        'delivery_person_id', delivered.delivery_person_id,
        'payment', paid, 'courier_earnings', courier);
END;
$$;
