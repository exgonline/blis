-- Add elexon_coefficient and safety_margin_applied to building_load_estimates.
-- These columns are referenced in saveEstimate but were never added to the schema,
-- causing every INSERT to fail silently and the estimate cache to be permanently broken.
ALTER TABLE building_load_estimates
  ADD COLUMN IF NOT EXISTS elexon_coefficient    DECIMAL(12,8),
  ADD COLUMN IF NOT EXISTS safety_margin_applied DECIMAL(5,4);
