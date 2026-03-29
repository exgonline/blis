# BLIS — Building Load Intelligence Service
## Application Overview

BLIS is a Node.js/TypeScript REST API that calculates and forecasts electrical power demand for commercial buildings in the UK. It serves as a critical infrastructure planning tool for demand flexibility, EV charging capacity planning, and grid connection sizing.

---

## Table of Contents

1. [Purpose & Domain](#purpose--domain)
2. [Tech Stack](#tech-stack)
3. [API Endpoints](#api-endpoints)
4. [Data Models](#data-models)
5. [Services](#services)
6. [Background Jobs](#background-jobs)
7. [Architecture](#architecture)
8. [Configuration](#configuration)
9. [Testing](#testing)
10. [Directory Structure](#directory-structure)

---

## Purpose & Domain

BLIS profiles commercial buildings to estimate their electrical load at any point in time. Given a building's floor area, type, age, and EPC data, it can:

- Estimate current power demand (kW and amps) across three phases (L1, L2, L3)
- Forecast the next 48 half-hourly periods of demand
- Generate full seasonal charging availability profiles for EV infrastructure planning
- Integrate with the UK EPC (Energy Performance Certificate) register to auto-populate building data
- Surface Elexon half-hourly load profiles and CIBSE energy benchmarks for regulated calculations

**Primary use case:** A grid operator or EV charge point aggregator registers a commercial site by postcode or EPC reference and immediately receives calibrated load estimates they can use to size grid connections, manage demand flexibility, and schedule EV charging windows.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.3 |
| Runtime | Node.js (ES2020) |
| Web Framework | Express 4.18 |
| Database | PostgreSQL (pg 8.11, raw SQL, no ORM) |
| Validation | Zod 3.22 |
| HTTP Client | Axios |
| Scheduling | node-cron 3.0 |
| Logging | Winston 3.11 |
| Testing | Jest 29.7 + ts-jest + Supertest |
| External APIs | UK EPC API (OpenDataCommunities) |

---

## API Endpoints

### Authentication

All endpoints except `GET /v1/health` require an `x-blis-api-key` header. Keys are validated via SHA-256 hash comparison against the `api_keys` table.

---

### Health

| Method | Path | Description |
|---|---|---|
| GET | `/v1/health` | Service health check; returns DB status and version |

---

### Profile Management — `/v1/profile`

| Method | Path | Description |
|---|---|---|
| GET | `/v1/profile` | List all registered sites, optionally filtered by `?postcode=` |
| POST | `/v1/profile` | Register a new site (address, postcode, optional overrides) |
| GET | `/v1/profile/:siteId` | Retrieve full building profile for a site |
| GET | `/v1/profile/:siteId/epc` | Get the current EPC certificate record |
| PATCH | `/v1/profile/:siteId/floor-area` | Apply a manual floor area override and trigger recalculation |
| PATCH | `/v1/profile/:siteId/grid-connection` | Store grid connection capacity (kW) |
| POST | `/v1/profile/:siteId/refresh-epc` | Queue an asynchronous EPC certificate refresh |

**Site registration body:**
```json
{
  "siteId": "site_001",
  "address": "123 High Street",
  "postcode": "SW1A 1AA",
  "siteName": "Optional display name",
  "uprn": "10091824578",
  "buildingType": "office_general",
  "buildingAge": "1990_2005",
  "floorAreaM2": 1500
}
```

---

### Load Estimation — `/v1/estimate`

| Method | Path | Description |
|---|---|---|
| GET | `/v1/estimate/:siteId` | Current power load estimate (kW, amps). Optional `?at=ISO8601` for a specific time |
| GET | `/v1/estimate/:siteId/forecast` | 48 half-hour period forecast from now |
| GET | `/v1/estimate/:siteId/seasonal-profile` | Full seasonal charging availability profile |

**Seasonal profile query params:**
- `gridConnectionKw` — grid connection capacity override (kW)
- `safetyMargin` — fractional safety margin (e.g., `0.15` for 15%)

**Estimate response fields:**
- `estimatedKw`, `estimatedAmpsTotal`
- `estimatedAmpsL1`, `estimatedAmpsL2`, `estimatedAmpsL3`
- `confidenceLevel` (`STATISTICAL` | `EPC_DERIVED` | `MANUAL_OVERRIDE`)
- `hhIndex` (0–47), `season`, `dayType`
- `elexonCoefficient`, `safetyMarginApplied`
- Data source attribution (EPC rating, floor area source, quality flags)

---

### Reference Data

| Method | Path | Description |
|---|---|---|
| GET | `/v1/cibse/benchmark` | Energy benchmark for a building category (`?category=office_general`) |
| GET | `/v1/cibse/benchmarks` | List all CIBSE benchmarks |
| GET | `/v1/elexon/coefficient` | Single half-hourly load coefficient (`?profileClass=3&season=winter&dayType=weekday&period=16`) |
| GET | `/v1/elexon/profile` | Full 48-period Elexon profile for a class/season/day type combination |

---

### EPC Discovery — `/v1/epc`

| Method | Path | Description |
|---|---|---|
| GET | `/v1/epc/search` | Search for EPC certificates by UK postcode (`?postcode=SW1A1AA`) |
| POST | `/v1/epc/register` | Register a new site from an EPC building reference |

---

## Data Models

### `building_profiles`
The central site record. Key columns:

| Column | Type | Description |
|---|---|---|
| site_id | text PK | Client-provided identifier |
| address, postcode | text | Site location |
| uprn | text | Unique Property Reference Number |
| building_type | enum | e.g., `office_general`, `hotel`, `retail` |
| building_age | enum | e.g., `pre_1970`, `post_2005` |
| floor_area_m2 | numeric | Base floor area |
| floor_area_override_m2 | numeric | Manual override (takes precedence) |
| elexon_profile_class | int | 1 (hotel/housing) or 3 (commercial) |
| cibse_category | text | Maps to CIBSE benchmark |
| annual_kwh_central/p75/low/high | numeric | EPC-derived or calculated annual energy |
| epc_rating | text | A–G EPC asset rating |
| grid_connection_kw | numeric | Site grid connection capacity |
| data_quality_flags | jsonb | Anomaly flags from data quality checks |

### `epc_records`
Cached EPC API responses: building reference, UPRN, floor area, main activity, asset rating, raw JSON payload, fetch status.

### `elexon_profiles`
48 half-hourly coefficients per combination of profile class (1–8), season (5 types), and day type (weekday/sat/sun). Loaded from seed data at startup.

### `cibse_benchmarks`
Typical and good-practice kWh/m² values per building category. Loaded from seed data at startup.

### `building_load_estimates`
Persisted estimate records: site ID, timestamp, valid window, kW (central & p75), total amps, phase amps (L1/L2/L3), season, day type, confidence level.

### `api_keys`
SHA-256 hashed API keys with app name, creation timestamp, last used timestamp, and active flag.

### `age_multipliers`
Age band → adjustment multiplier (e.g., pre-1970 buildings use more energy per m²).

---

### Enums

```typescript
BuildingType:
  hotel | hotel_budget | housing_association | fleet_depot | warehouse_simple |
  car_park | car_park_with_facilities | office_general | retail | pub_restaurant | unknown

BuildingAge: pre_1970 | 1970_1990 | 1990_2005 | post_2005 | unknown

ElexonSeason: winter | spring | summer | high_summer | autumn

DayType: weekday | saturday | sunday

ConfidenceLevel: STATISTICAL | EPC_DERIVED | MANUAL_OVERRIDE

FetchStatus: success | not_found | rate_limited | error
```

---

## Services

### BuildingLoadService
The core calculation engine. For a given site and timestamp:

1. Fetches the building profile
2. Resolves effective floor area (override takes priority)
3. Determines annual kWh from EPC data or calculates it from CIBSE benchmark × age multiplier
4. Applies P75 multiplier (1.15) and safety margin (+15%)
5. Looks up the Elexon load coefficient for the current season/day type/half-hour period
6. Converts annual kWh → half-hour kW: `annualKwh × coefficient / 2`
7. Converts kW → three-phase amps: `kW × 1000 / (√3 × 400V × 0.95PF)`
8. Distributes amps across L1/L2/L3 using stored phase factors
9. Persists the result

Also provides **`getForecast`** (48 periods from now) and **`getStoredEstimate`** (cached result lookup).

### BuildingProfileService
CRUD for building profiles. Handles:
- Site registration (triggers async EPC fetch on creation)
- Floor area overrides (triggers estimate recalculation)
- Grid connection updates
- EPC refresh queuing
- Building type → Elexon profile class mapping

### SeasonalProfileService
Generates a full seasonal availability matrix: 4 seasons × 3 day types × 48 half-hourly periods. For each slot:
- Building load (kW)
- Available charging capacity = grid connection − building load − safety margin
- AC charging efficiency (92%)
- Flexibility dispatchable (65% of available)
- Best/worst consecutive charging windows (≥ 2 hours = 4 consecutive periods)
- Total annual usable charging kWh

Results are cached using an MD5 hash of `(siteId, gridConnectionKw, safetyMargin, annualKwhP75, profileClass)`.

### EpcDiscoveryService
Wraps the UK EPC API (OpenDataCommunities):
- Search certificates by postcode
- Full site registration from a building reference number (maps EPC main activity → building type, calculates initial annual kWh)
- Respects configurable rate limits (delay between requests, retry with backoff)

### CibseService
Lookup table for CIBSE TM46 energy benchmarks: typical and good-practice kWh/m² per building category. Falls back to `unknown` category if no match.

### ElexonService
Lookup service for Elexon UNC settlement period load profiles. Returns single coefficients or full 48-period arrays by profile class, season, and day type.

### DataQualityService
Runs checks against a site's profile and flags anomalies (e.g., EPC floor area mismatch, stale EPC data, missing classifications). Flags are stored as JSONB on the profile record.

---

## Background Jobs

### Precalculate Estimates (every 30 minutes)
- Runs at `:00` and `:30`
- Fetches all sites with sufficient data for calculation
- Processes in batches of `BLIS_BATCH_SIZE` (default: 20) using `Promise.allSettled`
- Pre-warms the estimates cache so live API calls return instantly
- Logs per-batch success/failure counts and total duration

### Refresh EPC (Sundays 02:00 UTC)
- Finds all sites flagged for EPC refresh
- Calls the EPC API for each, respecting the configured rate limit delay
- Updates floor area, building type, asset rating
- Purpose: keep EPC data fresh; detect building reclassifications

---

## Architecture

### Request Flow

```
Request
  └─ Auth Middleware (SHA-256 key check)
       └─ Route Handler (Zod validation)
            └─ Service Layer (business logic)
                 ├─ DB Layer (parameterised SQL queries)
                 └─ External APIs (EPC, Elexon seed data)
```

### Key Design Decisions

**No ORM** — Direct `pg` queries with `$1/$2` parameters throughout. Keeps SQL explicit and avoids abstraction overhead for a data-heavy service.

**Layered confidence levels** — `STATISTICAL` (benchmark only), `EPC_DERIVED` (floor area from EPC), `MANUAL_OVERRIDE` (operator-supplied data). Consumers know exactly how accurate an estimate is.

**Elexon UNC calendar** — Seasons follow the Elexon settlement calendar, not calendar seasons, to ensure regulatory compliance. Season boundaries are calculated in `utils/season.ts`.

**Precalculation cache** — Estimates are written to `building_load_estimates` every 30 minutes. The live `/estimate` endpoint reads from this cache if a valid record exists, keeping response times low.

**Fire-and-forget pattern** — Non-critical updates (e.g., `last_used_at` on API keys, async EPC fetches) use unhandled Promises to avoid blocking request handlers.

**Phase distribution** — Each building type has stored L1/L2/L3 phase factors to model real-world asymmetric loading, not just equal splits.

### Bootstrap Sequence

```
1. Test DB connection (with retries)
2. Run SQL migrations (idempotent)
3. Load CIBSE benchmarks + Elexon profiles into DB
4. Seed master API key from env var (if set, first boot)
5. Start Express server
6. Register cron jobs
```

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP listen port |
| `NODE_ENV` | — | `development` or `production` |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `DATABASE_URL` | — | Full connection string (Render/managed DBs) |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSL` | — | Individual PG config (alternative to DATABASE_URL) |
| `EPC_API_EMAIL` | — | **Required.** EPC API auth email |
| `EPC_API_KEY` | — | **Required.** EPC API auth key |
| `EPC_API_BASE_URL` | OpenDataCommunities endpoint | Override for testing |
| `BLIS_MASTER_API_KEY` | — | Auto-seeded API key on first boot (set as env var, never in .env) |
| `BLIS_BATCH_SIZE` | `20` | Precalculate job batch size |
| `BLIS_EPC_REQUEST_DELAY_MS` | `200` | Rate limit delay between EPC API calls |
| `BLIS_EPC_TIMEOUT_MS` | `10000` | EPC API request timeout |
| `BLIS_DB_POOL_MIN` | `2` | DB connection pool minimum |
| `BLIS_DB_POOL_MAX` | `10` | DB connection pool maximum |
| `BLIS_DB_RETRY_COUNT` | `3` | DB bootstrap retry attempts |

---

## Testing

Tests live in `/tests` and use Jest + ts-jest + Supertest.

### Test Suites

**Unit tests:**
- `building-load.service.test.ts` — Core kW/amp calculation logic
- `elexon.service.test.ts` — Coefficient lookups
- `epc.collector.test.ts` — EPC API integration
- `phase.test.ts` — Three-phase distribution math
- `season.test.ts` — Elexon season boundary calculations

**Service tests:**
- `building-profile.service.test.ts` — Profile CRUD, building type mappings
- `data-quality.service.test.ts` — Anomaly flag generation
- `floor-area-override.test.ts` — Override audit trail
- `seasonal-profile.service.test.ts` — Seasonal profile generation, charging windows

**API integration tests:**
- `api/health.routes.test.ts`
- `api/profile.routes.test.ts`
- `api/estimate.routes.test.ts`
- `api/seasonal-profile.routes.test.ts`

Run all tests: `npm test`

---

## Directory Structure

```
blis/
├── src/
│   ├── index.ts                    # Bootstrap and app startup
│   ├── api/
│   │   ├── router.ts              # Main Express router
│   │   ├── middleware/            # Auth, validation, error handling
│   │   └── routes/                # One file per resource group
│   ├── services/                  # All business logic
│   ├── collectors/                # EPC API client + data loaders
│   ├── db/                        # DB client, migrations runner
│   ├── config/                    # Environment config parsing
│   ├── types/                     # Shared TypeScript interfaces and enums
│   ├── utils/                     # Logger, season math, phase distribution
│   └── jobs/                      # Cron job implementations
├── migrations/                    # SQL schema migration files (7 migrations)
├── tests/                         # Jest test suites
├── package.json
└── tsconfig.json
```

---

## Physics Constants

| Constant | Value | Notes |
|---|---|---|
| Power factor | 0.95 | Typical UK commercial buildings |
| Line voltage | 400V | Three-phase line-to-line |
| P75 multiplier | 1.15 | 75th percentile demand estimate |
| Safety margin | +15% | Applied across all confidence levels |
| AC charging efficiency | 92% | EV charge point assumption |
| Flexibility dispatchable | 65% | Fraction of available capacity for flex dispatch |
| G100 threshold | 80% | Maximum site load as fraction of grid connection |

**kW to three-phase amps:**
```
Amps = (kW × 1000) / (√3 × 400V × 0.95)
```
