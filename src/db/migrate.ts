import fs from 'fs';
import path from 'path';
import { pool } from './client';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

const MIGRATIONS_LOG_DDL = `
  CREATE TABLE IF NOT EXISTS migrations_log (
    id          SERIAL PRIMARY KEY,
    filename    VARCHAR(255) NOT NULL UNIQUE,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(MIGRATIONS_LOG_DDL);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query<{ filename: string }>(
    'SELECT filename FROM migrations_log ORDER BY id ASC',
  );
  return new Set(result.rows.map((r) => r.filename));
}

async function applyMigration(filename: string, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO migrations_log (filename) VALUES ($1)', [filename]);
    await client.query('COMMIT');
    logger.info(`Applied migration: ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function runMigrations(includeSeed = false): Promise<void> {
  logger.info('Running database migrations…');
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const filename of files) {
    if (applied.has(filename)) {
      logger.debug(`Skipping already applied migration: ${filename}`);
      continue;
    }

    // Skip seed migrations unless explicitly requested
    if (!includeSeed && filename.startsWith('002_') || !includeSeed && filename.startsWith('003_')) {
      logger.debug(`Skipping seed migration (use --seed flag): ${filename}`);
      continue;
    }

    const filePath = path.join(MIGRATIONS_DIR, filename);
    await applyMigration(filename, filePath);
  }

  logger.info('Migrations complete.');
}

// Allow direct invocation: ts-node src/db/migrate.ts [--seed]
if (require.main === module) {
  const includeSeed = process.argv.includes('--seed');
  runMigrations(includeSeed)
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      logger.error('Migration failed', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    });
}
