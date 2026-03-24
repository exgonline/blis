-- Stage 1 kWh calculation outputs — stored after EPC fetch so Stage 2 job
-- can read them directly rather than recalculating on every run.
ALTER TABLE building_profiles
  ADD COLUMN IF NOT EXISTS annual_kwh_central  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_p75      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_low      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_high     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS epc_rating          VARCHAR(5),
  ADD COLUMN IF NOT EXISTS epc_fetched_at      TIMESTAMPTZ;

-- Elexon coefficient and safety-margin stored per estimate row so the API
-- response can surface them without a secondary lookup.
ALTER TABLE building_load_estimates
  ADD COLUMN IF NOT EXISTS elexon_coefficient    DECIMAL(12,8),
  ADD COLUMN IF NOT EXISTS safety_margin_applied DECIMAL(5,4);
