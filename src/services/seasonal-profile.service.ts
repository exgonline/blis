import crypto from 'crypto';
import { pool } from '../db/client';
import { logger } from '../utils/logger';
import { periodIndexToHhmm } from '../utils/season';
import type {
  BuildingProfileRow,
  ProfileSeason,
  ProfileDayType,
  SeasonalHalfHourPeriod,
  SeasonalDayTypeProfile,
  SeasonProfile,
  ChargingWindow,
  SeasonalProfileSummary,
  SeasonalProfileResponse,
} from '../types/index';

// ─── Constants ────────────────────────────────────────────────────────────────

const PROFILE_SEASONS: readonly ProfileSeason[] = ['winter', 'spring', 'summer', 'high_summer'];
const DAY_TYPES: readonly ProfileDayType[] = ['weekday', 'saturday', 'sunday'];

export const DEFAULT_GRID_KW = 100;
export const DEFAULT_SAFETY_MARGIN = 0.15;

const G100_RULE = 0.8;          // 80% of grid connection available for site use
const AC_EFFICIENCY = 0.92;     // AC charging efficiency
const FLEXIBILITY_FRACTION = 0.65; // 65% of available assumed dispatchable
const CHARGING_WINDOW_PERIODS = 4; // minimum window = 4 × 30 min = 2 hours

// Approximate seasonal day counts (sum = 365)
const SEASON_DAYS: Record<ProfileSeason, number> = {
  winter: 151,
  spring: 61,
  summer: 92,
  high_summer: 61,
};

// Annual day-type frequency
const DAY_TYPE_DAYS: Record<ProfileDayType, number> = {
  weekday: 261,
  saturday: 52,
  sunday: 52,
};

// Winter weekday peak: 16:00–20:00 = hhIndex 32–39 (inclusive)
const PEAK_HH_START = 32;
const PEAK_HH_END = 39;

// ─── Types ────────────────────────────────────────────────────────────────────

type CoeffMap = Map<string, number>; // key: `${season}:${dayType}:${hhIndex}`

interface CacheRow {
  profile_json: SeasonalProfileResponse;
  calculated_at: Date;
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ─── Cache key ────────────────────────────────────────────────────────────────

export function buildCacheKey(
  siteId: string,
  gridConnectionKw: number,
  safetyMargin: number,
  annualKwhP75: number,
  profileClass: number,
): string {
  const input = `${siteId}:${gridConnectionKw}:${safetyMargin}:${annualKwhP75}:${profileClass}`;
  return crypto.createHash('md5').update(input).digest('hex');
}

// ─── Elexon data loading ──────────────────────────────────────────────────────

async function loadCoefficients(profileClass: number): Promise<CoeffMap> {
  const result = await pool.query<{
    season: string;
    day_type: string;
    period_index: number;
    coefficient: string;
  }>(
    `SELECT season, day_type, period_index, coefficient
     FROM elexon_profiles
     WHERE profile_class = $1
       AND season IN ('winter', 'spring', 'summer', 'high_summer')
     ORDER BY season, day_type, period_index`,
    [profileClass],
  );

  if (result.rows.length === 0) {
    throw Object.assign(
      new Error(`No Elexon profile data found for profile class ${profileClass}`),
      { code: 'ELEXON_MISSING', profileClass },
    );
  }

  const map: CoeffMap = new Map();
  for (const row of result.rows) {
    map.set(`${row.season}:${row.day_type}:${row.period_index}`, parseFloat(row.coefficient));
  }
  return map;
}

// ─── Per-period calculation ───────────────────────────────────────────────────

export function calcHalfHourPeriod(
  hhIndex: number,
  season: string,
  dayType: string,
  annualKwhP75: number,
  gridConnectionKw: number,
  safetyMargin: number,
  coeffMap: CoeffMap,
): SeasonalHalfHourPeriod {
  const key = `${season}:${dayType}:${hhIndex}`;
  const coefficient = coeffMap.get(key);

  if (coefficient === undefined) {
    throw Object.assign(
      new Error(`Missing Elexon coefficient for ${key}`),
      { code: 'ELEXON_MISSING' },
    );
  }

  // estimated_building_kw: annual_kwh × coefficient / 0.5h × (1 + safety_margin)
  const estimatedBuildingKw = (annualKwhP75 * coefficient / 0.5) * (1 + safetyMargin);

  // available_charging_kw: G100 80% rule minus building load, floored at 0
  const availableChargingKw = Math.max(0, gridConnectionKw * G100_RULE - estimatedBuildingKw);

  // usable_charging_kwh: available kW × 0.5h period × AC efficiency
  const usableChargingKwh = availableChargingKw * 0.5 * AC_EFFICIENCY;

  // flexibility_dispatchable_kw: fraction of available assumed controllable
  const flexibilityDispatchableKw = availableChargingKw * FLEXIBILITY_FRACTION;

  return {
    hhIndex,
    timeStart: periodIndexToHhmm(hhIndex),
    elexonCoefficient: coefficient,
    estimatedBuildingKw: round3(estimatedBuildingKw),
    availableChargingKw: round3(availableChargingKw),
    usableChargingKwh: round3(usableChargingKwh),
    flexibilityDispatchableKw: round3(flexibilityDispatchableKw),
  };
}

// ─── Season/daytype builders ──────────────────────────────────────────────────

function buildDayTypeProfile(
  season: ProfileSeason,
  dayType: ProfileDayType,
  annualKwhP75: number,
  gridConnectionKw: number,
  safetyMargin: number,
  coeffMap: CoeffMap,
): SeasonalDayTypeProfile {
  const halfHourlyProfile: SeasonalHalfHourPeriod[] = [];
  for (let hhIndex = 0; hhIndex < 48; hhIndex++) {
    halfHourlyProfile.push(
      calcHalfHourPeriod(hhIndex, season, dayType, annualKwhP75, gridConnectionKw, safetyMargin, coeffMap),
    );
  }
  return { halfHourlyProfile };
}

function buildAllSeasons(
  annualKwhP75: number,
  gridConnectionKw: number,
  safetyMargin: number,
  coeffMap: CoeffMap,
): Record<ProfileSeason, SeasonProfile> {
  const result = {} as Record<ProfileSeason, SeasonProfile>;
  for (const season of PROFILE_SEASONS) {
    result[season] = {
      weekday: buildDayTypeProfile(season, 'weekday', annualKwhP75, gridConnectionKw, safetyMargin, coeffMap),
      saturday: buildDayTypeProfile(season, 'saturday', annualKwhP75, gridConnectionKw, safetyMargin, coeffMap),
      sunday: buildDayTypeProfile(season, 'sunday', annualKwhP75, gridConnectionKw, safetyMargin, coeffMap),
    };
  }
  return result;
}

// ─── Summary calculations ─────────────────────────────────────────────────────

function findChargingWindow(meanAvailableKw: number[], findHighest: boolean): ChargingWindow {
  let bestStart = 0;
  let bestAvg = findHighest ? -Infinity : Infinity;

  for (let start = 0; start <= 48 - CHARGING_WINDOW_PERIODS; start++) {
    let sum = 0;
    for (let i = start; i < start + CHARGING_WINDOW_PERIODS; i++) {
      sum += meanAvailableKw[i] ?? 0;
    }
    const avg = sum / CHARGING_WINDOW_PERIODS;
    if (findHighest ? avg > bestAvg : avg < bestAvg) {
      bestAvg = avg;
      bestStart = start;
    }
  }

  const endPeriod = bestStart + CHARGING_WINDOW_PERIODS;
  return {
    startHhIndex: bestStart,
    endHhIndex: bestStart + CHARGING_WINDOW_PERIODS - 1,
    startTime: periodIndexToHhmm(bestStart),
    endTime: endPeriod >= 48 ? '00:00' : periodIndexToHhmm(endPeriod),
    averageAvailableChargingKw: round3(bestAvg < 0 ? 0 : bestAvg),
  };
}

export function calcTotalAnnualUsableChargingKwh(
  seasons: Record<ProfileSeason, SeasonProfile>,
): number {
  let total = 0;
  for (const season of PROFILE_SEASONS) {
    const seasonDays = SEASON_DAYS[season];
    for (const dayType of DAY_TYPES) {
      const dtDays = DAY_TYPE_DAYS[dayType];
      const dailyUsable = seasons[season][dayType].halfHourlyProfile.reduce(
        (sum, p) => sum + p.usableChargingKwh,
        0,
      );
      total += dailyUsable * seasonDays * (dtDays / 365);
    }
  }
  return round3(total);
}

function buildSummary(seasons: Record<ProfileSeason, SeasonProfile>): SeasonalProfileSummary {
  // Compute mean available_charging_kw per hhIndex across all 12 season/dayType combos
  const meanAvailableKw = new Array<number>(48).fill(0);
  const comboCount = PROFILE_SEASONS.length * DAY_TYPES.length; // 12

  for (const season of PROFILE_SEASONS) {
    for (const dayType of DAY_TYPES) {
      for (const period of seasons[season][dayType].halfHourlyProfile) {
        meanAvailableKw[period.hhIndex] =
          (meanAvailableKw[period.hhIndex] ?? 0) + period.availableChargingKw;
      }
    }
  }
  for (let i = 0; i < 48; i++) {
    meanAvailableKw[i] = (meanAvailableKw[i] ?? 0) / comboCount;
  }

  const bestChargingWindow = findChargingWindow(meanAvailableKw, true);
  const worstChargingWindow = findChargingWindow(meanAvailableKw, false);

  const totalAnnualUsableChargingKwh = calcTotalAnnualUsableChargingKwh(seasons);
  const averageDailyUsableChargingKwh = round3(totalAnnualUsableChargingKwh / 365);

  // flexibility_asset_mw: average flex_dispatchable_kw during winter weekday peak / 1000
  const peakPeriods = seasons.winter.weekday.halfHourlyProfile.filter(
    (p) => p.hhIndex >= PEAK_HH_START && p.hhIndex <= PEAK_HH_END,
  );
  const avgFlexKw =
    peakPeriods.reduce((sum, p) => sum + p.flexibilityDispatchableKw, 0) / peakPeriods.length;
  const flexibilityAssetMw = round3(avgFlexKw / 1000);

  return {
    bestChargingWindow,
    worstChargingWindow,
    totalAnnualUsableChargingKwh,
    averageDailyUsableChargingKwh,
    flexibilityAssetMw,
  };
}

// ─── Cache operations ─────────────────────────────────────────────────────────

async function checkCache(siteId: string, cacheKey: string): Promise<CacheRow | null> {
  const result = await pool.query<CacheRow>(
    `SELECT profile_json, calculated_at
     FROM seasonal_profile_cache
     WHERE site_id = $1
       AND cache_key = $2
       AND calculated_at > NOW() - INTERVAL '24 hours'`,
    [siteId, cacheKey],
  );
  return result.rows[0] ?? null;
}

async function upsertCache(
  siteId: string,
  cacheKey: string,
  profile: SeasonalProfileResponse,
  gridConnectionKw: number,
  safetyMargin: number,
  annualKwhP75: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO seasonal_profile_cache
       (site_id, cache_key, profile_json, grid_connection_kw, safety_margin, annual_kwh_p75)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (site_id, cache_key) DO UPDATE
       SET profile_json    = EXCLUDED.profile_json,
           calculated_at   = NOW()`,
    [siteId, cacheKey, JSON.stringify(profile), gridConnectionKw, safetyMargin, annualKwhP75],
  );
}

export async function invalidateSeasonalCache(siteId: string): Promise<void> {
  await pool.query('DELETE FROM seasonal_profile_cache WHERE site_id = $1', [siteId]);
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function getSeasonalProfile(
  siteId: string,
  gridConnectionKwOverride?: number,
  safetyMarginOverride?: number,
): Promise<SeasonalProfileResponse> {
  const startMs = Date.now();

  // Load building profile
  const profileResult = await pool.query<BuildingProfileRow>(
    'SELECT * FROM building_profiles WHERE site_id = $1',
    [siteId],
  );

  if (profileResult.rows.length === 0) {
    throw Object.assign(new Error(`Site ${siteId} not found`), { code: 'NOT_FOUND' });
  }

  const row = profileResult.rows[0]!;

  if (!row.annual_kwh_p75) {
    throw Object.assign(
      new Error(`annual_kwh_p75 not available for site ${siteId} — run EPC fetch first`),
      { code: 'UNPROCESSABLE' },
    );
  }

  const annualKwhP75 = parseFloat(row.annual_kwh_p75);
  const gridConnectionKw =
    gridConnectionKwOverride ??
    (row.grid_connection_kw ? parseFloat(row.grid_connection_kw) : DEFAULT_GRID_KW);
  const safetyMargin = safetyMarginOverride ?? DEFAULT_SAFETY_MARGIN;
  const profileClass = row.elexon_profile_class;

  // Check cache
  const cacheKey = buildCacheKey(siteId, gridConnectionKw, safetyMargin, annualKwhP75, profileClass);
  const cached = await checkCache(siteId, cacheKey);
  if (cached) {
    return {
      ...cached.profile_json,
      cachedAt: cached.calculated_at.toISOString(),
      generatedInMs: Date.now() - startMs,
    };
  }

  // Load Elexon coefficients (single bulk query)
  const coeffMap = await loadCoefficients(profileClass);

  // Build full seasonal profile
  const seasons = buildAllSeasons(annualKwhP75, gridConnectionKw, safetyMargin, coeffMap);
  const summary = buildSummary(seasons);

  const response: SeasonalProfileResponse = {
    siteId,
    cachedAt: null,
    generatedInMs: Date.now() - startMs,
    gridConnectionKw,
    safetyMargin,
    annualKwhP75,
    seasons,
    summary,
  };

  // Upsert cache asynchronously — do not delay the response
  upsertCache(siteId, cacheKey, response, gridConnectionKw, safetyMargin, annualKwhP75).catch(
    (err: unknown) => {
      logger.warn('Failed to upsert seasonal profile cache', {
        siteId,
        error: err instanceof Error ? err.message : String(err),
      });
    },
  );

  return response;
}
