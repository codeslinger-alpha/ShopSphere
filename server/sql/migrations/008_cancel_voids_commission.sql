-- A cancelled order voids its platform commission.
--
-- Commission is written at placement and stored per line, which is the right
-- shape for reporting: it records what was agreed rather than what is currently
-- true. But a cancelled order never happens — the stock goes back, the payment is
-- marked failed, and no money changes hands — so a positive commission left on it
-- would have the admin payments screen reporting platform revenue beside a failed
-- payment. The figure is zeroed by the same trigger that voids everything else,
-- so the two can never disagree.
--
-- This landed with the commission feature itself: before it, every
-- platform_commission column in the database was still at its default of 0, so
-- there is no backfill to write.
--
-- The whole function is repeated because CREATE OR REPLACE cannot patch a body.
-- Only the two zeroes are new; everything else is byte-for-byte what schema.sql
-- already had.
--
-- Idempotent: db:init loads schema.sql without recording migrations, so a later
-- db:migrate re-runs this file.
CREATE OR REPLACE FUNCTION fn_cleanup_cancelled_order()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE products p SET in_stock = p.in_stock + oi.quantity
    FROM order_items oi WHERE oi.order_id = NEW.order_id AND oi.prod_id = p.prod_id;
    UPDATE orders SET delivery_person_id = NULL, platform_commission = 0
    WHERE order_id = NEW.order_id;
    UPDATE payments SET payment_status = 'failed', paid_at = NULL
    WHERE order_id = NEW.order_id AND payment_status = 'pending';
    UPDATE order_items SET platform_commission = 0 WHERE order_id = NEW.order_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
