# BLIS Pipeline Audit Report

**Date:** 2026-03-24
**Scope:** End-to-end pipeline audit — Stage 1 (EPC fetch → kWh), Stage 2 (cron → estimates), Stage 3 (API response)

---

## Summary

9 bugs found and fixed across 7 files. A new migration (`004`) adds the missing database columns. No new npm packages introduced. No existing migrations modified.

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
