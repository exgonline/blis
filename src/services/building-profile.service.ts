import { pool } from '../db/client';
import { logger } from '../utils/logger';
import { getPhaseFactors } from '../utils/phase';
import { BuildingType, BuildingAge, ConfidenceLevel, ClassifiedBy, PhaseFactorSource } from '../types/index';
import type {
  BuildingProfileRow,
  EpcRecordRow,
  BuildingProfileResponse,
  EpcRecordResponse,
  RegisterSiteRequest,
  SiteListItem,
  SiteListResponse,
} from '../types/index';
import { fetchEpcForSite } from '../collectors/epc.collector';
import { cibseService } from './cibse.service';

const KWH_P75_MULTIPLIER = 1.15;

function mapBuildingTypeToProfileClass(buildingType: string): number {
  switch (buildingType) {
    case BuildingType.Hotel:
    case BuildingType.HotelBudget:
    case BuildingType.HousingAssociation:
      return 1;
    case BuildingType.OfficeGeneral:
    case BuildingType.FleetDepot:
    case BuildingType.WarehouseSimple:
    case BuildingType.CarPark:
    case BuildingType.CarParkWithFacilities:
    case BuildingType.Retail:
    case BuildingType.PubRestaurant:
      return 3;
    default:
      return 3;
  }
}

function rowToProfileResponse(
  row: BuildingProfileRow,
  epcRow: EpcRecordRow | null,
): BuildingProfileResponse {
  return {
    siteId: row.site_id,
    siteName: row.site_name,
    address: row.address,
    postcode: row.postcode,
    uprn: row.uprn,
    buildingType: row.building_type_override ?? row.building_type,
    buildingAge: row.building_age_override ?? row.building_age,
    floorAreaM2: row.floor_area_override
      ? parseFloat(row.floor_area_override)
      : row.floor_area_m2
        ? parseFloat(row.floor_area_m2)
        : null,
    elexonProfileClass: row.elexon_profile_class,
    cibseCategory: row.building_type_override ?? row.building_type,
    classifiedBy: row.classified_by,
    classifiedAt: row.classified_at,
    buildingTypeOverride: row.building_type_override,
    floorAreaOverride: row.floor_area_override ? parseFloat(row.floor_area_override) : null,
    buildingAgeOverride: row.building_age_override,
    phaseL1Factor: parseFloat(row.phase_l1_factor),
    phaseL2Factor: parseFloat(row.phase_l2_factor),
    phaseL3Factor: parseFloat(row.phase_l3_factor),
    phaseFactorSource: row.phase_factor_source,
    confidenceLevel: row.confidence_level,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentEpc: epcRow ? rowToEpcResponse(epcRow) : null,
  };
}

function rowToEpcResponse(row: EpcRecordRow): EpcRecordResponse {
  return {
    id: row.id,
    siteId: row.site_id,
    buildingReference: row.building_reference,
    uprn: row.uprn,
    floorAreaM2: row.floor_area_m2 ? parseFloat(row.floor_area_m2) : null,
    propertyType: row.property_type,
    mainActivity: row.main_activity,
    energyRating: row.energy_rating,
    assetRating: row.asset_rating,
    lodgementDate: row.lodgement_date,
    fetchedAt: row.fetched_at,
    fetchStatus: row.fetch_status,
    errorMessage: row.error_message,
  };
}

export class BuildingProfileService {
  async getProfile(siteId: string): Promise<BuildingProfileResponse | null> {
    const profileResult = await pool.query<BuildingProfileRow>(
      'SELECT * FROM building_profiles WHERE site_id = $1',
      [siteId],
    );

    if (profileResult.rows.length === 0) {
      return null;
    }

    const profile = profileResult.rows[0]!;

    const epcResult = await pool.query<EpcRecordRow>(
      'SELECT * FROM epc_records WHERE site_id = $1 AND is_current = TRUE LIMIT 1',
      [siteId],
    );

    const epc = epcResult.rows[0] ?? null;
    return rowToProfileResponse(profile, epc);
  }

  async getEpcRecord(siteId: string): Promise<EpcRecordResponse | null> {
    const result = await pool.query<EpcRecordRow>(
      'SELECT * FROM epc_records WHERE site_id = $1 AND is_current = TRUE LIMIT 1',
      [siteId],
    );

    if (result.rows.length === 0) return null;
    return rowToEpcResponse(result.rows[0]!);
  }

  async registerSite(req: RegisterSiteRequest): Promise<BuildingProfileResponse> {
    // Check for duplicate
    const existing = await pool.query<{ site_id: string }>(
      'SELECT site_id FROM building_profiles WHERE site_id = $1',
      [req.siteId],
    );

    if (existing.rows.length > 0) {
      throw Object.assign(new Error(`Site ${req.siteId} already exists`), { code: 'CONFLICT' });
    }

    const effectiveBuildingType = req.buildingTypeOverride ?? BuildingType.Unknown;
    const phaseFactors = getPhaseFactors(effectiveBuildingType);
    const profileClass = mapBuildingTypeToProfileClass(effectiveBuildingType);

    const confidenceLevel = req.buildingTypeOverride
      ? ConfidenceLevel.ManualOverride
      : ConfidenceLevel.Statistical;

    const classifiedBy = req.buildingTypeOverride ? ClassifiedBy.Manual : ClassifiedBy.Pending;

    await pool.query(
      `INSERT INTO building_profiles
        (site_id, site_name, address, postcode, uprn,
         building_type, building_age, floor_area_m2,
         elexon_profile_class, cibse_category,
         classified_by, classified_at,
         building_type_override, floor_area_override, building_age_override,
         phase_l1_factor, phase_l2_factor, phase_l3_factor, phase_factor_source,
         confidence_level)
       VALUES
        ($1,$2,$3,$4,$5,
         $6,$7,$8,
         $9,$10,
         $11,$12,
         $13,$14,$15,
         $16,$17,$18,$19,
         $20)`,
      [
        req.siteId,
        req.siteName ?? null,
        req.address,
        req.postcode.toUpperCase(),
        req.uprn ?? null,
        effectiveBuildingType,
        req.buildingAgeOverride ?? BuildingAge.Unknown,
        null, // floor_area_m2 from EPC
        profileClass,
        effectiveBuildingType,
        classifiedBy,
        req.buildingTypeOverride ? new Date() : null,
        req.buildingTypeOverride ?? null,
        req.floorAreaOverride ?? null,
        req.buildingAgeOverride ?? null,
        phaseFactors.l1,
        phaseFactors.l2,
        phaseFactors.l3,
        req.buildingTypeOverride ? PhaseFactorSource.ManualOverride : PhaseFactorSource.BuildingTypeDefault,
        confidenceLevel,
      ],
    );

    logger.info(`Site registered: ${req.siteId}`, { siteId: req.siteId });

    // Queue EPC fetch asynchronously (fire-and-forget, errors logged)
    setImmediate(() => {
      this.triggerEpcRefresh(req.siteId).catch((err: unknown) => {
        logger.error(`Background EPC fetch failed for ${req.siteId}`, {
          siteId: req.siteId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    });

    const profile = await this.getProfile(req.siteId);
    if (!profile) {
      throw new Error(`Failed to retrieve profile after insert for site ${req.siteId}`);
    }
    return profile;
  }

  async calculateAndStoreKwh(siteId: string): Promise<void> {
    const profileResult = await pool.query<BuildingProfileRow>(
      'SELECT * FROM building_profiles WHERE site_id = $1',
      [siteId],
    );

    if (profileResult.rows.length === 0) return;
    const profile = profileResult.rows[0]!;

    const floorAreaM2 = profile.floor_area_override
      ? parseFloat(profile.floor_area_override)
      : profile.floor_area_m2
        ? parseFloat(profile.floor_area_m2)
        : null;

    if (floorAreaM2 === null) {
      logger.warn(`Cannot calculate kWh for ${siteId} — no floor area available`, { siteId });
      return;
    }

    const effectiveBuildingType = profile.building_type_override ?? profile.building_type;
    const effectiveAge = profile.building_age_override ?? profile.building_age;

    const benchmark = await cibseService.getBenchmark(effectiveBuildingType);
    const typicalKwhPerM2 = parseFloat(benchmark.typical_kwh);
    const goodPracticeKwhPerM2 = parseFloat(benchmark.good_practice_kwh);
    const ageMultiplier = await cibseService.getAgeMultiplier(effectiveAge);

    const annualKwhCentral = floorAreaM2 * typicalKwhPerM2 * ageMultiplier;
    const annualKwhP75 = annualKwhCentral * KWH_P75_MULTIPLIER;
    const annualKwhLow = floorAreaM2 * goodPracticeKwhPerM2 * ageMultiplier;
    const annualKwhHigh = annualKwhCentral * 1.30;

    await pool.query(
      `UPDATE building_profiles SET
         annual_kwh_central = $1,
         annual_kwh_p75     = $2,
         annual_kwh_low     = $3,
         annual_kwh_high    = $4
       WHERE site_id = $5`,
      [
        Math.round(annualKwhCentral * 100) / 100,
        Math.round(annualKwhP75 * 100) / 100,
        Math.round(annualKwhLow * 100) / 100,
        Math.round(annualKwhHigh * 100) / 100,
        siteId,
      ],
    );

    logger.info(`Annual kWh calculated for ${siteId}`, {
      siteId,
      annualKwhCentral: Math.round(annualKwhCentral),
      annualKwhP75: Math.round(annualKwhP75),
    });
  }

  async updateClassification(
    siteId: string,
    epcFloorArea: number | null,
    epcMainActivity: string | null,
    detectedBuildingType: BuildingType,
    energyRating: string | null,
    epcFetchedAt: Date,
  ): Promise<void> {
    // Check for manual overrides — they take precedence
    const profileResult = await pool.query<{
      building_type_override: string | null;
      floor_area_override: string | null;
      building_age_override: string | null;
    }>(
      'SELECT building_type_override, floor_area_override, building_age_override FROM building_profiles WHERE site_id = $1',
      [siteId],
    );

    if (profileResult.rows.length === 0) return;
    const overrides = profileResult.rows[0]!;

    const newBuildingType = overrides.building_type_override
      ? (overrides.building_type_override as BuildingType)
      : detectedBuildingType;

    const phaseFactors = getPhaseFactors(newBuildingType);
    const profileClass = mapBuildingTypeToProfileClass(newBuildingType);
    const confidenceLevel = overrides.building_type_override
      ? ConfidenceLevel.ManualOverride
      : ConfidenceLevel.EpcDerived;

    const classifiedBy = overrides.building_type_override
      ? ClassifiedBy.Manual
      : ClassifiedBy.Epc;

    await pool.query(
      `UPDATE building_profiles SET
         building_type = $1,
         floor_area_m2 = COALESCE($2, floor_area_m2),
         elexon_profile_class = $3,
         cibse_category = $4,
         classified_by = $5,
         classified_at = NOW(),
         phase_l1_factor = $6,
         phase_l2_factor = $7,
         phase_l3_factor = $8,
         phase_factor_source = $9,
         confidence_level = $10,
         epc_rating = $12,
         epc_fetched_at = $13
       WHERE site_id = $11`,
      [
        newBuildingType,
        epcFloorArea,
        profileClass,
        newBuildingType,
        classifiedBy,
        phaseFactors.l1,
        phaseFactors.l2,
        phaseFactors.l3,
        overrides.building_type_override
          ? PhaseFactorSource.ManualOverride
          : PhaseFactorSource.BuildingTypeDefault,
        confidenceLevel,
        siteId,
        energyRating,
        epcFetchedAt,
      ],
    );

    logger.info(`Classification updated for ${siteId}`, {
      siteId,
      buildingType: newBuildingType,
      floorAreaM2: epcFloorArea,
    });
  }

  async triggerEpcRefresh(siteId: string): Promise<void> {
    logger.info(`EPC refresh triggered for ${siteId}`, { siteId });
    const result = await fetchEpcForSite(siteId);

    if (result.status === 'success') {
      await this.updateClassification(
        siteId,
        result.floorAreaM2,
        result.mainActivity,
        result.buildingType,
        result.energyRating,
        new Date(),
      );
      await this.calculateAndStoreKwh(siteId);
    } else if (result.status === 'not_found') {
      logger.warn(`EPC not found for ${siteId} — calculating kWh from existing floor area`, { siteId });
      await this.calculateAndStoreKwh(siteId);
    }
  }

  async listSites(postcode?: string): Promise<SiteListResponse> {
    const result = await pool.query<{
      site_id: string;
      site_name: string | null;
      address: string | null;
      postcode: string | null;
      uprn: string | null;
      building_type: string;
      building_type_override: string | null;
      building_age: string;
      building_age_override: string | null;
      floor_area_m2: string | null;
      floor_area_override: string | null;
      confidence_level: string;
      classified_by: string;
      classified_at: Date | null;
      epc_rating: string | null;
      epc_fetched_at: Date | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT site_id, site_name, address, postcode, uprn,
              building_type, building_type_override,
              building_age, building_age_override,
              floor_area_m2, floor_area_override,
              confidence_level, classified_by, classified_at,
              epc_rating, epc_fetched_at,
              created_at, updated_at
         FROM building_profiles
        ${postcode ? 'WHERE UPPER(REPLACE(postcode, \' \', \'\')) = UPPER(REPLACE($1, \' \', \'\'))' : ''}
        ORDER BY created_at ASC`,
      postcode ? [postcode] : [],
    );

    const sites: SiteListItem[] = result.rows.map((row) => ({
      siteId: row.site_id,
      siteName: row.site_name,
      address: row.address,
      postcode: row.postcode,
      uprn: row.uprn,
      buildingType: row.building_type_override ?? row.building_type,
      buildingAge: row.building_age_override ?? row.building_age,
      floorAreaM2: row.floor_area_override
        ? parseFloat(row.floor_area_override)
        : row.floor_area_m2
          ? parseFloat(row.floor_area_m2)
          : null,
      confidenceLevel: row.confidence_level,
      classifiedBy: row.classified_by,
      classifiedAt: row.classified_at,
      epcRating: row.epc_rating,
      epcFetchedAt: row.epc_fetched_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return { count: sites.length, sites };
  }

  async getAllSiteIds(): Promise<string[]> {
    const result = await pool.query<{ site_id: string }>(
      'SELECT site_id FROM building_profiles ORDER BY created_at ASC',
    );
    return result.rows.map((r) => r.site_id);
  }

  async getCalculableSiteIds(): Promise<string[]> {
    const result = await pool.query<{ site_id: string }>(
      'SELECT site_id FROM building_profiles WHERE annual_kwh_p75 IS NOT NULL ORDER BY created_at ASC',
    );
    return result.rows.map((r) => r.site_id);
  }

  async getSitesNeedingEpcRefresh(daysOld = 90): Promise<string[]> {
    const result = await pool.query<{ site_id: string }>(
      `SELECT bp.site_id
       FROM building_profiles bp
       LEFT JOIN epc_records er
         ON er.site_id = bp.site_id AND er.is_current = TRUE
       WHERE er.id IS NULL
          OR er.fetched_at < NOW() - INTERVAL '${daysOld} days'
       ORDER BY bp.created_at ASC`,
    );
    return result.rows.map((r) => r.site_id);
  }
}

export const buildingProfileService = new BuildingProfileService();
