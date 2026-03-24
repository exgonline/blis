import axios, { AxiosError } from 'axios';
import { pool } from '../db/client';
import { config } from '../config/index';
import { logger } from '../utils/logger';
import { BuildingType, FetchStatus } from '../types/index';
import type { EpcApiResponse, EpcApiRow } from '../types/index';

const BACKOFF_DELAYS_MS = [2000, 4000, 8000];

function buildAuthHeader(): string {
  const credentials = `${config.epc.apiEmail}:${config.epc.apiKey}`;
  const encoded = Buffer.from(credentials).toString('base64');
  return `Basic ${encoded}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapMainActivityToBuildingType(mainActivity: string | undefined): BuildingType {
  if (!mainActivity) return BuildingType.Unknown;

  const lower = mainActivity.toLowerCase();

  if (lower.includes('budget hotel')) return BuildingType.HotelBudget;
  if (lower.includes('hotel') || lower.includes('motel')) return BuildingType.Hotel;
  if (lower.includes('office')) return BuildingType.OfficeGeneral;
  if (lower.includes('retail') || lower.includes('supermarket') || lower.includes('shop')) {
    return BuildingType.Retail;
  }
  if (lower.includes('warehouse') || lower.includes('storage')) return BuildingType.WarehouseSimple;
  if (lower.includes('car park') || lower.includes('parking')) return BuildingType.CarPark;
  if (lower.includes('public house') || lower.includes('pub') || lower.includes('restaurant') || lower.includes('cafe')) {
    return BuildingType.PubRestaurant;
  }
  if (lower.includes('residential') || lower.includes('communal') || lower.includes('housing')) {
    return BuildingType.HousingAssociation;
  }
  if (lower.includes('depot') || lower.includes('workshop') || lower.includes('fleet')) {
    return BuildingType.FleetDepot;
  }

  return BuildingType.Unknown;
}

function parseEpcRow(row: EpcApiRow, siteId: string): {
  buildingReference: string | null;
  uprn: string | null;
  floorAreaM2: number | null;
  propertyType: string | null;
  mainActivity: string | null;
  energyRating: string | null;
  assetRating: number | null;
  lodgementDate: string | null;
} {
  return {
    buildingReference: row['building-reference-number'] ?? null,
    uprn: row['uprn'] ?? null,
    floorAreaM2: row['floor-area'] ? parseFloat(row['floor-area']) : null,
    propertyType: row['property-type'] ?? null,
    mainActivity: row['main-activity'] ?? null,
    energyRating: row['asset-rating-band'] ?? null,
    assetRating: row['asset-rating'] ? parseInt(row['asset-rating'], 10) : null,
    lodgementDate: row['lodgement-date'] ?? null,
  };
}

interface EpcFetchResult {
  status: FetchStatus;
  buildingType: BuildingType;
  floorAreaM2: number | null;
  mainActivity: string | null;
  errorMessage: string | null;
}

async function fetchFromEpcApi(
  params: Record<string, string>,
): Promise<EpcApiResponse | null> {
  const authHeader = buildAuthHeader();

  for (let attempt = 0; attempt < BACKOFF_DELAYS_MS.length + 1; attempt++) {
    try {
      const response = await axios.get<EpcApiResponse>(config.epc.baseUrl + '/search', {
        headers: {
          Authorization: authHeader,
          Accept: 'application/json',
        },
        params,
        timeout: config.epc.timeoutMs,
      });
      return response.data;
    } catch (err) {
      const axiosErr = err as AxiosError;
      if (axiosErr.response?.status === 429) {
        if (attempt < BACKOFF_DELAYS_MS.length) {
          const delay = BACKOFF_DELAYS_MS[attempt]!;
          logger.warn(`EPC API rate limited, backing off ${delay}ms (attempt ${attempt + 1})`);
          await sleep(delay);
          continue;
        }
        // Exhausted retries
        return null;
      }
      throw err;
    }
  }
  return null;
}

async function markPreviousEpcRecordsStale(siteId: string): Promise<void> {
  await pool.query(
    'UPDATE epc_records SET is_current = FALSE WHERE site_id = $1 AND is_current = TRUE',
    [siteId],
  );
}

async function saveEpcRecord(
  siteId: string,
  status: FetchStatus,
  row: EpcApiRow | null,
  rawResponse: EpcApiResponse | null,
  errorMessage: string | null,
): Promise<void> {
  await markPreviousEpcRecordsStale(siteId);

  if (row) {
    const parsed = parseEpcRow(row, siteId);
    await pool.query(
      `INSERT INTO epc_records
        (site_id, building_reference, uprn, floor_area_m2, property_type,
         main_activity, energy_rating, asset_rating, lodgement_date,
         api_response_raw, is_current, fetch_status, error_message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,TRUE,$11,$12)`,
      [
        siteId,
        parsed.buildingReference,
        parsed.uprn,
        parsed.floorAreaM2,
        parsed.propertyType,
        parsed.mainActivity,
        parsed.energyRating,
        parsed.assetRating,
        parsed.lodgementDate,
        rawResponse ? JSON.stringify(rawResponse) : null,
        status,
        errorMessage,
      ],
    );
  } else {
    await pool.query(
      `INSERT INTO epc_records
        (site_id, api_response_raw, is_current, fetch_status, error_message)
       VALUES ($1,$2,TRUE,$3,$4)`,
      [
        siteId,
        rawResponse ? JSON.stringify(rawResponse) : null,
        status,
        errorMessage,
      ],
    );
  }
}

export async function fetchEpcForSite(siteId: string): Promise<EpcFetchResult> {
  // Look up the profile to get UPRN and postcode
  const profileResult = await pool.query<{
    uprn: string | null;
    postcode: string | null;
    address: string | null;
  }>(
    'SELECT uprn, postcode, address FROM building_profiles WHERE site_id = $1',
    [siteId],
  );

  if (profileResult.rows.length === 0) {
    return {
      status: FetchStatus.Error,
      buildingType: BuildingType.Unknown,
      floorAreaM2: null,
      mainActivity: null,
      errorMessage: `Site ${siteId} not found`,
    };
  }

  const profile = profileResult.rows[0]!;

  // Minimum delay between requests
  await sleep(config.epc.requestDelayMs);

  let epcResponse: EpcApiResponse | null = null;

  // Try UPRN first
  if (profile.uprn) {
    try {
      epcResponse = await fetchFromEpcApi({ uprn: profile.uprn });
    } catch (err) {
      logger.warn(`EPC UPRN lookup failed for ${siteId}`, {
        siteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Fall back to postcode + address
  if ((!epcResponse || epcResponse.rows.length === 0) && profile.postcode) {
    await sleep(config.epc.requestDelayMs);
    try {
      epcResponse = await fetchFromEpcApi({
        postcode: profile.postcode,
        ...(profile.address ? { address: profile.address } : {}),
      });
    } catch (err) {
      logger.warn(`EPC postcode lookup failed for ${siteId}`, {
        siteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Rate limited
  if (epcResponse === null) {
    await saveEpcRecord(siteId, FetchStatus.RateLimited, null, null, 'Rate limited after retries');
    return {
      status: FetchStatus.RateLimited,
      buildingType: BuildingType.Unknown,
      floorAreaM2: null,
      mainActivity: null,
      errorMessage: 'Rate limited after retries',
    };
  }

  // Not found
  if (epcResponse.rows.length === 0) {
    await saveEpcRecord(siteId, FetchStatus.NotFound, null, epcResponse, null);
    return {
      status: FetchStatus.NotFound,
      buildingType: BuildingType.Unknown,
      floorAreaM2: null,
      mainActivity: null,
      errorMessage: null,
    };
  }

  // Use first row
  const firstRow = epcResponse.rows[0]!;
  const parsed = parseEpcRow(firstRow, siteId);
  const buildingType = mapMainActivityToBuildingType(parsed.mainActivity ?? undefined);

  await saveEpcRecord(siteId, FetchStatus.Success, firstRow, epcResponse, null);

  logger.info(`EPC fetched for ${siteId}`, {
    siteId,
    buildingType,
    floorAreaM2: parsed.floorAreaM2,
  });

  return {
    status: FetchStatus.Success,
    buildingType,
    floorAreaM2: parsed.floorAreaM2,
    mainActivity: parsed.mainActivity,
    errorMessage: null,
  };
}

export { mapMainActivityToBuildingType };
