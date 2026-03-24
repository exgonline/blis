import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { logger } from '../../utils/logger';

interface AppError extends Error {
  code?: string;
  statusCode?: number;
}

function codeToStatusCode(code: string | undefined): number {
  switch (code) {
    case 'VALIDATION_ERROR': return 400;
    case 'UNAUTHORIZED':     return 401;
    case 'NOT_FOUND':        return 404;
    case 'CONFLICT':         return 409;
    case 'UNPROCESSABLE':    return 422;
    default:                 return 500;
  }
}

export function errorMiddleware(
  err: AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  const isProduction = process.env['NODE_ENV'] === 'production';

  if (err instanceof ZodError) {
    const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    res.status(400).json({
      error: 'VALIDATION_ERROR',
      message: `Validation failed: ${issues}`,
      statusCode: 400,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const errorCode = err.code ?? 'INTERNAL_ERROR';
  const statusCode = codeToStatusCode(errorCode);

  if (statusCode >= 500) {
    logger.error('Unhandled server error', {
      method: req.method,
      path: req.path,
      error: err.message,
      stack: err.stack,
    });
  }

  res.status(statusCode).json({
    error: errorCode,
    message: err.message ?? 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    ...(isProduction ? {} : { stack: err.stack }),
  });
}
