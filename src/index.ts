import 'dotenv/config';
import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { config } from './config/index';
import { logger } from './utils/logger';
import { pool, testConnection } from './db/client';
import { runMigrations } from './db/migrate';
import { loadCibseBenchmarks } from './collectors/cibse.loader';
import { loadElexonProfiles } from './collectors/elexon.loader';
import { errorMiddleware } from './api/middleware/error.middleware';
import apiRouter from './api/router';
import { startPrecalculateEstimatesJob } from './jobs/precalculate-estimates.job';
import { startRefreshEpcJob } from './jobs/refresh-epc.job';

async function bootstrap(): Promise<void> {
  // 1. Verify DB connection with retry
  let connected = false;
  for (let attempt = 1; attempt <= config.db.retryCount; attempt++) {
    try {
      await testConnection();
      connected = true;
      logger.info('Database connection established');
      break;
    } catch (err) {
      logger.warn(`DB connection attempt ${attempt}/${config.db.retryCount} failed`, {
        error: err instanceof Error ? err.message : String(err),
      });
      if (attempt < config.db.retryCount) {
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
  }

  if (!connected) {
    logger.error('Failed to connect to database after retries. Exiting.');
    process.exit(1);
  }

  // 2. Run migrations (schema only — seeds handled separately)
  await runMigrations(false);

  // 3. Seed reference data
  await loadCibseBenchmarks();
  await loadElexonProfiles();

  // 4. Create Express app
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));

  // Request logging middleware with requestId
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { requestId: string }).requestId = crypto.randomUUID();
    logger.info('HTTP request', {
      requestId: (req as Request & { requestId: string }).requestId,
      method: req.method,
      path: req.path,
    });
    next();
  });

  // 5. Mount router under /v1
  app.use(`/${config.server.apiVersion}`, apiRouter);

  // 6. 404 handler for unknown routes
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: 'Route not found',
      statusCode: 404,
      timestamp: new Date().toISOString(),
    });
  });

  // 7. Error middleware (must be last)
  app.use(errorMiddleware);

  // 8. Start cron jobs
  startPrecalculateEstimatesJob();
  startRefreshEpcJob();

  // 9. Listen
  const port = config.server.port;
  app.listen(port, () => {
    logger.info(`BLIS service started`, {
      port,
      nodeEnv: config.server.nodeEnv,
      apiVersion: config.server.apiVersion,
    });
  });

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`Received ${signal}, shutting down gracefully…`);
    await pool.end();
    logger.info('Database pool closed. Goodbye.');
    process.exit(0);
  };

  process.on('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });
  process.on('SIGINT',  () => { shutdown('SIGINT').catch(() => process.exit(1)); });
}

bootstrap().catch((err: unknown) => {
  logger.error('Fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
