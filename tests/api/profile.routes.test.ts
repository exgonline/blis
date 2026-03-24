import express, { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import profileRouter from '../../src/api/routes/profile.routes';

// Mock DB and service layer
jest.mock('../../src/db/client', () => ({
  pool: { query: jest.fn() },
}));

jest.mock('../../src/services/building-profile.service', () => ({
  buildingProfileService: {
    registerSite: jest.fn(),
    getProfile: jest.fn(),
    getEpcRecord: jest.fn(),
    triggerEpcRefresh: jest.fn(),
  },
}));

jest.mock('../../src/collectors/epc.collector', () => ({
  fetchEpcForSite: jest.fn(),
  mapMainActivityToBuildingType: jest.fn(),
}));

import { buildingProfileService } from '../../src/services/building-profile.service';

const mockedService = buildingProfileService as jest.Mocked<typeof buildingProfileService>;

// Build a minimal Express app with auth bypassed for these route tests
function buildAppWithAuth(authenticated: boolean) {
  const app = express();
  app.use(express.json());

  if (authenticated) {
    // Inject a fake auth middleware that always passes
    app.use((_req: Request, _res: Response, next: NextFunction) => next());
  } else {
    // Inject a fake auth middleware that always rejects
    app.use((_req: Request, res: Response) => {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Missing or invalid API key',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
    });
  }

  app.use('/v1/profile', profileRouter);
  return app;
}

describe('POST /v1/profile', () => {
  beforeEach(() => jest.clearAllMocks());

  const validPayload = {
    siteId: 'test-site-001',
    address: '1 Example Street, London',
    postcode: 'SW1A 1AA',
  };

  it('returns 201 and profile when registration succeeds', async () => {
    const mockProfile = { siteId: 'test-site-001', buildingType: 'unknown' };
    mockedService.registerSite.mockResolvedValueOnce(mockProfile as never);

    const app = buildAppWithAuth(true);
    const res = await request(app).post('/v1/profile').send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.siteId).toBe('test-site-001');
  });

  it('returns 400 when siteId contains invalid characters', async () => {
    const app = buildAppWithAuth(true);
    const res = await request(app)
      .post('/v1/profile')
      .send({ ...validPayload, siteId: 'site with spaces!' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when siteId exceeds 100 characters', async () => {
    const app = buildAppWithAuth(true);
    const res = await request(app)
      .post('/v1/profile')
      .send({ ...validPayload, siteId: 'a'.repeat(101) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid UK postcode', async () => {
    const app = buildAppWithAuth(true);
    const res = await request(app)
      .post('/v1/profile')
      .send({ ...validPayload, postcode: 'NOT-A-POSTCODE' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION_ERROR');
  });

  it('returns 409 when siteId already exists', async () => {
    const conflictError = Object.assign(new Error('Site test-site-001 already exists'), {
      code: 'CONFLICT',
    });
    mockedService.registerSite.mockRejectedValueOnce(conflictError);

    const app = buildAppWithAuth(true);

    // Add error middleware
    const appWithError = express();
    appWithError.use(express.json());
    appWithError.use((_req: Request, _res: Response, next: NextFunction) => next());
    appWithError.use('/v1/profile', profileRouter);
    appWithError.use((err: Error & { code?: string }, _req: Request, res: Response, _next: NextFunction) => {
      const statusMap: Record<string, number> = { CONFLICT: 409, NOT_FOUND: 404 };
      const status = statusMap[err.code ?? ''] ?? 500;
      res.status(status).json({ error: err.code ?? 'INTERNAL_ERROR', message: err.message, statusCode: status, timestamp: new Date().toISOString() });
    });

    const res = await request(appWithError).post('/v1/profile').send(validPayload);
    expect(res.status).toBe(409);
  });

  it('returns 400 when required fields are missing', async () => {
    const app = buildAppWithAuth(true);
    const res = await request(app)
      .post('/v1/profile')
      .send({ siteId: 'test-001' }); // missing address and postcode

    expect(res.status).toBe(400);
  });
});

describe('GET /v1/profile/:siteId', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 for unknown siteId', async () => {
    mockedService.getProfile.mockResolvedValueOnce(null);
    const app = buildAppWithAuth(true);
    const res = await request(app).get('/v1/profile/nonexistent-site');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('NOT_FOUND');
  });

  it('returns 200 with profile for known siteId', async () => {
    const mockProfile = { siteId: 'known-site', buildingType: 'hotel' };
    mockedService.getProfile.mockResolvedValueOnce(mockProfile as never);
    const app = buildAppWithAuth(true);
    const res = await request(app).get('/v1/profile/known-site');

    expect(res.status).toBe(200);
    expect(res.body.siteId).toBe('known-site');
  });
});

describe('Authentication', () => {
  it('returns 401 without valid API key', async () => {
    const app = buildAppWithAuth(false);
    const res = await request(app).get('/v1/profile/any-site');

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('UNAUTHORIZED');
  });
});
