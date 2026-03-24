import { Pool } from 'pg';
import { config } from '../config/index';
import { logger } from '../utils/logger';

const sslConfig = config.db.ssl
  ? { rejectUnauthorized: false }
  : false;

// Use DATABASE_URL (Render) when available, otherwise individual PG vars
export const pool = config.db.connectionString
  ? new Pool({
      connectionString: config.db.connectionString,
      ssl: sslConfig,
      min: config.db.poolMin,
      max: config.db.poolMax,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    })
  : new Pool({
      host: config.db.host,
      port: config.db.port,
      database: config.db.database,
      user: config.db.user,
      password: config.db.password,
      ssl: sslConfig,
      min: config.db.poolMin,
      max: config.db.poolMax,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });

pool.on('error', (err) => {
  logger.error('Unexpected error on idle pg client', { error: err.message });
});

export async function testConnection(): Promise<number> {
  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return Date.now() - start;
  } finally {
    client.release();
  }
}
