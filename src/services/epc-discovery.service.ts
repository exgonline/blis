import { pool } from '../db/client';
import { logger } from '../utils/logger';
import { cibseService } from './cibse.service';
import { searchEpcByPostcode, fetchEpcByBuildingReference, mapMainActivityToBuildingType } from '../collectors/epc.collector';
import { getPhaseFactors } from '../utils/phase';
import { BuildingAge, BuildingType, ClassifiedBy, ConfidenceLevel, PhaseFactorSource } from '../types/index';
import type {
  EpcApiRow,
  EpcSearchResultItem,
  EpcSearchResponse,
  RegisterFromEpcRequest,
  EpcRegistrationResult,
} from '../types/index';

const KWH_P75_MULTIPLIER = 1.15;
const KWH_HIGH_MULTIPLIER = 1.30;

function buildAddress(row: EpcApiRow): string {
  return [row.address1, row.address2, row.address3]
    .filter(Boolean)
    .join(', ');
}

function mapBuildingTypeToProfileClass(buildingType: string): number {
  switch (buildingType) {
    case BuildingType.Hotel:
    case BuildingType.HotelBudget:
    case BuildingType.HousingAssociation:
      return 1;
    default:
      return 3;
  }
}

export class EpcDiscoveryService {
  async searchByPostcode(postcode: string): Promise<EpcSearchResponse> {
    const rows = await searchEpcByPostcode(postcode);

    const results: EpcSearchResultItem[] = rows
      .filter((row) => row['building-reference-number'])
      .map((row) => ({
        buildingReference: row['building-reference-number']!,
        uprn: row.uprn ?? null,
        address: buildAddress(row),
        postcode: row.postcode ?? null,
        floorAreaM2: row['floor-area'] ? Number.parseFloat(row['floor-area']) : null,
        propertyType: row['property-type'] ?? null,
        mainActivity: row['main-activity'] ?? null,
        suggestedBuildingType: mapMainActivityToBuildingType(row['main-activity']),
        energyRating: row['asset-rating-band'] ?? null,
        assetRating: row['asset-rating'] ? Number.parseInt(row['asset-rating'], 10) : null,
        lodgementDate: row['lodgement-date'] ?? null,
      }));

    return { postcode, count: results.length, results };
  }

  async registerFromBuildingReference(req: RegisterFromEpcRequest): Promise<EpcRegistrationResult> {
    // Check for duplicate siteId
    const existing = await pool.query<{ site_id: string }>(
      'SELECT site_id FROM building_profiles WHERE site_id = $1',
      [req.siteId],
    );
    if (existing.rows.length > 0) {
      throw Object.assign(new Error(`Site ${req.siteId} already exists`), { code: 'CONFLICT' });
    }

    // Fetch EPC certificate by building reference
    const row = await fetchEpcByBuildingReference(req.buildingReference);
    if (!row) {
      throw Object.assign(
        new Error(`No EPC certificate found for building reference ${req.buildingReference}`),
        { code: 'NOT_FOUND' },
      );
    }

    const address = buildAddress(row);
    const postcode = row.postcode ?? '';
    const floorAreaM2 = row['floor-area'] ? Number.parseFloat(row['floor-area']) : null;
    const mainActivity = row['main-activity'] ?? null;
    const energyRating = row['asset-rating-band'] ?? null;
    const buildingType = mapMainActivityToBuildingType(mainActivity ?? undefined);
    const effectiveBuildingType = buildingType !== BuildingType.Unknown ? buildingType : BuildingType.Unknown;
    const effectiveAge = (req.buildingAgeOverride as BuildingAge | undefined) ?? BuildingAge.Unknown;

    const phaseFactors = getPhaseFactors(effectiveBuildingType);
    const profileClass = mapBuildingTypeToProfileClass(effectiveBuildingType);

    // Persist the site
    await pool.query(
      `INSERT INTO building_profiles
        (site_id, site_name, address, postcode, uprn,
         building_type, building_age, floor_area_m2,
         elexon_profile_class, cibse_category,
         classified_by, classified_at,
         building_type_override, floor_area_override, building_age_override,
         phase_l1_factor, phase_l2_factor, phase_l3_factor, phase_factor_source,
         confidence_level,
         epc_rating, epc_fetched_at)
       VALUES
        ($1,$2,$3,$4,$5,
         $6,$7,$8,
         $9,$10,
         $11,$12,
         $13,$14,$15,
         $16,$17,$18,$19,
         $20,
         $21,$22)`,
      [
        req.siteId,
        req.siteName ?? null,
        address || null,
        postcode || null,
        row.uprn ?? null,
        effectiveBuildingType,
        effectiveAge,
        floorAreaM2,
        profileClass,
        effectiveBuildingType,
        ClassifiedBy.Epc,
        new Date(),
        null,  // no building_type_override
        null,  // no floor_area_override
        req.buildingAgeOverride ?? null,
        phaseFactors.l1,
        phaseFactors.l2,
        phaseFactors.l3,
        PhaseFactorSource.BuildingTypeDefault,
        ConfidenceLevel.EpcDerived,
        energyRating,
        new Date(),
      ],
    );

    logger.info(`Site registered from EPC discovery: ${req.siteId}`, {
      siteId: req.siteId,
      buildingReference: req.buildingReference,
      buildingType: effectiveBuildingType,
      floorAreaM2,
    });

    // Calculate kWh if floor area is available
    let annualKwhResult: EpcRegistrationResult['annualKwh'] = null;
    let benchmarkResult: EpcRegistrationResult['benchmark'] = null;

    if (floorAreaM2 !== null) {
      try {
        const benchmark = await cibseService.getBenchmark(effectiveBuildingType);
        const typicalKwhPerM2 = Number.parseFloat(benchmark.typical_kwh);
        const goodPracticeKwhPerM2 = Number.parseFloat(benchmark.good_practice_kwh);
        const ageMultiplier = await cibseService.getAgeMultiplier(effectiveAge);

        const central = floorAreaM2 * typicalKwhPerM2 * ageMultiplier;
        const p75 = central * KWH_P75_MULTIPLIER;
        const low = floorAreaM2 * goodPracticeKwhPerM2 * ageMultiplier;
        const high = central * KWH_HIGH_MULTIPLIER;

        await pool.query(
          `UPDATE building_profiles SET
             annual_kwh_central = $1,
             annual_kwh_p75     = $2,
             annual_kwh_low     = $3,
             annual_kwh_high    = $4
           WHERE site_id = $5`,
          [
            Math.round(central * 100) / 100,
            Math.round(p75 * 100) / 100,
            Math.round(low * 100) / 100,
            Math.round(high * 100) / 100,
            req.siteId,
          ],
        );

        annualKwhResult = {
          central: Math.round(central * 100) / 100,
          p75: Math.round(p75 * 100) / 100,
          low: Math.round(low * 100) / 100,
          high: Math.round(high * 100) / 100,
        };

        benchmarkResult = {
          typicalKwhPerM2,
          goodPracticeKwhPerM2,
          ageMultiplier,
        };
      } catch (err) {
        logger.warn(`kWh calculation failed for ${req.siteId} — no benchmark for building type`, {
          siteId: req.siteId,
          buildingType: effectiveBuildingType,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      siteId: req.siteId,
      registeredAt: new Date().toISOString(),
      buildingReference: req.buildingReference,
      address,
      postcode,
      buildingType: effectiveBuildingType,
      floorAreaM2,
      energyRating,
      annualKwh: annualKwhResult,
      benchmark: benchmarkResult,
    };
  }
}

export const epcDiscoveryService = new EpcDiscoveryService();
