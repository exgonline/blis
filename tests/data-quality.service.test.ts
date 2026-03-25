import {
  getKwhThreshold,
  isBelowThreshold,
  buildQualityNote,
  MINIMUM_KWH_THRESHOLDS,
} from '../src/services/data-quality.service';

describe('getKwhThreshold', () => {
  it('returns correct threshold for known building types', () => {
    expect(getKwhThreshold('hotel')).toBe(50000);
    expect(getKwhThreshold('hotel_budget')).toBe(50000);
    expect(getKwhThreshold('housing_association')).toBe(20000);
    expect(getKwhThreshold('fleet_depot')).toBe(15000);
    expect(getKwhThreshold('car_park')).toBe(5000);
    expect(getKwhThreshold('car_park_with_facilities')).toBe(5000);
    expect(getKwhThreshold('office_general')).toBe(25000);
    expect(getKwhThreshold('retail')).toBe(25000);
    expect(getKwhThreshold('pub_restaurant')).toBe(25000);
    expect(getKwhThreshold('warehouse_simple')).toBe(5000);
    expect(getKwhThreshold('unknown')).toBe(5000);
  });

  it('falls back to unknown threshold for unrecognised building type', () => {
    expect(getKwhThreshold('some_new_type')).toBe(MINIMUM_KWH_THRESHOLDS['unknown']);
  });
});

describe('isBelowThreshold', () => {
  it('returns true when annual kWh is below threshold', () => {
    expect(isBelowThreshold(49999, 'hotel')).toBe(true);
    expect(isBelowThreshold(0, 'office_general')).toBe(true);
    expect(isBelowThreshold(4999, 'car_park')).toBe(true);
  });

  it('returns false when annual kWh meets or exceeds threshold', () => {
    expect(isBelowThreshold(50000, 'hotel')).toBe(false);
    expect(isBelowThreshold(50001, 'hotel')).toBe(false);
    expect(isBelowThreshold(25000, 'office_general')).toBe(false);
    expect(isBelowThreshold(5000, 'car_park')).toBe(false);
  });

  it('uses unknown threshold for unrecognised building types', () => {
    expect(isBelowThreshold(4999, 'mystery_type')).toBe(true);
    expect(isBelowThreshold(5000, 'mystery_type')).toBe(false);
  });
});

describe('buildQualityNote', () => {
  it('includes rounded kWh, threshold, and building type', () => {
    const note = buildQualityNote(12325.5, 50000, 'hotel');
    expect(note).toContain('12326');
    expect(note).toContain('50000');
    expect(note).toContain('hotel');
    expect(note).toContain('EPC may cover partial building only');
    expect(note).toContain('Manual floor area override recommended');
  });

  it('rounds the kWh value', () => {
    const note = buildQualityNote(999.4, 5000, 'car_park');
    expect(note).toContain('999');
    expect(note).not.toContain('999.4');
  });
});
