-- Shop reviews: the same proof-of-purchase rule the product reviews already
-- have, applied to a shop.
--
-- shop_reviews has existed since the first schema and nothing has ever read or
-- written it — the seed inserts a few rows and no query touches the table. This
-- adds the enforcement the product reviews already rely on, so the table can be
-- opened to customers without the API check being the only thing standing
-- between a signed-in stranger and any shop's rating.
--
-- The API checks eligibility too, because that is what turns a refusal into a
-- sentence instead of a 500. The trigger is the enforcement; the check is the
-- courtesy. Same division as fn_verify_product_review_purchase.
--
-- Idempotent: db:init loads schema.sql without recording migrations, so a later
-- db:migrate re-runs this file.
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
