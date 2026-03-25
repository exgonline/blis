-- ─────────────────────────────────────────────────────────────────────────────
-- 006_data_quality_fields.sql
--
-- Adds floor-area confidence tracking and data quality flags to building_profiles.
-- Runs an initial quality check across all existing rows so that any site whose
-- annual kWh is implausibly low for its building type is immediately flagged.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE building_profiles
  ADD COLUMN IF NOT EXISTS floor_area_confidence      VARCHAR(20)  NOT NULL DEFAULT 'EPC_DERIVED'
    CHECK (floor_area_confidence IN ('EPC_DERIVED','MANUAL_OVERRIDE','SUSPECT','CONFIRMED')),
  ADD COLUMN IF NOT EXISTS floor_area_override_m2     NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS floor_area_override_source VARCHAR(200),
  ADD COLUMN IF NOT EXISTS floor_area_override_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS data_quality_flag          VARCHAR(50),
  ADD COLUMN IF NOT EXISTS data_quality_note          TEXT,
  ADD COLUMN IF NOT EXISTS data_quality_flagged_at    TIMESTAMPTZ;

-- Backfill: sites already carrying a manual floor_area_override (e.g. from
-- migration 005) should be classified as MANUAL_OVERRIDE, not EPC_DERIVED.
UPDATE building_profiles
SET
  floor_area_confidence  = 'MANUAL_OVERRIDE',
  floor_area_override_m2 = floor_area_override
WHERE floor_area_override IS NOT NULL;

-- Initial quality check: flag any site whose annual_kwh_central falls below
-- the minimum plausible threshold for its effective building type.
-- (MANUAL_OVERRIDE sites are excluded — the user has already confirmed the area.)
UPDATE building_profiles
SET
  floor_area_confidence   = 'SUSPECT',
  data_quality_flag       = 'BELOW_MINIMUM_THRESHOLD',
  data_quality_note       = 'Annual kWh is below minimum plausible threshold for '
                            || COALESCE(building_type_override, building_type)
                            || '. EPC may cover partial building only. '
                            || 'Manual floor area override recommended.',
  data_quality_flagged_at = NOW()
WHERE annual_kwh_central IS NOT NULL
  AND floor_area_confidence != 'MANUAL_OVERRIDE'
  AND (
    (COALESCE(building_type_override, building_type) IN ('hotel','hotel_budget')
      AND annual_kwh_central < 50000)
    OR
    (COALESCE(building_type_override, building_type) = 'housing_association'
      AND annual_kwh_central < 20000)
    OR
    (COALESCE(building_type_override, building_type) = 'fleet_depot'
      AND annual_kwh_central < 15000)
    OR
    (COALESCE(building_type_override, building_type) IN ('car_park','car_park_with_facilities')
      AND annual_kwh_central < 5000)
    OR
    (COALESCE(building_type_override, building_type) IN ('office_general','retail','pub_restaurant')
      AND annual_kwh_central < 25000)
    OR
    (COALESCE(building_type_override, building_type) IN ('warehouse_simple','unknown')
      AND annual_kwh_central < 5000)
  );
