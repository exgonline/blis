import { Router, Request, Response, NextFunction } from 'express';
import { pool } from '../../db/client';
import { buildingLoadService } from '../../services/building-load.service';
import { getSeasonalProfile } from '../../services/seasonal-profile.service';
import type { BuildingLoadEstimate, BuildingProfileRow } from '../../types/index';

const router = Router();

const MAX_AT_OFFSET_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function formatEstimateResponse(
  estimate: BuildingLoadEstimate,
  profile: BuildingProfileRow,
) {
  return {
    siteId: estimate.siteId,
    estimatedAt: estimate.calculatedAt.toISOString(),
    buildingType: profile.building_type_override ?? profile.building_type,
    floorAreaM2: estimate.floorAreaM2,
    annualKwhP75: estimate.annualKwhP75,
    currentEstimate: {
      estimatedKw: estimate.p75Kw,
      estimatedAmpsTotal: estimate.p75Amps,
      estimatedAmpsL1: estimate.l1Amps,
      estimatedAmpsL2: estimate.l2Amps,
      estimatedAmpsL3: estimate.l3Amps,
      hhIndex: estimate.halfHourPeriod,
      elexonSeason: estimate.season,
      dayType: estimate.dayType,
      elexonCoefficient: estimate.elexonCoefficient,
      confidenceLevel: estimate.confidenceLevel,
      safetyMarginApplied: estimate.safetyMarginApplied,
    },
    dataSource: {
      epcFetchedAt: profile.epc_fetched_at ? profile.epc_fetched_at.toISOString() : null,
      annualKwhSource: estimate.confidenceLevel,
      epcRating: profile.epc_rating ?? null,
      floorAreaConfidence: profile.floor_area_confidence,
      dataQualityFlag: profile.data_quality_flag ?? null,
      dataQualityNote: profile.data_quality_note ?? null,
      floorAreaOverrideSource: profile.floor_area_override_source ?? null,
    },
  };
}

// GET /estimate/:siteId
router.get(
  '/:siteId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;

      // Check site exists
      const profileResult = await pool.query<BuildingProfileRow>(
        'SELECT * FROM building_profiles WHERE site_id = $1',
        [siteId],
      );
      if (profileResult.rows.length === 0) {
        res.status(404).json({
          error: 'SITE_NOT_FOUND',
          message: `Site ${siteId} not found`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      const profile = profileResult.rows[0]!;

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
        res.json(formatEstimateResponse(stored, profile));
        return;
      }

      // Calculate fresh
      const estimate = await buildingLoadService.calculateEstimate(siteId, targetDate);
      res.json(formatEstimateResponse(estimate, profile));
    } catch (err) {
      next(err);
    }
  },
);

// GET /estimate/:siteId/seasonal-profile — full seasonal charging availability profile
router.get(
  '/:siteId/seasonal-profile',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;
      const rawGrid = req.query['gridConnectionKw'];
      const rawMargin = req.query['safetyMargin'];

      let gridConnectionKw: number | undefined;
      let safetyMargin: number | undefined;

      if (rawGrid !== undefined) {
        const parsed = Number(rawGrid);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          res.status(422).json({
            error: 'UNPROCESSABLE',
            message: 'gridConnectionKw must be a positive number',
            statusCode: 422,
            timestamp: new Date().toISOString(),
          });
          return;
        }
        gridConnectionKw = parsed;
      }

      if (rawMargin !== undefined) {
        const parsed = Number(rawMargin);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
          res.status(400).json({
            error: 'VALIDATION_ERROR',
            message: 'safetyMargin must be a number between 0 and 1',
            statusCode: 400,
            timestamp: new Date().toISOString(),
          });
          return;
        }
        safetyMargin = parsed;
      }

      const profile = await getSeasonalProfile(siteId, gridConnectionKw, safetyMargin);
      res.json(profile);
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
