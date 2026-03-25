# Seasonal Profile — Integration Guide

**Endpoint:** `GET /v1/estimate/:siteId/seasonal-profile`
**Supporting endpoint:** `PATCH /v1/profile/:siteId/grid-connection`

This document explains the seasonal profile endpoint — what it returns, how to interpret each field, how the caching layer works, and how to set up a site correctly before calling it.

---

## Overview

The seasonal profile gives you a full picture of when a site has spare electrical capacity for EV charging or flexible load dispatch. For every combination of season, day type, and half-hour slot across the year (576 combinations total), it tells you:

- How much of the grid connection is consumed by the building
- How much headroom is available for EV charging (G100 80% rule applied)
- How much usable energy is available per slot (kWh, AC efficiency applied)
- How much of that is considered dispatchable (65% of mixed asset types)

On top of the per-slot data, the response includes a summary block with the best and worst 2-hour charging windows, annual usable kWh totals, and a flexibility asset MW estimate for winter peak.

---

## Prerequisites

Before calling this endpoint the site must have:

1. **`annual_kwh_p75` populated** — this is set automatically after a successful EPC fetch (`POST /v1/epc/register`) or after a floor area override (`PATCH /v1/profile/:siteId/floor-area`). If it is missing, the endpoint returns 422.

2. **`grid_connection_kw` set** (recommended) — use `PATCH /v1/profile/:siteId/grid-connection` to store the site's actual agreed grid import capacity. If not set, the endpoint defaults to 100 kW. Results based on the default should be treated as indicative only.

---

## Authentication

All requests require the `x-blis-api-key` header.

```
x-blis-api-key: <your-api-key>
```

---

## Step 1 — Set the Grid Connection Capacity

```
PATCH /v1/profile/:siteId/grid-connection
Content-Type: application/json
x-blis-api-key: <your-api-key>
```

### Request Body

| Field             | Type   | Required | Constraints           | Description                                             |
|-------------------|--------|----------|-----------------------|---------------------------------------------------------|
| `gridConnectionKw` | number | Yes      | positive, max 10,000  | Agreed import capacity in kW from the DNO connection    |

### Example

```json
{
  "gridConnectionKw": 200
}
```

### Response

HTTP 200 — returns the updated building profile with `gridConnectionKw` populated.

```json
{
  "siteId": "gz-170159",
  "gridConnectionKw": 200,
  ...
}
```

Setting this value also invalidates any existing seasonal profile cache for the site, so the next call to the seasonal profile endpoint will recalculate using the new capacity.

---

## Step 2 — Fetch the Seasonal Profile

```
GET /v1/estimate/:siteId/seasonal-profile
x-blis-api-key: <your-api-key>
```

### Path Parameter

| Parameter | Type   | Required | Description                                  |
|-----------|--------|----------|----------------------------------------------|
| `siteId`  | string | Yes      | The site ID registered in BLIS               |

### Optional Query Parameters

| Parameter        | Type   | Default            | Description                                                                         |
|------------------|--------|--------------------|-------------------------------------------------------------------------------------|
| `gridConnectionKw` | number | stored value or 100 kW | Override the grid connection for modelling purposes — does not save to the profile  |
| `safetyMargin`   | number | `0.15`             | Override the safety margin applied to building load (0–1). Default adds 15%.        |

The query param override is intended for what-if modelling (e.g. "what if we upgrade to a 350 kW connection?") without modifying the stored site data.

### Example Requests

Minimal:
```
GET /v1/estimate/gz-170159/seasonal-profile
```

With modelling override:
```
GET /v1/estimate/gz-170159/seasonal-profile?gridConnectionKw=350&safetyMargin=0.10
```

---

## Response Shape

```json
{
  "siteId": "gz-170159",
  "cachedAt": null,
  "generatedInMs": 87,
  "gridConnectionKw": 200,
  "safetyMargin": 0.15,
  "annualKwhP75": 1167601,
  "seasons": {
    "winter": {
      "weekday":  { "halfHourlyProfile": [ ...48 periods... ] },
      "saturday": { "halfHourlyProfile": [ ...48 periods... ] },
      "sunday":   { "halfHourlyProfile": [ ...48 periods... ] }
    },
    "spring":      { ... },
    "summer":      { ... },
    "high_summer": { ... }
  },
  "summary": {
    "bestChargingWindow":  { ... },
    "worstChargingWindow": { ... },
    "totalAnnualUsableChargingKwh": 601932,
    "averageDailyUsableChargingKwh": 1649.13,
    "flexibilityAssetMw": 0.044
  }
}
```

### Top-Level Fields

| Field              | Type            | Description                                                                          |
|--------------------|-----------------|--------------------------------------------------------------------------------------|
| `siteId`           | string          | The site identifier                                                                  |
| `cachedAt`         | string \| null  | ISO 8601 timestamp if the response came from cache; `null` if freshly calculated     |
| `generatedInMs`    | number          | Wall-clock milliseconds to produce this response (includes cache lookup time)        |
| `gridConnectionKw` | number          | The grid connection value used for this calculation (stored or overridden)           |
| `safetyMargin`     | number          | The safety margin applied (stored default or query param override)                   |
| `annualKwhP75`     | number          | The P75 annual kWh figure used as the building load baseline                         |
| `seasons`          | object          | Full half-hourly profiles for all four seasons — see below                           |
| `summary`          | object          | Aggregated charging statistics — see below                                           |

---

## Half-Hourly Period Object

Each entry in a `halfHourlyProfile` array represents one 30-minute slot.

```json
{
  "hhIndex": 32,
  "timeStart": "16:00",
  "elexonCoefficient": 0.0000231,
  "estimatedBuildingKw": 54.2,
  "availableChargingKw": 105.8,
  "usableChargingKwh": 48.67,
  "flexibilityDispatchableKw": 68.77
}
```

| Field                      | Type   | Description                                                                                        |
|----------------------------|--------|----------------------------------------------------------------------------------------------------|
| `hhIndex`                  | number | Half-hour period index (0 = 00:00–00:30, 47 = 23:30–00:00)                                        |
| `timeStart`                | string | Period start in `HH:MM` format (UTC)                                                               |
| `elexonCoefficient`        | number | Elexon UNC profile coefficient for this season/day type/period                                     |
| `estimatedBuildingKw`      | number | Estimated building load in kW (P75 × coefficient, safety margin applied)                           |
| `availableChargingKw`      | number | Headroom available for EV charging: `max(0, gridConnectionKw × 0.8 − estimatedBuildingKw)`         |
| `usableChargingKwh`        | number | Energy deliverable in this slot: `availableChargingKw × 0.5h × 0.92 AC efficiency`                |
| `flexibilityDispatchableKw`| number | Estimated dispatchable flexibility: `availableChargingKw × 0.65` (mixed asset assumption)          |

### Calculation Chain

```
annualKwhP75 × elexonCoefficient
────────────────────────────────  ×  (1 + safetyMargin)  =  estimatedBuildingKw
          0.5 h

gridConnectionKw × 0.8  −  estimatedBuildingKw  =  availableChargingKw  (floored at 0)

availableChargingKw × 0.5 × 0.92  =  usableChargingKwh

availableChargingKw × 0.65  =  flexibilityDispatchableKw
```

**Why 0.8?** — G100 network connection agreement limits site-level draw to 80% of the agreed import capacity to preserve DNO headroom.

**Why 0.92?** — AC charging equipment typically operates at approximately 92% round-trip efficiency.

**Why 0.65?** — In a mixed fleet of AC chargers, slow chargers, and managed loads, approximately 65% of connected capacity is assumed to be immediately dispatchable.

---

## Seasons

BLIS uses the Elexon UNC calendar:

| Season       | Approximate date range                        |
|--------------|-----------------------------------------------|
| `winter`     | Last Sunday of October → last Sunday of March |
| `spring`     | Last Sunday of March → last Sunday of May     |
| `high_summer`| Last Sunday of May → last Sunday of July      |
| `summer`     | Last Sunday of July → last Sunday of October  |

All four are always present in the response.

---

## Summary Block

```json
"summary": {
  "bestChargingWindow": {
    "startHhIndex": 0,
    "endHhIndex": 3,
    "startTime": "00:00",
    "endTime": "02:00",
    "averageAvailableChargingKw": 148.3
  },
  "worstChargingWindow": {
    "startHhIndex": 32,
    "endHhIndex": 35,
    "startTime": "16:00",
    "endTime": "18:00",
    "averageAvailableChargingKw": 12.1
  },
  "totalAnnualUsableChargingKwh": 601932,
  "averageDailyUsableChargingKwh": 1649.13,
  "flexibilityAssetMw": 0.044
}
```

### Charging Windows

Both `bestChargingWindow` and `worstChargingWindow` describe the 2-hour (4-period) contiguous block of time where the average `availableChargingKw` — averaged across all seasons and day types — is highest or lowest respectively.

| Field                       | Description                                                       |
|-----------------------------|-------------------------------------------------------------------|
| `startHhIndex`              | First half-hour period in the window (inclusive)                  |
| `endHhIndex`                | Last half-hour period in the window (inclusive)                   |
| `startTime`                 | Start time of window in `HH:MM` format                            |
| `endTime`                   | Exclusive end time of window (start of next period after window)  |
| `averageAvailableChargingKw`| Mean available charging kW across the 4 periods and all 12 season/day-type combinations |

The best charging window is the best time to dispatch flexible loads or schedule charging sessions. The worst window is the peak building load period — avoid scheduling large loads here.

### Annual and Daily Totals

| Field                          | Description                                                                                                  |
|--------------------------------|--------------------------------------------------------------------------------------------------------------|
| `totalAnnualUsableChargingKwh` | Estimated total usable charging energy per year, weighted by seasonal day counts and day-type frequencies     |
| `averageDailyUsableChargingKwh`| `totalAnnualUsableChargingKwh / 365`                                                                         |

**Seasonal day weights used:**

| Season       | Days/yr |
|--------------|---------|
| `winter`     | 151     |
| `spring`     | 61      |
| `summer`     | 92      |
| `high_summer`| 61      |

**Day-type frequencies:**

| Day type   | Days/yr |
|------------|---------|
| Weekday    | 261     |
| Saturday   | 52      |
| Sunday     | 52      |

### Flexibility Asset

| Field                | Description                                                                                                          |
|----------------------|----------------------------------------------------------------------------------------------------------------------|
| `flexibilityAssetMw` | Average `flexibilityDispatchableKw` during winter weekday 16:00–20:00 (hhIndex 32–39), divided by 1000             |

This figure represents the approximate MW of dispatchable flexibility available to offer to a flexibility market or DSR aggregator during the highest-demand period of the year. It is expressed in MW to align with market reporting conventions.

---

## Caching

The seasonal profile computation is expensive (576 Elexon lookups and calculations). Results are automatically cached in the database.

| Behaviour | Detail |
|-----------|--------|
| Cache TTL | 24 hours from calculation time |
| Cache key | MD5 of `siteId + gridConnectionKw + safetyMargin + annualKwhP75 + elexonProfileClass` — different parameter combinations are cached independently |
| Cache hit indicator | `cachedAt` is an ISO 8601 timestamp in the response |
| Cache miss indicator | `cachedAt` is `null` |
| Automatic invalidation | Cache is cleared when `PATCH /:siteId/floor-area` or `PATCH /:siteId/grid-connection` is called — the next request recalculates fresh |

**Implication:** Calls with `?gridConnectionKw=350` or `?safetyMargin=0.10` are cached independently from calls with default parameters. Repeated modelling calls with the same override values will be served from cache within the 24-hour window.

---

## Error Responses

### 404 — Site not found

```json
{
  "error": "NOT_FOUND",
  "message": "Site gz-170159 not found",
  "statusCode": 404,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

### 422 — No annual kWh data yet

Returned when the site has been registered but has not yet had an EPC fetch or floor area override applied.

```json
{
  "error": "UNPROCESSABLE",
  "message": "annual_kwh_p75 not available for site gz-170159 — run EPC fetch first",
  "statusCode": 422,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

### 422 — Invalid gridConnectionKw query param

```json
{
  "error": "UNPROCESSABLE",
  "message": "gridConnectionKw must be a positive number",
  "statusCode": 422,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

### 400 — safetyMargin out of range

```json
{
  "error": "VALIDATION_ERROR",
  "message": "safetyMargin must be a number between 0 and 1",
  "statusCode": 400,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

### 500 — Elexon profile data missing

Returned if the Elexon UNC coefficients have not been seeded for the site's profile class.

```json
{
  "error": "ELEXON_MISSING",
  "message": "No Elexon profile data found for profile class 1",
  "statusCode": 500,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

This should not occur in a correctly initialised deployment. If seen, re-run the Elexon data seeder.

---

## Typical Integration Workflow

```
1.  POST  /v1/epc/register  (or PATCH /v1/profile/:siteId/floor-area)
        → annual_kwh_p75 is populated

2.  PATCH /v1/profile/:siteId/grid-connection
        body: { "gridConnectionKw": 200 }
        → grid connection stored, cache invalidated

3.  GET   /v1/estimate/:siteId/seasonal-profile
        → 200, cachedAt: null, full 576-period profile returned
        → store profile locally if needed — valid for 24 hours

4.  Repeat GET with ?gridConnectionKw=350 for upgrade modelling
        → independent cache entry, does not affect stored capacity

5.  Display summary.bestChargingWindow to fleet managers
        → schedule charging sessions in this window

6.  Submit summary.flexibilityAssetMw to DSR aggregator
        → MW of controllable flexibility available at winter peak
```

---

## Reading the Profile for Scheduling

To find the best charging slots for a specific day type and season:

1. Select `seasons[season][dayType].halfHourlyProfile`
2. Sort by `availableChargingKw` descending
3. Take the top N contiguous periods that cover your required session length
4. Check `usableChargingKwh` per period to estimate energy delivered

To find slots where dispatch is constrained (useful for tariff optimisation):

1. Filter periods where `availableChargingKw < threshold` (e.g. < 20 kW)
2. These are periods where the building is near its G100 limit — avoid scheduling large sessions here

---

## Notes on Defaults

**Grid connection default (100 kW):** This is a conservative placeholder. Most commercial sites have agreed import capacities of 100–500 kW. A 100 kW default will underestimate available headroom for larger sites and should be replaced with the actual DNO connection figure as soon as it is available.

**Safety margin default (0.15):** A 15% uplift is applied to the estimated building load before calculating headroom. This accounts for load variability not captured in the Elexon profile. Lower values (e.g. 0.05) will show more available headroom but carry more risk of exceeding the G100 limit in practice.

**P75 annual kWh:** The seasonal profile uses the P75 (75th percentile) annual kWh figure rather than the central estimate, meaning the building load used is already on the higher end. Combined with the 15% safety margin, the resulting `availableChargingKw` is a conservative estimate of what is safely dispatchable.
