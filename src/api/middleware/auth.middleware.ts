import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { pool } from '../../db/client';
import { logger } from '../../utils/logger';

const API_KEY_HEADER = 'x-blis-api-key';

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const rawKey = req.headers[API_KEY_HEADER];

  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid API key',
      statusCode: 401,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  // SHA-256 hash the raw key — never log or store the raw value
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

  try {
    const result = await pool.query<{ id: string; is_active: boolean }>(
      'SELECT id, is_active FROM api_keys WHERE key_hash = $1 LIMIT 1',
      [keyHash],
    );

    if (result.rows.length === 0 || !result.rows[0]!.is_active) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'Invalid or inactive API key',
        statusCode: 401,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Update last_used_at (fire-and-forget)
    const keyId = result.rows[0]!.id;
    pool
      .query('UPDATE api_keys SET last_used_at = NOW() WHERE id = $1', [keyId])
      .catch((err: unknown) => {
        logger.warn('Failed to update last_used_at for API key', {
          error: err instanceof Error ? err.message : String(err),
        });
      });

    next();
  } catch (err) {
    logger.error('Auth middleware error', {
      error: err instanceof Error ? err.message : String(err),
    });
    next(err);
  }
}
