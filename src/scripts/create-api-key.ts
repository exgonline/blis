import crypto from 'crypto';
import { pool } from '../db/client';
import { logger } from '../utils/logger';

function parseArgs(): { appName: string; notes?: string } {
  const args = process.argv.slice(2);
  let appName = '';
  let notes: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--app' && args[i + 1]) {
      appName = args[i + 1]!;
      i++;
    } else if (args[i] === '--notes' && args[i + 1]) {
      notes = args[i + 1];
      i++;
    }
  }

  if (!appName) {
    console.error('Usage: ts-node src/scripts/create-api-key.ts --app "AppName" [--notes "Optional notes"]');
    process.exit(1);
  }

  return { appName, notes };
}

async function createApiKey(): Promise<void> {
  const { appName, notes } = parseArgs();

  // Generate a cryptographically random key (32 bytes = 64 hex chars)
  const rawKey = crypto.randomBytes(32).toString('hex');
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  await pool.query(
    `INSERT INTO api_keys (key_hash, app_name, notes)
     VALUES ($1, $2, $3)`,
    [keyHash, appName, notes ?? null],
  );

  // Print the raw key once — it cannot be recovered after this
  console.log('');
  console.log('======================================================');
  console.log('  API Key Created Successfully');
  console.log('======================================================');
  console.log(`  App Name : ${appName}`);
  console.log(`  API Key  : ${rawKey}`);
  console.log('');
  console.log('  Store this key securely. It will NOT be shown again.');
  console.log('  Pass it as the X-BLIS-API-Key header in requests.');
  console.log('======================================================');
  console.log('');
}

createApiKey()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    logger.error('Failed to create API key', {
      error: err instanceof Error ? err.message : String(err),
    });
    process.exit(1);
  });
