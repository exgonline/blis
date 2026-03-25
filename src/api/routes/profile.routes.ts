import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.middleware';
import { buildingProfileService } from '../../services/building-profile.service';
import { buildingLoadService } from '../../services/building-load.service';
import { BuildingType, BuildingAge } from '../../types/index';
import { logger } from '../../utils/logger';

const router = Router();

const UK_POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
const SITE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

const registerSiteSchema = z.object({
  siteId: z
    .string()
    .min(1)
    .max(100)
    .regex(SITE_ID_REGEX, 'siteId must only contain alphanumeric characters, underscores, or hyphens'),
  siteName: z.string().max(255).optional(),
  address: z.string().min(1).max(500),
  postcode: z
    .string()
    .regex(UK_POSTCODE_REGEX, 'Invalid UK postcode format'),
  uprn: z.string().max(20).optional(),
  buildingTypeOverride: z.nativeEnum(BuildingType).optional(),
  floorAreaOverride: z.number().min(1).max(999999).optional(),
  buildingAgeOverride: z.nativeEnum(BuildingAge).optional(),
});

// GET /profile — list all registered sites, optionally filtered by postcode
router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const postcode = typeof req.query['postcode'] === 'string' ? req.query['postcode'] : undefined;
      const result = await buildingProfileService.listSites(postcode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile — register a new site
router.post(
  '/',
  validate(registerSiteSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await buildingProfileService.registerSite(req.body as z.infer<typeof registerSiteSchema>);
      res.status(201).json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// GET /profile/:siteId — get a building profile
router.get(
  '/:siteId',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const profile = await buildingProfileService.getProfile(req.params['siteId']!);
      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Site ${req.params['siteId']} not found`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// GET /profile/:siteId/epc — get current EPC record
router.get(
  '/:siteId/epc',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const epc = await buildingProfileService.getEpcRecord(req.params['siteId']!);
      if (!epc) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `No EPC record found for site ${req.params['siteId']}`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      res.json(epc);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /profile/:siteId/floor-area — apply a manual floor area override
const floorAreaOverrideSchema = z.object({
  floorAreaM2: z.number().positive().max(500000),
  buildingType: z.nativeEnum(BuildingType).optional(),
  overrideSource: z.string().min(1).max(200),
  notes: z.string().max(500).optional(),
});

router.patch(
  '/:siteId/floor-area',
  validate(floorAreaOverrideSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;
      const body = req.body as z.infer<typeof floorAreaOverrideSchema>;

      const profile = await buildingProfileService.applyFloorAreaOverride(
        siteId,
        body.floorAreaM2,
        body.buildingType,
        body.overrideSource,
      );

      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Site ${siteId} not found`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Trigger a fresh load estimate with the corrected floor area
      buildingLoadService.calculateEstimate(siteId).catch((err: unknown) => {
        logger.warn('Post-override estimate recalculation failed', {
          siteId,
          error: err instanceof Error ? err.message : String(err),
        });
      });

      res.json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /profile/:siteId/grid-connection — store the site's grid connection capacity
const gridConnectionSchema = z.object({
  gridConnectionKw: z.number().positive().max(10000),
});

router.patch(
  '/:siteId/grid-connection',
  validate(gridConnectionSchema, 'body'),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;
      const body = req.body as z.infer<typeof gridConnectionSchema>;

      const profile = await buildingProfileService.updateGridConnection(siteId, body.gridConnectionKw);

      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Site ${siteId} not found`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      res.json(profile);
    } catch (err) {
      next(err);
    }
  },
);

// POST /profile/:siteId/refresh-epc — queue EPC refresh
router.post(
  '/:siteId/refresh-epc',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const siteId = req.params['siteId']!;

      // Verify site exists
      const profile = await buildingProfileService.getProfile(siteId);
      if (!profile) {
        res.status(404).json({
          error: 'NOT_FOUND',
          message: `Site ${siteId} not found`,
          statusCode: 404,
          timestamp: new Date().toISOString(),
        });
        return;
      }

      // Queue asynchronously
      setImmediate(() => {
        buildingProfileService.triggerEpcRefresh(siteId).catch(() => {
          // Logged internally
        });
      });

      res.status(202).json({
        message: `EPC refresh queued for site ${siteId}`,
        siteId,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
