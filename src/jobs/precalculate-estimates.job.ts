import cron from 'node-cron';
import { buildingProfileService } from '../services/building-profile.service';
import { buildingLoadService } from '../services/building-load.service';
import { logger } from '../utils/logger';
import { config } from '../config/index';

async function runPrecalculateEstimates(): Promise<void> {
  logger.info('Starting precalculate-estimates job', { job: 'precalculate-estimates' });
  const start = Date.now();

  const siteIds = await buildingProfileService.getAllSiteIds();
  logger.info(`Processing ${siteIds.length} sites`, { job: 'precalculate-estimates' });

  const batchSize = config.blis.batchSize;
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < siteIds.length; i += batchSize) {
    const batch = siteIds.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map((siteId) =>
        buildingLoadService.calculateEstimate(siteId).catch((err: unknown) => {
          // Re-throw with site context for logging
          throw Object.assign(
            err instanceof Error ? err : new Error(String(err)),
            { siteId },
          );
        }),
      ),
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        successCount++;
      } else {
        failureCount++;
        const reason = result.reason as Error & { siteId?: string };
        logger.warn('Failed to calculate estimate', {
          job: 'precalculate-estimates',
          siteId: reason.siteId,
          error: reason.message,
        });
      }
    }
  }

  const durationMs = Date.now() - start;
  logger.info('Precalculate-estimates job complete', {
    job: 'precalculate-estimates',
    successCount,
    failureCount,
    durationMs,
  });
}

export function startPrecalculateEstimatesJob(): void {
  // Run every 30 minutes at :00 and :30
  cron.schedule('0,30 * * * *', () => {
    runPrecalculateEstimates().catch((err: unknown) => {
      logger.error('Precalculate-estimates job crashed', {
        job: 'precalculate-estimates',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  logger.info('Precalculate-estimates job scheduled (every 30 min)', {
    job: 'precalculate-estimates',
  });
}

export { runPrecalculateEstimates };
