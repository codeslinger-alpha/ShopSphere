-- Run once on databases created before couriers recorded their vehicle.
--
-- delivery_personnel carried a single free-text vehicle_info column, which cannot
-- answer "what is bringing my order" or let a dispatcher match a van to a large
-- load. These columns split the parts worth filtering on out of that prose.
-- vehicle_info stays as the free-text notes field it always was.
--
-- Idempotent: db:init loads schema.sql without recording migrations, so a later
-- db:migrate re-runs this file.
ALTER TABLE delivery_personnel
    ADD COLUMN IF NOT EXISTS vehicle_type VARCHAR,
    ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR,
    ADD COLUMN IF NOT EXISTS license_number VARCHAR,
    ADD COLUMN IF NOT EXISTS vehicle_model VARCHAR;
