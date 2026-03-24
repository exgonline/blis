import { runPrecalculateEstimates } from '../jobs/precalculate-estimates.job';
import { runRefreshEpc } from '../jobs/refresh-epc.job';
import { logger } from '../utils/logger';

async function main(): Promise<void> {
  logger.info('Running all jobs once for maintenance/testing');

  logger.info('Running refresh-epc job…');
  await runRefreshEpc();

  logger.info('Running precalculate-estimates job…');
  await runPrecalculateEstimates();

  logger.info('All jobs complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error('Job runner failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
