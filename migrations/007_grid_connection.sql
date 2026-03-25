-- ─────────────────────────────────────────────────────────────────────────────
-- 007_grid_connection.sql
--
-- Adds grid_connection_kw to building_profiles for G100 available-capacity
-- modelling, and creates the seasonal_profile_cache table used by the
-- GET /v1/estimate/:siteId/seasonal-profile endpoint.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE building_profiles
  ADD COLUMN IF NOT EXISTS grid_connection_kw NUMERIC(10,2);

-- NULL means "not yet set — endpoint will use 100 kW default"

CREATE TABLE IF NOT EXISTS seasonal_profile_cache (
  id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  site_id           VARCHAR(100) NOT NULL REFERENCES building_profiles(site_id) ON DELETE CASCADE,
  cache_key         VARCHAR(100) NOT NULL,
  profile_json      JSONB       NOT NULL,
  grid_connection_kw NUMERIC(10,2),
  safety_margin     NUMERIC(5,4),
  annual_kwh_p75    NUMERIC(15,2),
  calculated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(site_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_seasonal_cache_site_id ON seasonal_profile_cache(site_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_cache_calculated_at ON seasonal_profile_cache(calculated_at);
