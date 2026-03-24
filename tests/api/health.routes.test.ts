import express from 'express';
import request from 'supertest';
import healthRouter from '../../src/api/routes/health.routes';

// Mock the DB client
jest.mock('../../src/db/client', () => ({
  pool: { query: jest.fn() },
  testConnection: jest.fn(),
}));

import { testConnection } from '../../src/db/client';

const mockedTestConnection = testConnection as jest.MockedFunction<typeof testConnection>;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/v1/health', healthRouter);
  return app;
}

describe('GET /v1/health', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with status ok when DB is connected', async () => {
    mockedTestConnection.mockResolvedValueOnce(5);
    const app = buildApp();
    const res = await request(app).get('/v1/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db.connected).toBe(true);
  });

  it('includes db latencyMs when connection succeeds', async () => {
    mockedTestConnection.mockResolvedValueOnce(12);
    const app = buildApp();
    const res = await request(app).get('/v1/health');

    expect(res.body.db.latencyMs).toBe(12);
  });

  it('returns 503 with status degraded when DB is not connected', async () => {
    mockedTestConnection.mockRejectedValueOnce(new Error('Connection refused'));
    const app = buildApp();
    const res = await request(app).get('/v1/health');

    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
    expect(res.body.db.connected).toBe(false);
  });

  it('returns timestamp in ISO8601 format', async () => {
    mockedTestConnection.mockResolvedValueOnce(3);
    const app = buildApp();
    const res = await request(app).get('/v1/health');

    expect(res.body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('returns version field', async () => {
    mockedTestConnection.mockResolvedValueOnce(3);
    const app = buildApp();
    const res = await request(app).get('/v1/health');

    expect(res.body.version).toBeDefined();
    expect(typeof res.body.version).toBe('string');
  });

  it('does not require authentication', async () => {
    // Health endpoint has no auth middleware — this test verifies no 401 is returned
    mockedTestConnection.mockResolvedValueOnce(2);
    const app = buildApp();
    const res = await request(app)
      .get('/v1/health')
      // Deliberately omit X-BLIS-API-Key header
      ;
    expect(res.status).not.toBe(401);
  });
});
