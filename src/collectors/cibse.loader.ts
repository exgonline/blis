import fs from 'fs';
import path from 'path';
import { pool } from '../db/client';
import { logger } from '../utils/logger';

const SEED_FILE = path.resolve(process.cwd(), 'migrations/002_seed_cibse_benchmarks.sql');

export async function loadCibseBenchmarks(): Promise<void> {
  // Check if data already exists
  const check = await pool.query<{ count: string }>(
    'SELECT COUNT(*) as count FROM cibse_benchmarks',
  );
  const count = parseInt(check.rows[0]?.count ?? '0', 10);

  if (count > 0) {
    logger.info(`CIBSE benchmarks already seeded (${count} rows). Skipping.`);
    return;
  }

  logger.info('Seeding CIBSE benchmarks…');

  const sql = fs.readFileSync(SEED_FILE, 'utf-8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    logger.info('CIBSE benchmarks seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to seed CIBSE benchmarks', {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    client.release();
  }
}
