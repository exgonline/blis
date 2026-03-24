import { Router, Request, Response, NextFunction } from 'express';
import { cibseService } from '../../services/cibse.service';

const router = Router();

// GET /cibse/benchmark?category=hotel
router.get(
  '/benchmark',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const category = req.query['category'];

    if (!category || typeof category !== 'string') {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Query parameter "category" is required',
        statusCode: 400,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    try {
      const benchmark = await cibseService.getBenchmark(category);
      res.json(benchmark);
    } catch (err) {
      next(err);
    }
  },
);

// GET /cibse/benchmarks — all benchmarks
router.get(
  '/benchmarks',
  async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const benchmarks = await cibseService.getAllBenchmarks();
      res.json({ count: benchmarks.length, benchmarks });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
