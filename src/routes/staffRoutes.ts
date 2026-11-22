import { Router } from 'express';
import {
  registerCustomer,
  getCustomers,
  getCustomerById,
  getAccountById,
  getAllTransactions,
  flagTransaction,
  getRequests,
  getLoans,
  reviewLoan,
} from '../controllers/staffController';
import { authenticate, authorizeRoles } from '../middlewares/authMiddleware';

const router = Router();

// Staff routes accessible to STAFF and ADMIN
router.use(authenticate, authorizeRoles('STAFF', 'ADMIN'));

router.post('/register-customer', registerCustomer);
router.get('/customers', getCustomers);
router.get('/customers/:id', getCustomerById);
router.get('/accounts/:id', getAccountById);
router.get('/transactions', getAllTransactions);
router.patch('/transactions/:id/flag', flagTransaction);
router.get('/requests', getRequests);
router.get('/loans', getLoans);
router.patch('/loans/:id/review', reviewLoan);

export default router;
