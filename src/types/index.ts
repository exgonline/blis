// ─── Enums ────────────────────────────────────────────────────────────────────

export enum BuildingType {
  Hotel = 'hotel',
  HotelBudget = 'hotel_budget',
  HousingAssociation = 'housing_association',
  FleetDepot = 'fleet_depot',
  WarehouseSimple = 'warehouse_simple',
  CarPark = 'car_park',
  CarParkWithFacilities = 'car_park_with_facilities',
  OfficeGeneral = 'office_general',
  Retail = 'retail',
  PubRestaurant = 'pub_restaurant',
  Unknown = 'unknown',
}

export enum BuildingAge {
  Pre1970 = 'pre_1970',
  From1970To1990 = '1970_1990',
  From1990To2005 = '1990_2005',
  Post2005 = 'post_2005',
  Unknown = 'unknown',
}

export enum ElexonSeason {
  Winter = 'winter',
  Spring = 'spring',
  Summer = 'summer',
  HighSummer = 'high_summer',
  Autumn = 'autumn',
}

export enum DayType {
  Weekday = 'weekday',
  Saturday = 'saturday',
  Sunday = 'sunday',
}

export enum ConfidenceLevel {
  Statistical = 'STATISTICAL',
  EpcDerived = 'EPC_DERIVED',
  ManualOverride = 'MANUAL_OVERRIDE',
}

export enum ClassifiedBy {
  Pending = 'pending',
  Epc = 'epc',
  Manual = 'manual',
  Default = 'default',
}

export enum FetchStatus {
  Success = 'success',
  NotFound = 'not_found',
  RateLimited = 'rate_limited',
  Error = 'error',
}

export enum PhaseFactorSource {
  BuildingTypeDefault = 'building_type_default',
  ManualOverride = 'manual_override',
}

// ─── Database Row Types ────────────────────────────────────────────────────────

export interface ApiKeyRow {
  id: string;
  key_hash: string;
  app_name: string;
  created_at: Date;
  last_used_at: Date | null;
  is_active: boolean;
  notes: string | null;
}

export interface BuildingProfileRow {
  id: string;
  site_id: string;
  site_name: string | null;
  address: string | null;
  postcode: string | null;
  uprn: string | null;
  building_type: string;
  building_age: string;
  floor_area_m2: string | null;
  elexon_profile_class: number;
  cibse_category: string;
  classified_by: string;
  classified_at: Date | null;
  building_type_override: string | null;
  floor_area_override: string | null;
  building_age_override: string | null;
  phase_l1_factor: string;
  phase_l2_factor: string;
  phase_l3_factor: string;
  phase_factor_source: string;
  confidence_level: string;
  created_at: Date;
  updated_at: Date;
}

export interface EpcRecordRow {
  id: string;
  site_id: string;
  building_reference: string | null;
  uprn: string | null;
  floor_area_m2: string | null;
  property_type: string | null;
  main_activity: string | null;
  energy_rating: string | null;
  asset_rating: number | null;
  lodgement_date: Date | null;
  fetched_at: Date;
  api_response_raw: Record<string, unknown> | null;
  is_current: boolean;
  fetch_status: string;
  error_message: string | null;
}

export interface ElexonProfileRow {
  id: string;
  profile_class: number;
  season: string;
  day_type: string;
  period_index: number;
  period_start_hhmm: string;
  coefficient: string;
  data_version: string;
  seeded_at: Date;
}

export interface CibseBenchmarkRow {
  id: string;
  category: string;
  description: string;
  good_practice_kwh: string;
  typical_kwh: string;
  source: string;
  notes: string | null;
  seeded_at: Date;
}

export interface AgeMultiplierRow {
  id: string;
  age_band: string;
  multiplier: string;
  description: string | null;
  seeded_at: Date;
}

export interface BuildingLoadEstimateRow {
  id: string;
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
}

// ─── Request / Response Types ──────────────────────────────────────────────────

export interface RegisterSiteRequest {
  siteId: string;
  siteName?: string;
  address: string;
  postcode: string;
  uprn?: string;
  buildingTypeOverride?: BuildingType;
  floorAreaOverride?: number;
  buildingAgeOverride?: BuildingAge;
}

export interface BuildingProfileResponse {
  siteId: string;
  siteName: string | null;
  address: string | null;
  postcode: string | null;
  uprn: string | null;
  buildingType: string;
  buildingAge: string;
  floorAreaM2: number | null;
  elexonProfileClass: number;
  cibseCategory: string;
  classifiedBy: string;
  classifiedAt: Date | null;
  buildingTypeOverride: string | null;
  floorAreaOverride: number | null;
  buildingAgeOverride: string | null;
  phaseL1Factor: number;
  phaseL2Factor: number;
  phaseL3Factor: number;
  phaseFactorSource: string;
  confidenceLevel: string;
  createdAt: Date;
  updatedAt: Date;
  currentEpc: EpcRecordResponse | null;
}

export interface EpcRecordResponse {
  id: string;
  siteId: string;
  buildingReference: string | null;
  uprn: string | null;
  floorAreaM2: number | null;
  propertyType: string | null;
  mainActivity: string | null;
  energyRating: string | null;
  assetRating: number | null;
  lodgementDate: Date | null;
  fetchedAt: Date;
  fetchStatus: string;
  errorMessage: string | null;
}

export interface BuildingLoadEstimate {
  siteId: string;
  calculatedAt: Date;
  validFrom: Date;
  validUntil: Date;
  halfHourPeriod: number;
  season: string;
  dayType: string;
  centralKw: number;
  p75Kw: number;
  centralAmps: number;
  p75Amps: number;
  l1Amps: number;
  l2Amps: number;
  l3Amps: number;
  floorAreaM2: number;
  profileClass: number;
  confidenceLevel: string;
  annualKwhP75: number;
}

export interface PhaseFactors {
  l1: number;
  l2: number;
  l3: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  version: string;
  db: {
    connected: boolean;
    latencyMs?: number;
  };
}

export interface ApiErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  timestamp: string;
}

// ─── EPC API Types ─────────────────────────────────────────────────────────────

export interface EpcApiRow {
  'building-reference-number'?: string;
  uprn?: string;
  'floor-area'?: string;
  'property-type'?: string;
  'main-activity'?: string;
  'asset-rating-band'?: string;
  'asset-rating'?: string;
  'lodgement-date'?: string;
}

export interface EpcApiResponse {
  rows: EpcApiRow[];
  'total-results': number;
}

// ─── Elexon JSON Data Types ────────────────────────────────────────────────────

export interface ElexonProfileData {
  version: string;
  lastUpdated: string;
  profiles: Record<string, ElexonSeasonData>;
}

export interface ElexonSeasonData {
  winter: ElexonDayTypeData;
  spring: ElexonDayTypeData;
  summer: ElexonDayTypeData;
  high_summer: ElexonDayTypeData;
  autumn: ElexonDayTypeData;
}

export interface ElexonDayTypeData {
  weekday: number[];
  saturday: number[];
  sunday: number[];
}
