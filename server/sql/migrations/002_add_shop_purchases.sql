-- Run once on databases created before shop_purchases was added to schema.sql.
CREATE TABLE IF NOT EXISTS shop_purchases(
    purchase_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    master_prod_id INT REFERENCES master_products(master_prod_id) ON DELETE RESTRICT NOT NULL,
    quantity INT NOT NULL CHECK (quantity > 0),
    wholesale_unit_price NUMERIC(12,2) NOT NULL CHECK (wholesale_unit_price >= 0),
    purchased_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
