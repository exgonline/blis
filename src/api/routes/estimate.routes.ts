import { Router, Request, Response, NextFunction } from 'express';
import { buildingLoadService } from '../../services/building-load.service';

const router = Router();

const MAX_AT_OFFSET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// GET /estimate/:siteId
router.get(
  '/:siteId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;

      let targetDate: Date | undefined;

      if (req.query['at']) {
        const parsed = new Date(req.query['at'] as string);
        if (isNaN(parsed.getTime())) {
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'Invalid "at" parameter — must be ISO8601',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        const now = Date.now();
        const diff = Math.abs(parsed.getTime() - now);
        if (diff > MAX_AT_OFFSET_MS) {
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'The "at" parameter must be within 7 days of now',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
          return;
        }

        targetDate = parsed;
      }

      // Try stored estimate first
      const stored = await buildingLoadService.getStoredEstimate(siteId, targetDate);
      if (stored) {
        res.json({ ...stored, cached: true });
        return;
      }

      // Calculate fresh
      const estimate = await buildingLoadService.calculateEstimate(siteId, targetDate);
      res.json({ ...estimate, cached: false });
    } catch (err) {
      next(err);
    }
  },
);

// GET /estimate/:siteId/forecast — 48 half-hour periods from now
router.get(
  '/:siteId/forecast',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;
      const forecast = await buildingLoadService.getForecast(siteId);
      res.json({ siteId, periods: forecast.length, forecast });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
