-- ─────────────────────────────────────────────────────────────────────────────
-- 005_fix_gz170159_and_recalculate_kwh.sql
--
-- ROOT CAUSE (diagnosed 2026-03-25):
--   Site gz-170159 has floor_area_m2 = 83 m² and building_type = 'unknown'
--   because the EPC certificate that was matched covers only a small portion
--   of the building.  No manual overrides were set at registration.
--
--   annual_kwh_central = 83 × 110 (unknown) × 1.35 (unknown age) = 12,325.50
--   Expected central   = 3420 × 220 (hotel)  × 1.35               = 1,015,740
--
-- FIX — two steps:
--   1. Set manual overrides for gz-170159: correct floor area and building type.
--   2. Recalculate annual_kwh_* for every site that has a usable floor area,
--      using effective values (override > EPC-derived).  This also backfills
--      sites registered before the Stage 1 kWh pipeline existed (e.g. bovey_castle,
--      bovey_castle_hotel) whose annual_kwh columns are still NULL.
-- ─────────────────────────────────────────────────────────────────────────────

-- Step 1: Correct gz-170159 with manual overrides
UPDATE building_profiles SET
  building_type_override = 'hotel',
  floor_area_override    = 3420,
  elexon_profile_class   = 1,               -- hotel → class 1 (was 3 for unknown)
  cibse_category         = 'hotel',
  confidence_level       = 'MANUAL_OVERRIDE',
  classified_by          = 'manual',
  classified_at          = NOW(),
  phase_l1_factor        = 0.3800,          -- hotel phase distribution
  phase_l2_factor        = 0.3100,
  phase_l3_factor        = 0.3100,
  phase_factor_source    = 'building_type_default'
WHERE site_id = 'gz-170159';

-- Step 2: Recalculate annual kWh for all sites with a usable floor area.
-- Effective floor area  = COALESCE(floor_area_override, floor_area_m2)
-- Effective type        = COALESCE(building_type_override, building_type)
-- Effective age band    = COALESCE(building_age_override, building_age)
--
-- Expected results after this migration:
--   gz-170159       : central=1,015,740  p75=1,168,101  low=692,550   high=1,320,462
--   bovey_castle_hotel: central=107,217  p75=123,299.55 low=73,102.5  high=139,382.1
--   bovey_castle    : central=53,578.5   p75=61,615.28  low=29,241    high=69,652.05
UPDATE building_profiles AS bp
SET
  annual_kwh_central = ROUND(
    COALESCE(bp.floor_area_override, bp.floor_area_m2)
    * cb.typical_kwh
    * am.multiplier, 2),
  annual_kwh_p75 = ROUND(
    COALESCE(bp.floor_area_override, bp.floor_area_m2)
    * cb.typical_kwh
    * am.multiplier * 1.15, 2),
  annual_kwh_low = ROUND(
    COALESCE(bp.floor_area_override, bp.floor_area_m2)
    * cb.good_practice_kwh
    * am.multiplier, 2),
  annual_kwh_high = ROUND(
    COALESCE(bp.floor_area_override, bp.floor_area_m2)
    * cb.typical_kwh
    * am.multiplier * 1.30, 2)
FROM cibse_benchmarks cb, age_multipliers am
WHERE cb.category = COALESCE(bp.building_type_override, bp.building_type)
  AND am.age_band  = COALESCE(bp.building_age_override,  bp.building_age)
  AND COALESCE(bp.floor_area_override, bp.floor_area_m2) IS NOT NULL;
