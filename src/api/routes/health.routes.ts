import { Router, Request, Response } from 'express';
import { testConnection } from '../../db/client';
import type { HealthResponse } from '../../types/index';

const router = Router();

router.get('/', async (_req: Request, res: Response): Promise<void> => {
  let dbConnected = false;
  let latencyMs: number | undefined;

  try {
    latencyMs = await testConnection();
    dbConnected = true;
  } catch {
    dbConnected = false;
  }

  const status = dbConnected ? 'ok' : 'degraded';
  const body: HealthResponse = {
    status,
    timestamp: new Date().toISOString(),
    version: process.env['npm_package_version'] ?? '2.0.0',
    db: {
      connected: dbConnected,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    },
  };

  res.status(dbConnected ? 200 : 503).json(body);
});

export default router;
