import { pool } from '../db/client';
import { logger } from '../utils/logger';
import { elexonService } from './elexon.service';
import { cibseService } from './cibse.service';
import { getSeason, getDayType, getHalfHourPeriod } from '../utils/season';
import { getPhaseFactors, distributePhaseAmps } from '../utils/phase';
import { ConfidenceLevel } from '../types/index';
import type { BuildingLoadEstimate, BuildingProfileRow } from '../types/index';

// Safety margin multipliers by confidence level.
// The margin above 1.0 is stored as safetyMarginApplied (e.g. 1.15 → 0.15).
const SAFETY_MARGINS: Record<string, number> = {
  [ConfidenceLevel.Statistical]: 1.15,
  [ConfidenceLevel.EpcDerived]: 1.15,
  [ConfidenceLevel.ManualOverride]: 1.15,
};

// ─── Physical Constants ────────────────────────────────────────────────────────

export const POWER_FACTOR = 0.95;
export const VOLTAGE_LINE = 400; // Volts line-to-line
export const SQRT3 = 1.7320508075688772;
export const P75_MULTIPLIER = 1.15;

// ─── Core Calculation Functions ────────────────────────────────────────────────

/**
 * Convert annual kWh to average kW during a 30-minute period using Elexon coefficient.
 * kWh_in_period = annual_kWh * coefficient
 * kW = kWh / 0.5h
 */
export function annualKwhToHalfHourKw(annualKwh: number, coefficient: number): number {
  return (annualKwh * coefficient) / 0.5;
}

/**
 * Convert kW to amps for a three-phase 400V supply at 0.95 PF.
 * I = P / (√3 × V × PF)
 */
export function kwToAmpsThreePhase(kw: number): number {
  return (kw * 1000) / (SQRT3 * VOLTAGE_LINE * POWER_FACTOR);
}

// ─── Service ───────────────────────────────────────────────────────────────────

export class BuildingLoadService {
  async calculateEstimate(siteId: string, at?: Date): Promise<BuildingLoadEstimate> {
    const targetDate = at ?? new Date();

    // Fetch profile
    const profileResult = await pool.query<BuildingProfileRow>(
      'SELECT * FROM building_profiles WHERE site_id = $1',
      [siteId],
    );

    if (profileResult.rows.length === 0) {
      throw Object.assign(new Error(`Site ${siteId} not found`), { code: 'NOT_FOUND' });
    }

    const profile = profileResult.rows[0]!;

    // Resolve effective floor area (override takes precedence)
    const floorAreaM2 = profile.floor_area_override
      ? parseFloat(profile.floor_area_override)
      : profile.floor_area_m2
        ? parseFloat(profile.floor_area_m2)
        : null;

    if (floorAreaM2 === null) {
      throw Object.assign(
        new Error(`Floor area not available for site ${siteId} — cannot calculate estimate`),
        { code: 'UNPROCESSABLE' },
      );
    }

    const effectiveBuildingType = profile.building_type_override ?? profile.building_type;
    const effectiveAge = profile.building_age_override ?? profile.building_age;

    // Annual kWh — prefer value cached in building_profiles (written by Stage 1 EPC pipeline).
    // Fall back to inline calculation when the profile hasn't been through Stage 1 yet.
    let annualKwhCentral: number;
    let annualKwhP75: number;
    if (profile.annual_kwh_central && profile.annual_kwh_p75) {
      annualKwhCentral = parseFloat(profile.annual_kwh_central);
      annualKwhP75 = parseFloat(profile.annual_kwh_p75);
    } else {
      const benchmark = await cibseService.getBenchmark(effectiveBuildingType);
      const typicalKwhPerM2 = parseFloat(benchmark.typical_kwh);
      const ageMultiplier = await cibseService.getAgeMultiplier(effectiveAge);
      annualKwhCentral = floorAreaM2 * typicalKwhPerM2 * ageMultiplier;
      annualKwhP75 = annualKwhCentral * P75_MULTIPLIER;
    }

    const safetyMargin = SAFETY_MARGINS[profile.confidence_level] ?? 1.15;

    // Elexon profile
    const season = getSeason(targetDate);
    const dayType = getDayType(targetDate);
    const halfHourPeriod = getHalfHourPeriod(targetDate);

    const elexonRow = await elexonService.getCoefficient(
      profile.elexon_profile_class,
      season,
      dayType,
      halfHourPeriod,
    );
    const coefficient = parseFloat(elexonRow.coefficient);

    // Power calculations
    const centralKw = annualKwhToHalfHourKw(annualKwhCentral, coefficient);
    const p75Kw = annualKwhToHalfHourKw(annualKwhP75, coefficient);

    const centralAmps = kwToAmpsThreePhase(centralKw);
    const p75Amps = kwToAmpsThreePhase(p75Kw);

    // Phase distribution
    const phaseFactors = getPhaseFactors(effectiveBuildingType);
    const phaseAmps = distributePhaseAmps(p75Amps, phaseFactors);

    // Valid window: the 30-minute period this estimate covers
    const periodStartMs =
      Math.floor(targetDate.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000);
    const validFrom = new Date(periodStartMs);
    const validUntil = new Date(periodStartMs + 30 * 60 * 1000);

    const estimate: BuildingLoadEstimate = {
      siteId,
      calculatedAt: new Date(),
      validFrom,
      validUntil,
      halfHourPeriod,
      season,
      dayType,
      centralKw: Math.round(centralKw * 1000) / 1000,
      p75Kw: Math.round(p75Kw * 1000) / 1000,
      centralAmps: Math.round(centralAmps * 1000) / 1000,
      p75Amps: Math.round(p75Amps * 1000) / 1000,
      l1Amps: Math.round(phaseAmps.l1 * 1000) / 1000,
      l2Amps: Math.round(phaseAmps.l2 * 1000) / 1000,
      l3Amps: Math.round(phaseAmps.l3 * 1000) / 1000,
      floorAreaM2,
      profileClass: profile.elexon_profile_class,
      confidenceLevel: profile.confidence_level,
      annualKwhP75: Math.round(annualKwhP75 * 100) / 100,
      elexonCoefficient: coefficient,
      safetyMarginApplied: safetyMargin - 1,
    };

    // Persist estimate
    await this.saveEstimate(estimate);

    return estimate;
  }

  async getForecast(siteId: string): Promise<BuildingLoadEstimate[]> {
    const now = new Date();
    // Start from the beginning of the current half-hour period
    const currentPeriodStart =
      Math.floor(now.getTime() / (30 * 60 * 1000)) * (30 * 60 * 1000);

    const estimates: BuildingLoadEstimate[] = [];

    for (let i = 0; i < 48; i++) {
      const periodMs = currentPeriodStart + i * 30 * 60 * 1000;
      const periodDate = new Date(periodMs);
      const estimate = await this.calculateEstimate(siteId, periodDate);
      estimates.push(estimate);
    }

    return estimates;
  }

  async getStoredEstimate(
    siteId: string,
    at?: Date,
  ): Promise<BuildingLoadEstimate | null> {
    const targetDate = at ?? new Date();

    const result = await pool.query<{
      site_id: string;
      calculated_at: Date;
      valid_from: Date;
      valid_until: Date;
      half_hour_period: number;
      season: string;
      day_type: string;
      central_kw: string;
      p75_kw: string;
      central_amps: string;
      p75_amps: string;
      l1_amps: string;
      l2_amps: string;
      l3_amps: string;
      floor_area_m2: string;
      profile_class: number;
      confidence_level: string;
      annual_kwh_p75: string;
      elexon_coefficient: string | null;
      safety_margin_applied: string | null;
    }>(
      `SELECT * FROM building_load_estimates
       WHERE site_id = $1
         AND valid_from <= $2
         AND valid_until > $2
       ORDER BY calculated_at DESC
       LIMIT 1`,
      [siteId, targetDate],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0]!;
    return {
      siteId: row.site_id,
      calculatedAt: row.calculated_at,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      halfHourPeriod: row.half_hour_period,
      season: row.season,
      dayType: row.day_type,
      centralKw: parseFloat(row.central_kw),
      p75Kw: parseFloat(row.p75_kw),
      centralAmps: parseFloat(row.central_amps),
      p75Amps: parseFloat(row.p75_amps),
      l1Amps: parseFloat(row.l1_amps),
      l2Amps: parseFloat(row.l2_amps),
      l3Amps: parseFloat(row.l3_amps),
      floorAreaM2: parseFloat(row.floor_area_m2),
      profileClass: row.profile_class,
      confidenceLevel: row.confidence_level,
      annualKwhP75: parseFloat(row.annual_kwh_p75),
      elexonCoefficient: row.elexon_coefficient ? parseFloat(row.elexon_coefficient) : 0,
      safetyMarginApplied: row.safety_margin_applied ? parseFloat(row.safety_margin_applied) : 0.15,
    };
  }

  private async saveEstimate(estimate: BuildingLoadEstimate): Promise<void> {
    try {
      await pool.query(
        `INSERT INTO building_load_estimates
          (site_id, calculated_at, valid_from, valid_until,
           half_hour_period, season, day_type,
           central_kw, p75_kw, central_amps, p75_amps,
           l1_amps, l2_amps, l3_amps,
           floor_area_m2, profile_class, confidence_level, annual_kwh_p75,
           elexon_coefficient, safety_margin_applied)
         VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         ON CONFLICT DO NOTHING`,
        [
          estimate.siteId,
          estimate.calculatedAt,
          estimate.validFrom,
          estimate.validUntil,
          estimate.halfHourPeriod,
          estimate.season,
          estimate.dayType,
          estimate.centralKw,
          estimate.p75Kw,
          estimate.centralAmps,
          estimate.p75Amps,
          estimate.l1Amps,
          estimate.l2Amps,
          estimate.l3Amps,
          estimate.floorAreaM2,
          estimate.profileClass,
          estimate.confidenceLevel,
          estimate.annualKwhP75,
          estimate.elexonCoefficient,
          estimate.safetyMarginApplied,
        ],
      );
    } catch (err) {
      logger.warn('Failed to persist estimate', {
        siteId: estimate.siteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

export const buildingLoadService = new BuildingLoadService();
