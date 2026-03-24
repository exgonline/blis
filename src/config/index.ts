import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[BLIS CONFIG] Fatal: required environment variable "${name}" is not set.`);
    process.exit(1);
  }
  return value;
}

function optionalEnv(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalEnvInt(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return fallback;
  return parsed;
}

function optionalEnvBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;
  return value.toLowerCase() === 'true' || value === '1';
}

// Validate DB config: either DATABASE_URL or all individual PG vars must be present
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  const REQUIRED_PG = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'] as const;
  for (const name of REQUIRED_PG) {
    if (!process.env[name]) {
      console.error(`[BLIS CONFIG] Fatal: set DATABASE_URL or individual PG vars (missing "${name}").`);
      process.exit(1);
    }
  }
}

export const config = {
  server: {
    port: optionalEnvInt('PORT', 3001),
    nodeEnv: optionalEnv('NODE_ENV', 'development'),
    apiVersion: optionalEnv('API_VERSION', 'v1'),
    logLevel: optionalEnv('LOG_LEVEL', 'info'),
  },
  db: {
    // When DATABASE_URL is set (e.g. Render), it takes precedence over individual vars.
    connectionString: databaseUrl,
    host: process.env['PGHOST'],
    port: optionalEnvInt('PGPORT', 5432),
    database: process.env['PGDATABASE'],
    user: process.env['PGUSER'],
    password: process.env['PGPASSWORD'],
    ssl: optionalEnvBool('PGSSL', false),
    poolMin: optionalEnvInt('BLIS_DB_POOL_MIN', 2),
    poolMax: optionalEnvInt('BLIS_DB_POOL_MAX', 10),
    retryCount: optionalEnvInt('BLIS_DB_RETRY_COUNT', 3),
  },
  epc: {
    apiEmail: requireEnv('EPC_API_EMAIL'),
    apiKey: requireEnv('EPC_API_KEY'),
    baseUrl: optionalEnv('EPC_API_BASE_URL', 'https://epc.opendatacommunities.org/api/v1/non-domestic'),
    requestDelayMs: optionalEnvInt('BLIS_EPC_REQUEST_DELAY_MS', 200),
    timeoutMs: optionalEnvInt('BLIS_EPC_TIMEOUT_MS', 10000),
  },
  blis: {
    batchSize: optionalEnvInt('BLIS_BATCH_SIZE', 20),
  },
} as const;

export type Config = typeof config;
