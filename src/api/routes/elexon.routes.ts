import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { elexonService } from '../../services/elexon.service';
import { ElexonSeason, DayType } from '../../types/index';

const router = Router();

const coefficientQuerySchema = z.object({
  profileClass: z.coerce.number().int().min(1).max(8),
  season: z.nativeEnum(ElexonSeason),
  dayType: z.nativeEnum(DayType),
  period: z.coerce.number().int().min(0).max(47),
});

const profileQuerySchema = z.object({
  profileClass: z.coerce.number().int().min(1).max(8),
  season: z.nativeEnum(ElexonSeason),
  dayType: z.nativeEnum(DayType),
});

// GET /elexon/coefficient
router.get(
  '/coefficient',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = coefficientQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const { profileClass, season, dayType, period } = parsed.data;
      const row = await elexonService.getCoefficient(profileClass, season, dayType, period);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

// GET /elexon/profile
router.get(
  '/profile',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = profileQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: `Validation failed: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const { profileClass, season, dayType } = parsed.data;
      const rows = await elexonService.getProfile(profileClass, season, dayType);
      res.json({ profileClass, season, dayType, periods: rows.length, data: rows });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
