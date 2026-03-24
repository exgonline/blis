import winston from 'winston';

const { combine, timestamp, json, colorize, simple } = winston.format;

export interface LogContext {
  requestId?: string;
  siteId?: string;
  job?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  [key: string]: unknown;
}

const isProduction = process.env['NODE_ENV'] === 'production';

export const logger = winston.createLogger({
  level: process.env['LOG_LEVEL'] ?? 'info',
  defaultMeta: { service: 'blis' },
  format: isProduction
    ? combine(timestamp(), json())
    : combine(colorize(), simple()),
  transports: [new winston.transports.Console()],
});

export function createContextLogger(context: LogContext): winston.Logger {
  return logger.child(context);
}
