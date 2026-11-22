import { Router } from 'express';
import authRoutes from './authRoutes';
import customerRoutes from './customerRoutes';
import staffRoutes from './staffRoutes';
import adminRoutes from './adminRoutes';

const router = Router();

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Digital Banking API',
  });
});

router.use('/auth', authRoutes);
router.use('/customer', customerRoutes);
router.use('/staff', staffRoutes);
router.use('/admin', adminRoutes);

export default router;
