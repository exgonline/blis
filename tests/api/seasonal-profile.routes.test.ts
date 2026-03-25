import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import estimateRouter from '../../src/api/routes/estimate.routes';

jest.mock('../../src/db/client', () => ({
  pool: { query: jest.fn() },
}));

jest.mock('../../src/services/building-load.service', () => ({
  buildingLoadService: {
    getStoredEstimate: jest.fn(),
    calculateEstimate: jest.fn(),
    getForecast: jest.fn(),
  },
}));

jest.mock('../../src/services/seasonal-profile.service', () => ({
  getSeasonalProfile: jest.fn(),
}));

import { getSeasonalProfile } from '../../src/services/seasonal-profile.service';

const mockedGetProfile = getSeasonalProfile as jest.MockedFunction<typeof getSeasonalProfile>;

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeHalfHourlyProfile() {
  return Array.from({ length: 48 }, (_, i) => ({
    hhIndex: i,
    timeStart: `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 === 0 ? '00' : '30'}`,
    elexonCoefficient: 0.000020,
    estimatedBuildingKw: 5.2,
    availableChargingKw: 74.8,
    usableChargingKwh: 34.41,
    flexibilityDispatchableKw: 48.62,
  }));
}

function makeSeasonProfile() {
  return {
    weekday: { halfHourlyProfile: makeHalfHourlyProfile() },
    saturday: { halfHourlyProfile: makeHalfHourlyProfile() },
    sunday: { halfHourlyProfile: makeHalfHourlyProfile() },
  };
}

const mockSeasonalProfile = {
  siteId: 'gz-170159',
  cachedAt: null,
  generatedInMs: 42,
  gridConnectionKw: 100,
  safetyMargin: 0.15,
  annualKwhP75: 1167601,
  seasons: {
    winter: makeSeasonProfile(),
    spring: makeSeasonProfile(),
    summer: makeSeasonProfile(),
    high_summer: makeSeasonProfile(),
  },
  summary: {
    bestChargingWindow: {
      startHhIndex: 0,
      endHhIndex: 3,
      startTime: '00:00',
      endTime: '02:00',
      averageAvailableChargingKw: 74.8,
    },
    worstChargingWindow: {
      startHhIndex: 32,
      endHhIndex: 35,
      startTime: '16:00',
      endTime: '18:00',
      averageAvailableChargingKw: 10.2,
    },
    totalAnnualUsableChargingKwh: 601932,
    averageDailyUsableChargingKwh: 1649.13,
    flexibilityAssetMw: 0.044,
  },
};

// ─── App setup ────────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((_req: Request, _res: Response, next: NextFunction) => next()); // skip auth
  app.use('/v1/estimate', estimateRouter);
  app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const statusMap: Record<string, number> = {
      UNPROCESSABLE: 422,
      NOT_FOUND: 404,
      VALIDATION_ERROR: 400,
      ELEXON_MISSING: 500,
    };
    const status = statusMap[err.code ?? ''] ?? 500;
    res.status(status).json({
      error: err.code ?? 'INTERNAL_ERROR',
      message: err.message,
      statusCode: status,
      timestamp: new Date().toISOString(),
    });
  });
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /v1/estimate/:siteId/seasonal-profile', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with full seasonal profile for a known site', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(res.body.siteId).toBe('gz-170159');
    expect(res.body.gridConnectionKw).toBe(100);
    expect(res.body.safetyMargin).toBe(0.15);
    expect(res.body.annualKwhP75).toBe(1167601);
    expect(res.body.cachedAt).toBeNull();
  });

  it('response includes seasons object with winter.weekday.halfHourlyProfile of 48 entries', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(res.body.seasons).toBeDefined();
    expect(res.body.seasons.winter).toBeDefined();
    expect(res.body.seasons.winter.weekday).toBeDefined();
    expect(res.body.seasons.winter.weekday.halfHourlyProfile).toHaveLength(48);
  });

  it('response includes all four seasons', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(res.body.seasons.winter).toBeDefined();
    expect(res.body.seasons.spring).toBeDefined();
    expect(res.body.seasons.summer).toBeDefined();
    expect(res.body.seasons.high_summer).toBeDefined();
  });

  it('response includes summary with charging windows and annual totals', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.bestChargingWindow).toBeDefined();
    expect(res.body.summary.worstChargingWindow).toBeDefined();
    expect(typeof res.body.summary.totalAnnualUsableChargingKwh).toBe('number');
    expect(typeof res.body.summary.averageDailyUsableChargingKwh).toBe('number');
    expect(typeof res.body.summary.flexibilityAssetMw).toBe('number');
  });

  it('forwards gridConnectionKw query param to the service', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile?gridConnectionKw=200')
      .expect(200);

    expect(mockedGetProfile).toHaveBeenCalledWith('gz-170159', 200, undefined);
  });

  it('forwards safetyMargin query param to the service', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile?safetyMargin=0.20')
      .expect(200);

    expect(mockedGetProfile).toHaveBeenCalledWith('gz-170159', undefined, 0.20);
  });

  it('returns 422 when gridConnectionKw is zero', async () => {
    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile?gridConnectionKw=0')
      .expect(422);

    expect(res.body.error).toBe('UNPROCESSABLE');
  });

  it('returns 422 when gridConnectionKw is negative', async () => {
    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile?gridConnectionKw=-50')
      .expect(422);

    expect(res.body.error).toBe('UNPROCESSABLE');
  });

  it('returns 400 when safetyMargin is out of range', async () => {
    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile?safetyMargin=1.5')
      .expect(400);

    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 404 when site not found', async () => {
    mockedGetProfile.mockRejectedValueOnce(
      Object.assign(new Error('Site unknown-site not found'), { code: 'NOT_FOUND' }),
    );

    const res = await request(buildApp())
      .get('/v1/estimate/unknown-site/seasonal-profile')
      .expect(404);

    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns 422 when site has no annual_kwh_p75 yet', async () => {
    mockedGetProfile.mockRejectedValueOnce(
      Object.assign(new Error('annual_kwh_p75 not available'), { code: 'UNPROCESSABLE' }),
    );

    const res = await request(buildApp())
      .get('/v1/estimate/new-site/seasonal-profile')
      .expect(422);

    expect(res.body.error).toBe('UNPROCESSABLE');
  });

  it('returns 500 when Elexon profile data is missing', async () => {
    mockedGetProfile.mockRejectedValueOnce(
      Object.assign(new Error('No Elexon profile data found for profile class 9'), {
        code: 'ELEXON_MISSING',
      }),
    );

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(500);

    expect(res.body.error).toBe('ELEXON_MISSING');
  });

  it('returns cachedAt timestamp when result comes from cache', async () => {
    const cachedProfile = { ...mockSeasonalProfile, cachedAt: '2026-03-25T10:00:00.000Z' };
    mockedGetProfile.mockResolvedValueOnce(cachedProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(res.body.cachedAt).toBe('2026-03-25T10:00:00.000Z');
  });

  it('includes generatedInMs in the response', async () => {
    mockedGetProfile.mockResolvedValueOnce(mockSeasonalProfile);

    const res = await request(buildApp())
      .get('/v1/estimate/gz-170159/seasonal-profile')
      .expect(200);

    expect(typeof res.body.generatedInMs).toBe('number');
  });
});
