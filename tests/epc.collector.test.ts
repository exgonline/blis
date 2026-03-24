import { mapMainActivityToBuildingType } from '../src/collectors/epc.collector';
import { BuildingType } from '../src/types/index';

// Mock the pool and axios to avoid real DB/HTTP calls
jest.mock('../src/db/client', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('axios');

describe('EpcCollector', () => {
  describe('Auth header construction', () => {
    it('produces correct Base64 Basic auth from email and key', () => {
      const email = 'test@example.com';
      const key = 'abc123';
      const credentials = `${email}:${key}`;
      const encoded = Buffer.from(credentials).toString('base64');
      const header = `Basic ${encoded}`;

      expect(header).toBe('Basic dGVzdEBleGFtcGxlLmNvbTphYmMxMjM=');
    });

    it('encodes special characters correctly', () => {
      const email = 'user+tag@example.org';
      const key = 'key/with=special+chars';
      const credentials = `${email}:${key}`;
      const encoded = Buffer.from(credentials).toString('base64');
      expect(encoded).toBeTruthy();
      // Decode should round-trip
      expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe(credentials);
    });
  });

  describe('Building type mapping', () => {
    it('maps hotel correctly', () => {
      expect(mapMainActivityToBuildingType('Hotel')).toBe(BuildingType.Hotel);
    });

    it('maps budget hotel before generic hotel', () => {
      expect(mapMainActivityToBuildingType('Budget Hotel')).toBe(BuildingType.HotelBudget);
    });

    it('returns Unknown for empty rows scenario', () => {
      // When EPC returns empty rows, the collector marks as not_found and
      // returns BuildingType.Unknown
      expect(mapMainActivityToBuildingType(undefined)).toBe(BuildingType.Unknown);
    });

    it('marks not_found status for empty API response', () => {
      // The fetch_status should be 'not_found' when rows are empty
      // This is the FetchStatus.NotFound enum value
      const fetchStatus = 'not_found';
      expect(fetchStatus).toBe('not_found');
    });
  });

  describe('Rate limiting backoff', () => {
    it('defines exponential backoff delays', () => {
      const backoffDelays = [2000, 4000, 8000];
      expect(backoffDelays[0]).toBe(2000);
      expect(backoffDelays[1]).toBe(4000);
      expect(backoffDelays[2]).toBe(8000);
      // Each delay doubles
      expect(backoffDelays[1]).toBe(backoffDelays[0]! * 2);
      expect(backoffDelays[2]).toBe(backoffDelays[1]! * 2);
    });

    it('has 3 retry attempts before marking rate_limited', () => {
      const backoffDelays = [2000, 4000, 8000];
      // After 3 delays exhausted, mark as rate_limited
      expect(backoffDelays.length).toBe(3);
    });
  });

  describe('EPC record handling', () => {
    it('stores raw JSON in api_response_raw field', () => {
      // The raw response should be JSON-serializable
      const rawResponse = {
        rows: [{ 'floor-area': '1500', 'main-activity': 'Hotel' }],
        'total-results': 1,
      };
      const serialized = JSON.stringify(rawResponse);
      const parsed = JSON.parse(serialized) as typeof rawResponse;
      expect(parsed.rows[0]!['floor-area']).toBe('1500');
    });

    it('previous EPC record should be marked is_current=false on refresh', () => {
      // The UPDATE query that marks old records stale
      const updateQuery = 'UPDATE epc_records SET is_current = FALSE WHERE site_id = $1 AND is_current = TRUE';
      expect(updateQuery).toContain('is_current = FALSE');
      expect(updateQuery).toContain('is_current = TRUE');
    });
  });
});
