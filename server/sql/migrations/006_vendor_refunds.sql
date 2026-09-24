-- Vendor refunds: the compensation half of removing a listing.
--
-- schema.sql has carried this TODO since the beginning: "Process product
-- compensation to shop owner on removal of product by admin". fn_prevent_delete
-- makes a hard DELETE impossible for products, so removal has always been
-- products.discontinued = true — and until now that left the vendor holding
-- stock they had paid wholesale for and could no longer sell.
--
-- This table is the ledger of what was paid back, and shops.earnings is the
-- running total it feeds. One row per listing per removal; a master-product
-- removal writes one row per shop that still held stock of it.
--
-- Idempotent: db:init loads schema.sql without recording migrations, so a later
-- db:migrate re-runs this file.
CREATE TABLE IF NOT EXISTS vendor_refunds (
    refund_id INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- Who is paid, and for what. All three are kept so a refund stays readable
    -- after the listing is retired and out of every catalogue view.
    shop_id INT REFERENCES shops(shop_id) ON DELETE RESTRICT NOT NULL,
    prod_id INT REFERENCES products(prod_id) ON DELETE RESTRICT NOT NULL,
    master_prod_id INT REFERENCES master_products(master_prod_id) ON DELETE RESTRICT NOT NULL,
    -- Units of remaining stock compensated. Zero is a legitimate value: a
    -- listing with nothing on the shelf is still discontinued, it just costs
    -- nothing, and the row records that the removal happened.
    units INT NOT NULL CHECK (units >= 0),
    -- Effective wholesale price per unit, not the price of any one purchase:
    -- a listing's remaining stock is attributed across several purchase rows at
    -- different prices, so this is amount / units. NULL when units is 0, where
    -- an average would be a division by zero rather than a number.
    unit_amount NUMERIC(12,2),
    amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
    reason VARCHAR NOT NULL CHECK (reason IN ('admin_removal', 'shop_closed')),
    -- The acting administrator. Kept because "who decided to pay this out" is
    -- the first question asked of any ledger row.
    removed_by INT REFERENCES users(user_id) ON DELETE RESTRICT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The two reads this table serves: one shop's refund history (the vendor's
-- payments tab) and the whole ledger, newest first (the admin console).
CREATE INDEX IF NOT EXISTS idx_vendor_refunds_shop
    ON vendor_refunds (shop_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vendor_refunds_created
    ON vendor_refunds (created_at DESC);
