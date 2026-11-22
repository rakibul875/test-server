import { Router } from 'express';
import {
  getDashboard,
  transferFunds,
  createRequest,
  getRequests,
  getTransactions,
  applyLoan,
  getLoans,
  repayLoan,
  getNotifications,
  markNotificationRead,
} from '../controllers/customerController';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// Protect all customer routes
router.use(authenticate, authorizeRoles('CUSTOMER', 'ADMIN', 'STAFF'));

router.get('/dashboard', getDashboard);
router.post('/transfer', transferFunds);
router.post('/requests', createRequest);
router.get('/requests', getRequests);
router.get('/transactions', getTransactions);
router.post('/loans', applyLoan);
router.get('/loans', getLoans);
router.post('/loans/:id/repay', repayLoan);
router.get('/notifications', getNotifications);
router.patch('/notifications/:id/read', markNotificationRead);

export default router;
