# Floor Area Override — Integration Guide

**Endpoint:** `PATCH /v1/profile/:siteId/floor-area`

This document explains when and how to use the floor area override endpoint, what it changes, how to interpret the data quality fields it returns, and what happens downstream when an override is applied.

---

## When to Use This Endpoint

BLIS derives floor area from the EPC Non-domestic API. EPC certificates are sometimes issued for a single unit within a larger building (a retail unit, a lift lobby, a plant room). When that happens, the recorded floor area will be far smaller than the actual building, and the resulting annual kWh estimate will be implausibly low.

You should call this endpoint when:

- The `dataQualityFlag` on a site is `BELOW_MINIMUM_THRESHOLD` — BLIS has already detected that the kWh estimate is too low for the building type.
- You have a more accurate floor area from a facilities team survey, planning documents, or a measured building.
- You want to correct the building type at the same time (e.g. the EPC classified the building as `unknown` but you know it is a hotel).

---

## Authentication

All requests require the `x-blis-api-key` header. See the main Integration Guide for details.

---

## Request

```
PATCH /v1/profile/:siteId/floor-area
Content-Type: application/json
x-blis-api-key: <your-api-key>
```

### Path Parameter

| Parameter | Type   | Required | Description                                   |
|-----------|--------|----------|-----------------------------------------------|
| `siteId`  | string | Yes      | The site ID used when the site was registered |

### Request Body

| Field            | Type   | Required | Constraints           | Description                                                   |
|------------------|--------|----------|-----------------------|---------------------------------------------------------------|
| `floorAreaM2`    | number | Yes      | positive, max 500,000 | Corrected gross internal floor area in square metres          |
| `buildingType`   | string | No       | see enum below        | Override the building type classification at the same time    |
| `overrideSource` | string | Yes      | 1–200 characters      | Who or what provided this value (audit trail)                 |
| `notes`          | string | No       | max 500 characters    | Optional free-text note stored alongside the override         |

**Valid `buildingType` values:**

| Value                    | Description                     |
|--------------------------|---------------------------------|
| `hotel`                  | Full-service hotel              |
| `hotel_budget`           | Budget hotel                    |
| `housing_association`    | Housing association property    |
| `fleet_depot`            | Fleet depot / transport hub     |
| `warehouse_simple`       | Simple warehouse                |
| `car_park`               | Car park (no facilities)        |
| `car_park_with_facilities` | Car park with facilities      |
| `office_general`         | General office                  |
| `retail`                 | Retail unit                     |
| `pub_restaurant`         | Pub or restaurant               |
| `unknown`                | Unknown / not yet classified    |

### Minimal Example

```json
{
  "floorAreaM2": 3420,
  "overrideSource": "FM team site survey 2026-03-01"
}
```

### Full Example (with building type correction)

```json
{
  "floorAreaM2": 3420,
  "buildingType": "hotel",
  "overrideSource": "FM team site survey 2026-03-01",
  "notes": "EPC covered only ground floor retail unit (83 m²). Whole building is 3,420 m²."
}
```

---

## Response

**HTTP 200 OK** — returns the updated building profile.

```json
{
  "siteId": "gz-170159",
  "siteName": "Grand Zentral Hotel",
  "address": "1 Station Road",
  "postcode": "B2 4JB",
  "buildingType": "hotel",
  "buildingAge": "1970_1990",
  "floorAreaM2": 3420,
  "elexonProfileClass": 1,
  "cibseCategory": "hotel",
  "classifiedBy": "manual",
  "classifiedAt": "2026-03-25T10:00:00.000Z",
  "buildingTypeOverride": "hotel",
  "floorAreaOverride": 3420,
  "buildingAgeOverride": null,
  "phaseL1Factor": 0.38,
  "phaseL2Factor": 0.31,
  "phaseL3Factor": 0.31,
  "phaseFactorSource": "building_type_default",
  "confidenceLevel": "MANUAL_OVERRIDE",
  "annualKwhCentral": 1015740,
  "annualKwhP75": 1167601,
  "annualKwhLow": 761805,
  "annualKwhHigh": 1269675,
  "floorAreaConfidence": "MANUAL_OVERRIDE",
  "dataQualityFlag": null,
  "dataQualityNote": null,
  "floorAreaOverrideSource": "FM team site survey 2026-03-01",
  "floorAreaOverrideAt": "2026-03-25T10:00:00.000Z",
  "createdAt": "2026-03-24T09:00:00.000Z",
  "updatedAt": "2026-03-25T10:00:00.000Z",
  "currentEpc": { ... }
}
```

### Key Fields to Check After Override

| Field                  | What to Expect                                                                  |
|------------------------|---------------------------------------------------------------------------------|
| `floorAreaM2`          | Matches the value you supplied                                                  |
| `floorAreaConfidence`  | Always `MANUAL_OVERRIDE` after a successful override                            |
| `dataQualityFlag`      | `null` — the flag is cleared automatically when a manual override is applied    |
| `dataQualityNote`      | `null` — cleared alongside the flag                                             |
| `floorAreaOverrideSource` | Echoes your `overrideSource` value for audit purposes                        |
| `floorAreaOverrideAt`  | Server timestamp when the override was recorded                                 |
| `annualKwhCentral`     | Recalculated immediately using the new floor area                               |
| `confidenceLevel`      | `MANUAL_OVERRIDE` (set when `buildingType` is provided; otherwise unchanged)    |

---

## What Happens Internally

1. **Profile updated** — `floor_area_m2`, `floor_area_override`, `floor_area_override_m2`, `floor_area_confidence`, `floor_area_override_source`, and `floor_area_override_at` are written in a single UPDATE.

2. **Building type updated (if supplied)** — `building_type`, `building_type_override`, `elexon_profile_class`, phase factors, and `confidence_level` are all updated to match the new building type. Phase factors are set to the defaults for that building type.

3. **kWh recalculated** — `calculateAndStoreKwh` runs synchronously before the response is returned. The `annualKwh*` fields in the response already reflect the corrected floor area.

4. **Data quality flags cleared** — any existing `BELOW_MINIMUM_THRESHOLD` flag is removed because the operator has confirmed the floor area.

5. **Load estimate recalculated (background)** — `calculateEstimate` is triggered asynchronously after the response is sent. The next call to `GET /v1/estimate/:siteId` will use the corrected kWh values.

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

### 400 — Validation error

Returned when the request body fails schema validation.

```json
{
  "error": "VALIDATION_ERROR",
  "message": "floorAreaM2: Number must be positive",
  "statusCode": 400,
  "timestamp": "2026-03-25T10:00:00.000Z"
}
```

Common validation failures:

| Field            | Invalid value              | Reason                                   |
|------------------|---------------------------|------------------------------------------|
| `floorAreaM2`    | `0` or negative           | Must be a positive number                |
| `floorAreaM2`    | `> 500000`                | Exceeds maximum allowed area             |
| `overrideSource` | `""` or missing           | Required; minimum 1 character            |
| `overrideSource` | string > 200 characters   | Exceeds maximum length                   |
| `buildingType`   | unrecognised string        | Must be one of the valid enum values      |

---

## Data Quality Fields in the Estimate Response

After applying an override, the next `GET /v1/estimate/:siteId` response will include updated data quality fields in the `dataSource` block:

```json
{
  "siteId": "gz-170159",
  "estimatedAt": "2026-03-25T10:05:00.000Z",
  "buildingType": "hotel",
  "floorAreaM2": 3420,
  "annualKwhP75": 1167601,
  "currentEstimate": { ... },
  "dataSource": {
    "epcFetchedAt": "2026-03-24T09:00:00.000Z",
    "annualKwhSource": "MANUAL_OVERRIDE",
    "epcRating": "D",
    "floorAreaConfidence": "MANUAL_OVERRIDE",
    "dataQualityFlag": null,
    "dataQualityNote": null,
    "floorAreaOverrideSource": "FM team site survey 2026-03-01"
  }
}
```

`floorAreaConfidence: "MANUAL_OVERRIDE"` tells you the floor area was confirmed by a human operator and the estimate can be trusted.

---

## Typical Workflow

```
1.  GET  /v1/profile/:siteId
        → check dataQualityFlag == "BELOW_MINIMUM_THRESHOLD"

2.  Obtain correct floor area from FM team / planning docs / survey

3.  PATCH /v1/profile/:siteId/floor-area
        body: { floorAreaM2, buildingType, overrideSource }
        → 200 with updated profile
        → dataQualityFlag == null ✓
        → floorAreaConfidence == "MANUAL_OVERRIDE" ✓
        → annualKwhCentral reflects corrected area ✓

4.  GET  /v1/estimate/:siteId
        → fresh load estimate using corrected kWh
        → dataSource.floorAreaConfidence == "MANUAL_OVERRIDE" ✓
```
