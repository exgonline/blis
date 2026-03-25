import {
  buildCacheKey,
  calcHalfHourPeriod,
  calcTotalAnnualUsableChargingKwh,
  DEFAULT_GRID_KW,
  DEFAULT_SAFETY_MARGIN,
} from '../src/services/seasonal-profile.service';
import type { ProfileSeason, ProfileDayType, SeasonProfile } from '../src/types/index';

// ─── Cache key ────────────────────────────────────────────────────────────────

describe('buildCacheKey', () => {
  it('is deterministic for identical inputs', () => {
    const k1 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    const k2 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    expect(k1).toBe(k2);
  });

  it('produces different keys when grid connection differs', () => {
    const k1 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    const k2 = buildCacheKey('site-a', 200, 0.15, 50000, 1);
    expect(k1).not.toBe(k2);
  });

  it('produces different keys when safety margin differs', () => {
    const k1 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    const k2 = buildCacheKey('site-a', 100, 0.20, 50000, 1);
    expect(k1).not.toBe(k2);
  });

  it('produces different keys when annual kWh differs', () => {
    const k1 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    const k2 = buildCacheKey('site-a', 100, 0.15, 60000, 1);
    expect(k1).not.toBe(k2);
  });

  it('produces different keys for different sites with same parameters', () => {
    const k1 = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    const k2 = buildCacheKey('site-b', 100, 0.15, 50000, 1);
    expect(k1).not.toBe(k2);
  });

  it('returns a 32-character MD5 hex string', () => {
    const key = buildCacheKey('site-a', 100, 0.15, 50000, 1);
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });
});

// ─── calcHalfHourPeriod ───────────────────────────────────────────────────────

describe('calcHalfHourPeriod', () => {
  it('calculates all derived values correctly for known inputs', () => {
    // annualKwhP75=500000, coefficient=0.00001, safetyMargin=0.15, gridConnectionKw=200
    // estimatedBuildingKw = (500000 × 0.00001 / 0.5) × 1.15 = 10 × 1.15 = 11.5
    // availableChargingKw = max(0, 200 × 0.8 − 11.5) = max(0, 148.5) = 148.5
    // usableChargingKwh   = 148.5 × 0.5 × 0.92 = 68.31
    // flexibilityDispKw   = 148.5 × 0.65 = 96.525
    const coeffMap = new Map([['winter:weekday:0', 0.00001]]);
    const period = calcHalfHourPeriod(0, 'winter', 'weekday', 500000, 200, 0.15, coeffMap);

    expect(period.hhIndex).toBe(0);
    expect(period.timeStart).toBe('00:00');
    expect(period.elexonCoefficient).toBe(0.00001);
    expect(period.estimatedBuildingKw).toBe(11.5);
    expect(period.availableChargingKw).toBe(148.5);
    expect(period.usableChargingKwh).toBe(68.31);
    expect(period.flexibilityDispatchableKw).toBeCloseTo(96.525, 2);
  });

  it('floors availableChargingKw at 0 when building load exceeds grid headroom', () => {
    // estimatedBuildingKw will exceed 80% of grid
    // annualKwhP75=5000000, coefficient=0.0001, safetyMargin=0.15, gridConnectionKw=50
    // estimatedBuildingKw = (5000000 × 0.0001 / 0.5) × 1.15 = 1000 × 1.15 = 1150
    // availableChargingKw = max(0, 50 × 0.8 − 1150) = max(0, −1110) = 0
    const coeffMap = new Map([['winter:weekday:10', 0.0001]]);
    const period = calcHalfHourPeriod(10, 'winter', 'weekday', 5000000, 50, 0.15, coeffMap);

    expect(period.availableChargingKw).toBe(0);
    expect(period.usableChargingKwh).toBe(0);
    expect(period.flexibilityDispatchableKw).toBe(0);
  });

  it('throws ELEXON_MISSING when coefficient not in map', () => {
    const coeffMap = new Map<string, number>();
    expect(() =>
      calcHalfHourPeriod(0, 'winter', 'weekday', 100000, 100, 0.15, coeffMap),
    ).toThrow('Missing Elexon coefficient');
  });

  it('uses the default constants correctly', () => {
    // Verify defaults are exported and sensible
    expect(DEFAULT_GRID_KW).toBe(100);
    expect(DEFAULT_SAFETY_MARGIN).toBe(0.15);
  });
});

// ─── calcTotalAnnualUsableChargingKwh ─────────────────────────────────────────

describe('calcTotalAnnualUsableChargingKwh', () => {
  function buildUniformSeasons(usableKwh: number): Record<ProfileSeason, SeasonProfile> {
    const makePeriods = () =>
      Array.from({ length: 48 }, (_, i) => ({
        hhIndex: i,
        timeStart: '00:00',
        elexonCoefficient: 0,
        estimatedBuildingKw: 0,
        availableChargingKw: 0,
        usableChargingKwh: usableKwh,
        flexibilityDispatchableKw: 0,
      }));

    const dayTypeProfile = () => ({ halfHourlyProfile: makePeriods() });
    const seasonProfile = (): SeasonProfile => ({
      weekday: dayTypeProfile(),
      saturday: dayTypeProfile(),
      sunday: dayTypeProfile(),
    });

    return {
      winter: seasonProfile(),
      spring: seasonProfile(),
      summer: seasonProfile(),
      high_summer: seasonProfile(),
    };
  }

  it('computes correct total when all periods have the same usableChargingKwh', () => {
    // If every period has usableChargingKwh = 1:
    // daily total for any combination = 48 × 1 = 48
    // Total = Σ_seasons(seasonDays × Σ_daytypes(48 × dtDays/365))
    //       = Σ_seasons(seasonDays × 48 × (261+52+52)/365)
    //       = Σ_seasons(seasonDays × 48 × 365/365)
    //       = 48 × (151+61+92+61)
    //       = 48 × 365 = 17520
    const seasons = buildUniformSeasons(1);
    const total = calcTotalAnnualUsableChargingKwh(seasons);
    expect(total).toBeCloseTo(17520, 0);
  });

  it('returns 0 when all usableChargingKwh are 0', () => {
    const seasons = buildUniformSeasons(0);
    expect(calcTotalAnnualUsableChargingKwh(seasons)).toBe(0);
  });

  it('scales linearly with usableChargingKwh', () => {
    const t1 = calcTotalAnnualUsableChargingKwh(buildUniformSeasons(2));
    const t2 = calcTotalAnnualUsableChargingKwh(buildUniformSeasons(4));
    expect(t2).toBeCloseTo(t1 * 2, 1);
  });

  it('applies correct seasonal day weights (winter has the most days)', () => {
    // Build seasons where only winter has non-zero usable kWh
    const makeEmpty = (): SeasonProfile => ({
      weekday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 0, flexibilityDispatchableKw: 0 })) },
      saturday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 0, flexibilityDispatchableKw: 0 })) },
      sunday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 0, flexibilityDispatchableKw: 0 })) },
    });
    const makeWinter = (): SeasonProfile => ({
      weekday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 1, flexibilityDispatchableKw: 0 })) },
      saturday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 1, flexibilityDispatchableKw: 0 })) },
      sunday: { halfHourlyProfile: Array.from({ length: 48 }, (_, i) => ({ hhIndex: i, timeStart: '00:00', elexonCoefficient: 0, estimatedBuildingKw: 0, availableChargingKw: 0, usableChargingKwh: 1, flexibilityDispatchableKw: 0 })) },
    });

    const seasons: Record<ProfileSeason, SeasonProfile> = {
      winter: makeWinter(),
      spring: makeEmpty(),
      summer: makeEmpty(),
      high_summer: makeEmpty(),
    };

    // winter: 151 days × 48 periods × (261+52+52)/365 = 151 × 48 × 1 = 7248
    const total = calcTotalAnnualUsableChargingKwh(seasons);
    expect(total).toBeCloseTo(7248, 0);
  });
});
