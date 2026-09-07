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

-- Cancellation preserves price/payment history and restores stock exactly once.
CREATE OR REPLACE FUNCTION fn_cleanup_cancelled_order()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products p SET in_stock = p.in_stock + oi.quantity
    FROM order_items oi WHERE oi.order_id = NEW.order_id AND oi.prod_id = p.prod_id;
    UPDATE orders SET delivery_person_id = NULL WHERE order_id = NEW.order_id;
    UPDATE payments SET payment_status = 'failed', paid_at = NULL
    WHERE order_id = NEW.order_id AND payment_status = 'pending';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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
