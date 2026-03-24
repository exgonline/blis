import { Router } from 'express';
import { authMiddleware } from './middleware/auth.middleware';
import healthRouter from './routes/health.routes';
import profileRouter from './routes/profile.routes';
import estimateRouter from './routes/estimate.routes';
import elexonRouter from './routes/elexon.routes';
import cibseRouter from './routes/cibse.routes';

const router = Router();

// Health check — no authentication required
router.use('/health', healthRouter);

// All other routes require authentication
router.use('/profile', authMiddleware, profileRouter);
router.use('/estimate', authMiddleware, estimateRouter);
router.use('/elexon', authMiddleware, elexonRouter);
router.use('/cibse', authMiddleware, cibseRouter);

export default router;
