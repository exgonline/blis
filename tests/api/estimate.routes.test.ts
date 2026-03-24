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

import { buildingLoadService } from '../../src/services/building-load.service';

const mockedService = buildingLoadService as jest.Mocked<typeof buildingLoadService>;

function buildApp() {
  const app = express();
  app.use(express.json());
  // Skip auth for route tests
  app.use((_req: Request, _res: Response, next: NextFunction) => next());
  app.use('/v1/estimate', estimateRouter);
  // Simple error middleware
  app.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
    const statusMap: Record<string, number> = {
      UNPROCESSABLE: 422, NOT_FOUND: 404, VALIDATION_ERROR: 400,
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

const mockEstimate = {
  siteId: 'test-site',
  calculatedAt: new Date(),
  validFrom: new Date(),
  validUntil: new Date(Date.now() + 30 * 60 * 1000),
  halfHourPeriod: 16,
  season: 'spring',
  dayType: 'weekday',
  centralKw: 42.5,
  p75Kw: 48.9,
  centralAmps: 64.8,
  p75Amps: 74.5,
  l1Amps: 25.2,
  l2Amps: 23.8,
  l3Amps: 23.8,
  floorAreaM2: 1500,
  profileClass: 3,
  confidenceLevel: 'EPC_DERIVED',
  annualKwhP75: 276000,
};

describe('GET /v1/estimate/:siteId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns cached estimate when valid stored estimate exists', async () => {
    mockedService.getStoredEstimate.mockResolvedValueOnce(mockEstimate);
    const app = buildApp();
    const res = await request(app).get('/v1/estimate/test-site');

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(true);
    expect(res.body.centralKw).toBe(42.5);
    expect(mockedService.calculateEstimate).not.toHaveBeenCalled();
  });

  it('calculates fresh estimate when no valid stored estimate exists', async () => {
    mockedService.getStoredEstimate.mockResolvedValueOnce(null);
    mockedService.calculateEstimate.mockResolvedValueOnce(mockEstimate);
    const app = buildApp();
    const res = await request(app).get('/v1/estimate/test-site');

    expect(res.status).toBe(200);
    expect(res.body.cached).toBe(false);
    expect(mockedService.calculateEstimate).toHaveBeenCalledTimes(1);
  });

  it('respects the "at" query parameter', async () => {
    const futureDate = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 hours from now
    mockedService.getStoredEstimate.mockResolvedValueOnce(null);
    mockedService.calculateEstimate.mockResolvedValueOnce({ ...mockEstimate, halfHourPeriod: 20 });
    const app = buildApp();
    const res = await request(app).get(`/v1/estimate/test-site?at=${encodeURIComponent(futureDate)}`);

    expect(res.status).toBe(200);
    // calculateEstimate should be called with a Date near futureDate
    const callArg = mockedService.calculateEstimate.mock.calls[0]?.[1];
    expect(callArg).toBeInstanceOf(Date);
  });

  it('returns 400 for invalid "at" parameter', async () => {
    const app = buildApp();
    const res = await request(app).get('/v1/estimate/test-site?at=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when "at" is more than 7 days in the future', async () => {
    const farFuture = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString();
    const app = buildApp();
    const res = await request(app).get(`/v1/estimate/test-site?at=${encodeURIComponent(farFuture)}`);
    expect(res.status).toBe(400);
  });

  it('returns 422 when floor area is missing', async () => {
    mockedService.getStoredEstimate.mockResolvedValueOnce(null);
    const unprocessableError = Object.assign(
      new Error('Floor area not available for site test-site — cannot calculate estimate'),
      { code: 'UNPROCESSABLE' },
    );
    mockedService.calculateEstimate.mockRejectedValueOnce(unprocessableError);

    const app = buildApp();
    const res = await request(app).get('/v1/estimate/test-site');
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('UNPROCESSABLE');
  });
});

describe('GET /v1/estimate/:siteId/forecast', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns exactly 48 periods', async () => {
    const forecast = Array(48).fill(mockEstimate);
    mockedService.getForecast.mockResolvedValueOnce(forecast);
    const app = buildApp();
    const res = await request(app).get('/v1/estimate/test-site/forecast');

    expect(res.status).toBe(200);
    expect(res.body.periods).toBe(48);
    expect(res.body.forecast).toHaveLength(48);
  });
});
