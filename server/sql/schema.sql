/*
descriptions should support markdown formatting
*/
/*
To-do:
Check triggers
Process product restock on cancellation of order
Process product compensation to shop owner on removal of product by  admin
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
create table permissions(
    permission_id VARCHAR(50) PRIMARY KEY,
    permission_name VARCHAR not null UNIQUE,
    description TEXT default null
);
create table role_permissions(
    role_id INT REFERENCES roles(role_id) on delete cascade not null ,
    permission_id VARCHAR(50) REFERENCES permissions(permission_id) on delete cascade not null ,
    PRIMARY KEY(role_id,permission_id)
);
--raise exception when deleting  from users
create table users
(
    user_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_role INT REFERENCES roles(role_id) on delete set null,--call a trigger to disable user
    name VARCHAR not null,
    password_hash TEXT not null,
    phone_numbers VARCHAR(20)[],
    pfp TEXT,
    email varchar(60) unique not null,
    address INT REFERENCES locations(location_id) on delete set null,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    point int default 0 not null,
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
    active_status varchar check(active_status in ('active','disabled')) default 'active',--when disabled,call a trigger to set product(discontinued) to true   
    phone_numbers VARCHAR(20)[],
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
    images TEXT[],
    description TEXT,
    category_id INT REFERENCES categories(category_id) on delete restrict not null ,
    wholesale_price DECIMAL not null,
    name VARCHAR not null,
    active_status VARCHAR check(active_status in ('available','discontinued')) default 'available',
    date_created TIMESTAMP default CURRENT_TIMESTAMP
);
--raise exception when deleting from products

create table products(
    prod_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR not null,
    images TEXT[],
    master_prod_id INT REFERENCES master_products(master_prod_id) on delete restrict not null ,
    description TEXT,
    shop_id INT references shops(shop_id) not null,
    in_stock INT,
    discontinued boolean default false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    unit_price DECIMAL 
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
    quantity INT not null,
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
    vehicle_info TEXT,
    active_status varchar check(active_status in ('available','on_delivery','unavailable')) default 'active',--when :new.active_status='unavailable' when order still 'shipped' or 'pending', set orders.delivery personnel:=null and order_status:='pending'
    earnings decimal 

);
--restrict deletion 
create table orders(
    order_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY, 
    order_status VARCHAR check(order_status in ('pending','shipped','delivered','cancelled')) default 'pending',--if cancelled, trigger to set delivery_person_id:=null and delete from order_items  and payments
    user_id INT REFERENCES users(user_id) not null,
    delivery_person_id INT REFERENCES delivery_personnel(delivery_person_id) default null,
    delivered_at TIMESTAMP default null,
    total_amount DECIMAL not null,
    delivery_cost DECIMAL default 0,
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
    quantity INT not null,
    unit_price DECIMAL not null,
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
DECLARE
    v_order_id INT := COALESCE(NEW.order_id, OLD.order_id);
BEGIN
    UPDATE orders
    SET total_amount = COALESCE(
        (SELECT SUM(quantity * unit_price) FROM order_items WHERE order_id = v_order_id),
        0
    )
    WHERE order_id = v_order_id;

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
--    ("order_status ... -- if cancelled, trigger to set delivery_person_id:=null
--      and delete from order_items and payments")
-- =========================================================
CREATE OR REPLACE FUNCTION fn_cleanup_cancelled_order()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE orders
    SET delivery_person_id = NULL
    WHERE order_id = NEW.order_id;

    DELETE FROM order_items WHERE order_id = NEW.order_id;
    DELETE FROM payments WHERE order_id = NEW.order_id;

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