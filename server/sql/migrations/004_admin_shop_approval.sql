-- Run once on databases created before shops could be 'pending'.
--
-- Widens the shop status so a vendor submission can wait for administrator
-- approval, and restores the shop half of the ban cascade when a user is
-- re-enabled. Idempotent: db:init loads schema.sql without recording
-- migrations, so a later db:migrate re-runs this file.
ALTER TABLE shops DROP CONSTRAINT IF EXISTS shops_active_status_check;
ALTER TABLE shops ADD CONSTRAINT shops_active_status_check
CHECK (active_status IN ('active', 'disabled', 'pending'));

-- An administrator un-banning a user expects the user's shops to come back.
-- Listings deliberately stay discontinued, so a vendor consciously relists.
-- delivery_personnel is deliberately untouched; see schema.sql for why.
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

DROP TRIGGER IF EXISTS trg_enable_user_dependents ON users;
CREATE TRIGGER trg_enable_user_dependents
AFTER UPDATE ON users
FOR EACH ROW
WHEN (NEW.active_status = 'active' AND OLD.active_status IS DISTINCT FROM 'active')
EXECUTE FUNCTION fn_enable_user_dependents();
