import cron from 'node-cron';
import { buildingProfileService } from '../services/building-profile.service';
import { logger } from '../utils/logger';
import { config } from '../config/index';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runRefreshEpc(): Promise<void> {
  logger.info('Starting refresh-epc job', { job: 'refresh-epc' });
  const start = Date.now();

  const siteIds = await buildingProfileService.getSitesNeedingEpcRefresh();
  logger.info(`Found ${siteIds.length} sites needing EPC refresh`, { job: 'refresh-epc' });

  let successCount = 0;
  let failureCount = 0;

  for (const siteId of siteIds) {
    try {
      await buildingProfileService.triggerEpcRefresh(siteId);
      successCount++;
    } catch (err) {
      failureCount++;
      logger.warn('EPC refresh failed for site', {
        job: 'refresh-epc',
        siteId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Respect EPC API rate limiting
    await sleep(config.epc.requestDelayMs);
  }

  const durationMs = Date.now() - start;
  logger.info('Refresh-epc job complete', {
    job: 'refresh-epc',
    successCount,
    failureCount,
    durationMs,
  });
}

export function startRefreshEpcJob(): void {
  // Run at 02:00 every Sunday
  cron.schedule('0 2 * * 0', () => {
    runRefreshEpc().catch((err: unknown) => {
      logger.error('Refresh-epc job crashed', {
        job: 'refresh-epc',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  logger.info('Refresh-epc job scheduled (Sunday 02:00)', { job: 'refresh-epc' });
}

export { runRefreshEpc };
