import { Router } from 'express';
import authRoutes from './authRoutes';

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Digital Banking API',
  });
});

router.use('/auth', authRoutes);

export default router;
