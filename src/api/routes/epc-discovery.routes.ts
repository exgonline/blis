import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { epcDiscoveryService } from '../../services/epc-discovery.service';
import { BuildingAge } from '../../types/index';

const router = Router();

const UK_POSTCODE_REGEX = /^[A-Z]{1,2}[0-9][0-9A-Z]?\s?[0-9][A-Z]{2}$/i;
const SITE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

const registerFromEpcSchema = z.object({
  siteId: z
    .string()
    .min(1)
    .max(100)
    .regex(SITE_ID_REGEX, 'siteId must only contain alphanumeric characters, underscores, or hyphens'),
  buildingReference: z.string().min(1).max(50),
  siteName: z.string().max(255).optional(),
  buildingAgeOverride: z.nativeEnum(BuildingAge).optional(),
});

// GET /epc/search?postcode=SW1A+2AA
router.get(
  '/search',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const postcode = req.query['postcode'];

    if (!postcode || typeof postcode !== 'string') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Query parameter "postcode" is required',
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    if (!UK_POSTCODE_REGEX.test(postcode)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid UK postcode format',
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const result = await epcDiscoveryService.searchByPostcode(postcode);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// POST /epc/register
router.post(
  '/register',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const parsed = registerFromEpcSchema.safeParse(req.body);
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
      const result = await epcDiscoveryService.registerFromBuildingReference(parsed.data);
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
