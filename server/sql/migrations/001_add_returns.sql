CREATE TABLE IF NOT EXISTS product_returns(
    return_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    order_id INT REFERENCES orders(order_id) ON DELETE RESTRICT NOT NULL,
    prod_id INT REFERENCES products(prod_id) ON DELETE RESTRICT NOT NULL,
    user_id INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    reason TEXT,
    status VARCHAR NOT NULL DEFAULT 'requested'
        CHECK (status IN ('requested', 'approved', 'rejected', 'collected', 'restocked')),
    refund_amount NUMERIC(12,2) NOT NULL CHECK (refund_amount >= 0),
    decision_note TEXT,
    decided_at TIMESTAMP,
    collected_by INT REFERENCES delivery_personnel(delivery_person_id),
    collected_at TIMESTAMP,
    restocked_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS customer_refunds(
    refund_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    return_id INT REFERENCES product_returns(return_id) ON DELETE RESTRICT NOT NULL,
    order_id INT REFERENCES orders(order_id) ON DELETE RESTRICT NOT NULL,
    user_id INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE OR REPLACE FUNCTION fn_check_return_quantity()
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

    IF NEW.status <> 'rejected' AND already + NEW.quantity > ordered THEN
        RAISE EXCEPTION 'A customer cannot return more units than they bought of that listing.';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_return_quantity ON product_returns;
CREATE TRIGGER trg_check_return_quantity BEFORE INSERT OR UPDATE ON product_returns
FOR EACH ROW EXECUTE FUNCTION fn_check_return_quantity();

CREATE INDEX IF NOT EXISTS idx_product_returns_order ON product_returns(order_id, prod_id);
CREATE INDEX IF NOT EXISTS idx_product_returns_shop ON product_returns(shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_returns_courier ON product_returns(status, collected_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_returns_open ON product_returns(order_id, prod_id)
WHERE status IN ('requested', 'approved', 'collected');
