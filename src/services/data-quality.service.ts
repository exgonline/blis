import { pool } from '../db/client';
import { logger } from '../utils/logger';

// ─── Minimum plausible annual kWh thresholds by building type ─────────────────
// Values below these indicate the EPC certificate may cover only a partial
// section of the building.  Matches the building types in CIBSE TM46.

export const MINIMUM_KWH_THRESHOLDS: Record<string, number> = {
  hotel:                    50000,
  hotel_budget:             50000,
  housing_association:      20000,
  fleet_depot:              15000,
  car_park:                  5000,
  car_park_with_facilities:  5000,
  office_general:           25000,
  retail:                   25000,
  pub_restaurant:           25000,
  warehouse_simple:          5000,
  unknown:                   5000,
};

// ─── Pure helpers (exported for unit testing) ─────────────────────────────────

export function getKwhThreshold(buildingType: string): number {
  return MINIMUM_KWH_THRESHOLDS[buildingType] ?? MINIMUM_KWH_THRESHOLDS['unknown']!;
}

export function isBelowThreshold(annualKwhCentral: number, buildingType: string): boolean {
  return annualKwhCentral < getKwhThreshold(buildingType);
}

export function buildQualityNote(
  annualKwhCentral: number,
  threshold: number,
  buildingType: string,
): string {
  return (
    `Annual kWh ${Math.round(annualKwhCentral)} is below minimum plausible threshold ` +
    `${threshold} for building type ${buildingType}. ` +
    `EPC may cover partial building only. Manual floor area override recommended.`
  );
}

// ─── DB-backed quality check ──────────────────────────────────────────────────

export async function runDataQualityCheck(siteId: string): Promise<void> {
  const result = await pool.query<{
    annual_kwh_central: string | null;
    building_type: string;
    building_type_override: string | null;
    floor_area_confidence: string;
  }>(
    `SELECT annual_kwh_central, building_type, building_type_override, floor_area_confidence
     FROM building_profiles
     WHERE site_id = $1`,
    [siteId],
  );

  if (result.rows.length === 0) return;
  const row = result.rows[0]!;
  if (!row.annual_kwh_central) return;

  const annualKwhCentral = parseFloat(row.annual_kwh_central);
  const effectiveBuildingType = row.building_type_override ?? row.building_type;
  const threshold = getKwhThreshold(effectiveBuildingType);

  // MANUAL_OVERRIDE means the user has confirmed the floor area — clear stale flags only
  if (row.floor_area_confidence === 'MANUAL_OVERRIDE') {
    await pool.query(
      `UPDATE building_profiles
       SET data_quality_flag = NULL, data_quality_note = NULL, data_quality_flagged_at = NULL
       WHERE site_id = $1`,
      [siteId],
    );
    return;
  }

  if (isBelowThreshold(annualKwhCentral, effectiveBuildingType)) {
    const note = buildQualityNote(annualKwhCentral, threshold, effectiveBuildingType);
    await pool.query(
      `UPDATE building_profiles
       SET floor_area_confidence   = 'SUSPECT',
           data_quality_flag       = 'BELOW_MINIMUM_THRESHOLD',
           data_quality_note       = $1,
           data_quality_flagged_at = NOW()
       WHERE site_id = $2`,
      [note, siteId],
    );
    logger.warn('Annual kWh estimate below minimum plausible threshold', {
      job: 'quality-check',
      siteId,
      flag: 'BELOW_MINIMUM_THRESHOLD',
      annualKwhCentral: Math.round(annualKwhCentral),
      threshold,
      buildingType: effectiveBuildingType,
      message: 'Annual kWh estimate below minimum plausible threshold',
    });
  } else {
    await pool.query(
      `UPDATE building_profiles
       SET floor_area_confidence   = 'EPC_DERIVED',
           data_quality_flag       = NULL,
           data_quality_note       = NULL,
           data_quality_flagged_at = NULL
       WHERE site_id = $1`,
      [siteId],
    );
  }
}
