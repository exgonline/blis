# EPC Discovery Flow

A two-step flow for registering a site using the EPC Non-domestic register.

---

## Overview

```
1. Search by postcode   GET  /v1/epc/search?postcode=...
        ↓
   User selects a building from the results
        ↓
2. Register from EPC    POST /v1/epc/register
        ↓
   kWh estimates returned for local storage
   Site is live in BLIS for load estimates
```

---

## Step 1 — Search by Postcode

### Request

```
GET /v1/epc/search?postcode=SW1A+2AA
x-blis-api-key: <your-api-key>
```

### Response

```json
{
  "postcode": "SW1A 2AA",
  "count": 2,
  "results": [
    {
      "buildingReference": "10000012345",
      "uprn": "100023336956",
      "address": "1 Station Road, London",
      "postcode": "SW1A 2AA",
      "floorAreaM2": 3420,
      "propertyType": "Hotel",
      "mainActivity": "Hotel",
      "suggestedBuildingType": "hotel",
      "energyRating": "C",
      "assetRating": 68,
      "lodgementDate": "2021-06-15"
    },
    {
      "buildingReference": "10000012346",
      "uprn": null,
      "address": "2 Station Road, London",
      "postcode": "SW1A 2AA",
      "floorAreaM2": 850,
      "propertyType": "Office",
      "mainActivity": "Office",
      "suggestedBuildingType": "office_general",
      "energyRating": "B",
      "assetRating": 42,
      "lodgementDate": "2022-03-01"
    }
  ]
}
```

The user selects their building and takes the `buildingReference` forward to Step 2.

---

## Step 2 — Register from EPC

### Request

```
POST /v1/epc/register
x-blis-api-key: <your-api-key>
Content-Type: application/json
```

```json
{
  "siteId": "site-hotel-001",
  "buildingReference": "10000012345",
  "siteName": "The Grand Hotel",
  "buildingAgeOverride": "1990_2005"
}
```

| Field                 | Required | Notes                                                  |
|-----------------------|----------|--------------------------------------------------------|
| `siteId`              | Yes      | Your unique identifier for this site                   |
| `buildingReference`   | Yes      | Taken from the search results above                    |
| `siteName`            | No       | Display name for the site                              |
| `buildingAgeOverride` | No       | Improves kWh accuracy — see age band values below      |

**Age band values:** `pre_1970` · `1970_1990` · `1990_2005` · `post_2005` · `unknown`

### Response

```json
{
  "siteId": "site-hotel-001",
  "registeredAt": "2026-03-24T12:00:00.000Z",
  "buildingReference": "10000012345",
  "address": "1 Station Road, London",
  "postcode": "SW1A 2AA",
  "buildingType": "hotel",
  "floorAreaM2": 3420,
  "energyRating": "C",
  "annualKwh": {
    "central": 957600.00,
    "p75": 1101240.00,
    "low": 667800.00,
    "high": 1244880.00
  },
  "benchmark": {
    "typicalKwhPerM2": 280,
    "goodPracticeKwhPerM2": 195,
    "ageMultiplier": 1.0
  }
}
```

| Field              | Description                                                              |
|--------------------|--------------------------------------------------------------------------|
| `annualKwh.central`| Best estimate — `floorAreaM2 × typicalKwhPerM2 × ageMultiplier`         |
| `annualKwh.p75`    | 75th percentile — `central × 1.15` — used for load estimates            |
| `annualKwh.low`    | Best-practice lower bound — uses `goodPracticeKwhPerM2`                  |
| `annualKwh.high`   | Conservative upper bound — `central × 1.30`                             |

`annualKwh` and `benchmark` are `null` if the EPC certificate has no floor area.

---

## After Registration

The site is immediately available for load estimates:

```
GET /v1/estimate/site-hotel-001
x-blis-api-key: <your-api-key>
```

```json
{
  "siteId": "site-hotel-001",
  "estimatedAt": "2026-03-24T12:00:00.000Z",
  "buildingType": "hotel",
  "floorAreaM2": 3420,
  "annualKwhP75": 1101240.00,
  "currentEstimate": {
    "estimatedKw": 28.4,
    "estimatedAmpsTotal": 43.2,
    "estimatedAmpsL1": 15.5,
    "estimatedAmpsL2": 13.8,
    "estimatedAmpsL3": 13.9,
    "hhIndex": 24,
    "elexonSeason": "spring",
    "dayType": "weekday",
    "elexonCoefficient": 0.00002184,
    "confidenceLevel": "EPC_DERIVED",
    "safetyMarginApplied": 0.15
  },
  "dataSource": {
    "epcFetchedAt": "2026-03-24T12:00:00.000Z",
    "annualKwhSource": "EPC_DERIVED",
    "epcRating": "C"
  }
}
```

---

## Error Responses

### Step 1 — Search

| Scenario                  | Status | `error`            | `message`                            |
|---------------------------|--------|--------------------|--------------------------------------|
| `postcode` missing        | 400    | `VALIDATION_ERROR` | Query parameter "postcode" is required |
| `postcode` invalid format | 400    | `VALIDATION_ERROR` | Invalid UK postcode format           |
| No certificates found     | 200    | —                  | Empty `results` array, `count: 0`    |

### Step 2 — Register

| Scenario                      | Status | `error`            | `message`                                                        |
|-------------------------------|--------|--------------------|------------------------------------------------------------------|
| Missing or invalid field      | 400    | `VALIDATION_ERROR` | Validation failed: \<field\>: \<reason\>                         |
| Building reference not in EPC | 404    | `NOT_FOUND`        | No EPC certificate found for building reference \<ref\>          |
| `siteId` already registered   | 409    | `CONFLICT`         | Site \<siteId\> already exists                                   |

All error responses follow the same envelope:

```json
{
  "error": "NOT_FOUND",
  "message": "No EPC certificate found for building reference 10000012345",
  "statusCode": 404,
  "timestamp": "2026-03-24T12:00:00.000Z"
}
```
