import { Router } from 'express';
import {
  getAnalytics,
  getCustomers,
  updateCustomerStatus,
  getAccounts,
  createAccount,
  updateAccountStatus,
  updateAccountLimits,
  reviewRequest,
  reviewLoanDecision,
} from '../controllers/adminController';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// Strictly Admin-only routes
router.use(authenticate, authorizeRoles('ADMIN'));

router.get('/analytics', getAnalytics);
router.get('/customers', getCustomers);
router.patch('/customers/:id/status', updateCustomerStatus);
router.get('/accounts', getAccounts);
router.post('/accounts', createAccount);
router.patch('/accounts/:id/status', updateAccountStatus);
router.patch('/accounts/:id/limits', updateAccountLimits);
router.patch('/requests/:id/review', reviewRequest);
router.patch('/loans/:id/decision', reviewLoanDecision);

export default router;
