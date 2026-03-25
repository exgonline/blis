# BLIS Pipeline Audit Report

**Date:** 2026-03-24 (updated 2026-03-25)
**Scope:** End-to-end pipeline audit — Stage 1 (EPC fetch → kWh), Stage 2 (cron → estimates), Stage 3 (API response)

---

## Summary

9 bugs found and fixed across 7 files. A data integrity incident (site `gz-170159` under-estimated ~60×) was diagnosed and remediated via migration `005`. 5 data quality improvements were subsequently added (migrations `006`, new service, new endpoint, new test files). No new npm packages introduced. No existing migrations modified.

---

## Bugs Found and Fixed

### Bug 1 — Stage 1 never stored annual kWh in `building_profiles`

**File:** `src/services/building-profile.service.ts`
**Problem:** After a successful EPC fetch, `triggerEpcRefresh` called `updateClassification` but never computed or persisted `annual_kwh_central`, `annual_kwh_p75`, `annual_kwh_low`, or `annual_kwh_high`. These columns were always NULL.
**Fix:** Added `calculateAndStoreKwh(siteId)` method that reads floor area, looks up the CIBSE TM46 benchmark and age multiplier, computes the four kWh bands, and writes them via `UPDATE`. `triggerEpcRefresh` now calls it after classification update. For `not_found` EPC status, it also calls `calculateAndStoreKwh` if floor area is already present.

---

### Bug 2 — Stage 2 re-derived kWh on every estimate instead of using stored values

**File:** `src/services/building-load.service.ts`
**Problem:** `calculateEstimate` always called `cibseService.getBenchmark` and `cibseService.getAgeMultiplier` inline, ignoring any stored `annual_kwh_central`/`annual_kwh_p75`. This made Stage 1 storage meaningless and caused redundant DB lookups on every cron tick.
**Fix:** Added a conditional: if `profile.annual_kwh_central` and `profile.annual_kwh_p75` are present, parse and use them directly. Falls back to inline calculation only when the profile hasn't been through Stage 1 yet.

---

### Bug 3 — `elexon_coefficient` and `safety_margin_applied` never persisted

**File:** `src/services/building-load.service.ts`
**Problem:** The `building_load_estimates` INSERT was missing `elexon_coefficient` and `safety_margin_applied` columns, so they were always NULL in the database.
**Fix:** Added both fields to the INSERT (20 parameters) and to the estimate object. Added `SAFETY_MARGINS` map (all confidence levels → 1.15) and stores `safetyMargin - 1` (i.e. `0.15`) as `safetyMarginApplied`.

---

### Bug 4 — `epc_rating` and `epc_fetched_at` never written to `building_profiles`

**File:** `src/services/building-profile.service.ts`
**Problem:** `updateClassification` SQL did not include `epc_rating` or `epc_fetched_at` columns, so EPC rating data from the API was discarded.
**Fix:** Added `epc_rating = $12, epc_fetched_at = $13` to the UPDATE and passed `energyRating` and `epcFetchedAt` as the 12th and 13th parameters.

---

### Bug 5 — `energyRating` missing from `EpcFetchResult`

**File:** `src/collectors/epc.collector.ts`
**Problem:** `EpcFetchResult` interface and all 4 return paths omitted `energyRating: string | null`. The value was parsed but then dropped, so Bug 4's fix had no data to receive.
**Fix:** Added `energyRating: string | null` to the `EpcFetchResult` interface and populated it in all return paths (`success`, `not_found`, `rate_limited`, `error`).

---

### Bug 6 — EPC API empty body not normalised

**File:** `src/collectors/epc.collector.ts`
**Problem:** The EPC Non-domestic API returns an empty HTTP body (not `{"rows":[]}`) when no certificate exists for a property. Axios parses this as an empty string. The code passed it through without checking, causing a downstream `TypeError` when accessing `.rows`.
**Fix:** Added a guard: if `data` is falsy, not an object, or lacks an array `rows` property, return `{ rows: [], 'total-results': 0 }`.

---

### Bug 7 — Season boundary used Monday instead of Sunday

**File:** `src/utils/season.ts`
**Problem:** `lastMondayOfMonth` computed the last Monday of a month using `dayOfWeek === 0 ? 6 : dayOfWeek - 1`, which gives days-back-to-Monday. The Elexon UNC calendar defines season boundaries on **Sundays**, not Mondays.
**Fix:** Renamed to `lastSundayOfMonth`. Simplified formula to `dayOfWeek` (days to step back to reach Sunday, since Sunday = 0 in `getUTCDay()`).

---

### Bug 8 — `high_summer` used wrong month boundaries (July→August instead of May→July)

**File:** `src/utils/season.ts`
**Problem:** `high_summer` was computed relative to last Monday of July and last Monday of August. Per the Elexon UNC spec, `high_summer` runs from the last Sunday of **May** through the last Sunday of **July** (exclusive).
**Fix:** Rewrote `getSeason` to compute four named transition Sundays (`lastSunMar`, `lastSunMay`, `lastSunJul`, `lastSunOct`) and use date comparisons:
- `high_summer`: `d >= lastSunMay && d < lastSunJul`
- `summer`: `d >= lastSunJul && month <= 8`
- `spring`: `d >= lastSunMar && d < lastSunMay`
- `autumn`: `month === 9`
- `winter`: everything else (Nov–Feb + pre-spring March)

---

### Bug 9 — Cron job iterated all sites including those without floor area / kWh

**File:** `src/jobs/precalculate-estimates.job.ts`
**Problem:** `runPrecalculateEstimates` called `buildingProfileService.getAllSiteIds()`, which returns every registered site. Sites without a floor area or without computed `annual_kwh_p75` (i.e. newly registered sites awaiting EPC fetch) caused `UNPROCESSABLE` errors on every cron tick, polluting logs and wasting resources.
**Fix:** Changed to `buildingProfileService.getCalculableSiteIds()`, which filters to `annual_kwh_p75 IS NOT NULL`.

---

## API Response (Stage 3)

**File:** `src/api/routes/estimate.routes.ts`
**Change:** The endpoint was returning a flat spread of the internal `BuildingLoadEstimate` object. Reshaped to the spec-compliant nested format:

```json
{
  "siteId": "...",
  "estimatedAt": "ISO8601",
  "buildingType": "hotel",
  "floorAreaM2": 361,
  "annualKwhP75": 150000,
  "currentEstimate": {
    "estimatedKw": 5.2,
    "estimatedAmpsTotal": 7.9,
    "estimatedAmpsL1": 3.0,
    "estimatedAmpsL2": 2.45,
    "estimatedAmpsL3": 2.45,
    "hhIndex": 28,
    "elexonSeason": "spring",
    "dayType": "weekday",
    "elexonCoefficient": 0.0000181,
    "confidenceLevel": "MANUAL_OVERRIDE",
    "safetyMarginApplied": 0.15
  },
  "dataSource": {
    "epcFetchedAt": "ISO8601",
    "annualKwhSource": "MANUAL_OVERRIDE",
    "epcRating": "C"
  }
}
```

Also added an explicit `SITE_NOT_FOUND` 404 before the estimate lookup, replacing the previous behaviour of relying on middleware to catch a thrown error.

The `dataSource` block now also includes:
```json
"dataSource": {
  "epcFetchedAt": "...",
  "annualKwhSource": "MANUAL_OVERRIDE",
  "epcRating": "C",
  "floorAreaConfidence": "MANUAL_OVERRIDE",
  "dataQualityFlag": null,
  "dataQualityNote": null,
  "floorAreaOverrideSource": "facilities team survey"
}
```

---

## Data Integrity Incident — Site gz-170159 (2026-03-25)

**Root cause:** The EPC Non-domestic API returned a certificate for a small 83 m² section of the building (a retail unit within the hotel complex). The `main-activity` field did not contain a hotel keyword, so the classifier fell back to `unknown`. Combined effect: annual kWh was computed as ~12,325 instead of the correct ~1,015,740 — a 60× under-estimate.

**Fix:** Migration `005_fix_gz170159_and_recalculate_kwh.sql` applied directly to production:
- Set `building_type_override = 'hotel'`, `floor_area_override = 3420 m²`, `elexon_profile_class = 1`, `confidence_level = 'MANUAL_OVERRIDE'`, corrected phase factors.
- Recalculated `annual_kwh_*` for all sites with floor area via a single UPDATE…FROM JOIN.

**Post-fix values:** gz-170159: 1,015,740 kWh central | bovey_castle_hotel: 107,217 | bovey_castle: 53,608.50

---

## Data Quality Improvements (2026-03-25)

### CHANGE 1 — Schema: floor area confidence + data quality flags

**File:** `migrations/006_data_quality_fields.sql`

New columns on `building_profiles`:
- `floor_area_confidence VARCHAR(20)` — `EPC_DERIVED` | `MANUAL_OVERRIDE` | `SUSPECT` | `CONFIRMED`
- `floor_area_override_m2 NUMERIC(10,2)` — audit copy of the override value
- `floor_area_override_source VARCHAR(200)` — who/what provided the override
- `floor_area_override_at TIMESTAMPTZ` — when the override was applied
- `data_quality_flag VARCHAR(50)` — e.g. `BELOW_MINIMUM_THRESHOLD`
- `data_quality_note TEXT` — human-readable explanation
- `data_quality_flagged_at TIMESTAMPTZ`

Migration also backfills `MANUAL_OVERRIDE` for all sites that already have `floor_area_override` set, and runs an initial quality sweep flagging any site whose `annual_kwh_central` is below the minimum plausible threshold for its building type.

### CHANGE 2 — Automatic data quality check after kWh calculation

**Files:** `src/services/data-quality.service.ts`, `src/services/building-profile.service.ts`

`calculateAndStoreKwh` now calls `runDataQualityCheck(siteId)` after persisting kWh values. The check compares `annual_kwh_central` against per-building-type minimum thresholds (e.g. 50,000 kWh for hotels). Suspect sites are flagged with `BELOW_MINIMUM_THRESHOLD`; sites with `MANUAL_OVERRIDE` floor area have any stale flags cleared automatically.

Minimum thresholds: hotel/hotel_budget: 50,000 | housing_association: 20,000 | fleet_depot: 15,000 | office_general/retail/pub_restaurant: 25,000 | car_park/warehouse/unknown: 5,000.

### CHANGE 3 — PATCH /v1/profile/:siteId/floor-area

**File:** `src/api/routes/profile.routes.ts`

New endpoint allowing operators to supply a corrected floor area (and optionally a corrected building type). Updates `floor_area_m2`, `floor_area_override`, `floor_area_override_m2`, `floor_area_confidence = 'MANUAL_OVERRIDE'`, and `floor_area_override_source`. Triggers a background `calculateEstimate` call so the load curve reflects the corrected area immediately.

### CHANGE 4 — Data quality fields in estimate response

**File:** `src/api/routes/estimate.routes.ts`

The `dataSource` block now includes `floorAreaConfidence`, `dataQualityFlag`, `dataQualityNote`, and `floorAreaOverrideSource` so API consumers can detect suspect floor area estimates without a separate profile call.

### CHANGE 5 — Backfill quality check in migration

**File:** `migrations/006_data_quality_fields.sql`

The migration runs the threshold check as a SQL UPDATE so that all existing production sites are evaluated on deployment — the same logic applied by the TypeScript service at runtime.

---

## Tests Added (2026-03-25)

- `tests/data-quality.service.test.ts` — unit tests for `getKwhThreshold`, `isBelowThreshold`, `buildQualityNote` (pure functions, no DB)
- `tests/floor-area-override.test.ts` — schema validation tests for `floorAreaOverrideSchema` covering boundary values and all `BuildingType` enum members

---

## Seasonal Profile Endpoint (2026-03-25)

### Feature Summary

New endpoint `GET /v1/estimate/:siteId/seasonal-profile` returns a complete 576-period charging availability profile for a site (4 seasons × 3 day types × 48 half-hour periods), plus a summary block with best/worst charging windows, annual usable kWh totals, and a flexibility asset estimate.

### New Files

| File | Purpose |
|------|---------|
| `migrations/007_grid_connection.sql` | Adds `grid_connection_kw` to `building_profiles`; creates `seasonal_profile_cache` table |
| `src/services/seasonal-profile.service.ts` | Calculation engine, cache logic, cache invalidation |
| `tests/seasonal-profile.service.test.ts` | Unit tests for pure calculation functions and cache key |
| `tests/api/seasonal-profile.routes.test.ts` | Route integration tests (14 tests, 0 DB calls) |

### Modified Files

| File | Change |
|------|--------|
| `src/types/index.ts` | Added `grid_connection_kw` to `BuildingProfileRow` and `BuildingProfileResponse`; added 7 new interfaces for the seasonal profile response shape |
| `src/services/building-profile.service.ts` | Added `updateGridConnection` method; added `invalidateSeasonalCache` call in `applyFloorAreaOverride` |
| `src/api/routes/profile.routes.ts` | Added `PATCH /:siteId/grid-connection` |
| `src/api/routes/estimate.routes.ts` | Added `GET /:siteId/seasonal-profile` |

### Calculation Logic

For each of the 576 combinations (season × day type × hhIndex):

1. `estimatedBuildingKw = (annualKwhP75 × elexonCoefficient / 0.5) × (1 + safetyMargin)`
2. `availableChargingKw = max(0, gridConnectionKw × 0.8 − estimatedBuildingKw)`
3. `usableChargingKwh = availableChargingKw × 0.5 × 0.92`
4. `flexibilityDispatchableKw = availableChargingKw × 0.65`

Elexon coefficients are loaded in a single bulk query (576 rows) rather than 576 individual lookups.

### Summary Calculations

- **bestChargingWindow / worstChargingWindow**: 4-period (2-hour) sliding window over the per-hhIndex mean `availableChargingKw` across all 12 season/day-type combinations.
- **totalAnnualUsableChargingKwh**: Weighted sum using seasonal day counts (winter: 151, spring: 61, summer: 92, high_summer: 61) and day-type frequencies (weekday: 261, Saturday: 52, Sunday: 52).
- **flexibilityAssetMw**: Average `flexibilityDispatchableKw` during winter weekday 16:00–20:00 (hhIndex 32–39) divided by 1000.

### Cache Strategy

Results are cached in `seasonal_profile_cache` keyed by MD5 of `(siteId, gridConnectionKw, safetyMargin, annualKwhP75, elexonProfileClass)`. Cache TTL is 24 hours. The cache row for a site is deleted (invalidated) whenever:
- `PATCH /:siteId/floor-area` is called (floor area or building type changed → kWh changed → profile changes)
- `PATCH /:siteId/grid-connection` is called (headroom calculation changes)

The `cachedAt` field in the response is `null` for fresh calculations and an ISO 8601 timestamp for cached responses.

### Query Parameters

| Parameter | Type | Default | Validation |
|-----------|------|---------|------------|
| `gridConnectionKw` | number | stored value or 100 kW | positive, max 10,000; 422 if invalid |
| `safetyMargin` | number | 0.15 | 0–1 range; 400 if out of range |

### Grid Connection Column

`building_profiles.grid_connection_kw` is nullable. Sites where this is NULL use the 100 kW default. **These sites should be reviewed and have their actual grid connection capacity entered via `PATCH /v1/profile/:siteId/grid-connection`.**

Current production state (as of migration 007 deployment):

| Site | grid_connection_kw |
|------|--------------------|
| gz-170159 | NULL — **review required** |
| bovey_castle_hotel | NULL — **review required** |
| bovey_castle | NULL — **review required** |
| test_site_001 | NULL — **review required** |

All four active sites are using the 100 kW default. Seasonal profile estimates for these sites should be treated as indicative until the actual grid connection capacity is recorded.

### Error Responses

| Condition | Status | Code |
|-----------|--------|------|
| Site not found | 404 | `NOT_FOUND` |
| `annual_kwh_p75` not yet calculated | 422 | `UNPROCESSABLE` |
| Elexon data missing for profile class | 500 | `ELEXON_MISSING` |
| `gridConnectionKw` ≤ 0 | 422 | `UNPROCESSABLE` |
| `safetyMargin` outside 0–1 | 400 | `VALIDATION_ERROR` |

---

## Schema Migration

**File:** `migrations/004_add_annual_kwh_to_profiles.sql`
Adds missing columns without modifying existing migrations:

```sql
ALTER TABLE building_profiles
  ADD COLUMN IF NOT EXISTS annual_kwh_central  DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_p75      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_low      DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS annual_kwh_high     DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS epc_rating          VARCHAR(5),
  ADD COLUMN IF NOT EXISTS epc_fetched_at      TIMESTAMPTZ;

ALTER TABLE building_load_estimates
  ADD COLUMN IF NOT EXISTS elexon_coefficient    DECIMAL(12,8),
  ADD COLUMN IF NOT EXISTS safety_margin_applied DECIMAL(5,4);
```
