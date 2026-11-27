import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { User, UserStatus } from '../models/User';
import { BankAccount, AccountStatus, AccountType } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { Request } from '../models/Request';
import { Loan } from '../models/Loan';
import { Notification } from '../models/Notification';
import {
  executeTransaction,
  generateAccountNumber,
  generateTransactionRef,
} from '../utils/helpers';

/**
 * 1. Comprehensive System Analytics & Real Chart Data
 */
export const getAnalytics = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const [
      totalCustomers,
      totalStaff,
      totalAccounts,
      accounts,
      transactions,
      pendingLoansCount,
      activeLoans,
      pendingRequestsCount,
      flaggedTransactionsCount,
    ] = await Promise.all([
      User.countDocuments({ role: 'CUSTOMER' }),
      User.countDocuments({ role: 'STAFF' }),
      BankAccount.countDocuments({}),
      BankAccount.find({}),
      Transaction.find({ status: 'COMPLETED' }),
      Loan.countDocuments({ status: { $in: ['PENDING', 'UNDER_REVIEW'] } }),
      Loan.find({ status: 'ACTIVE' }),
      Request.countDocuments({ status: 'PENDING' }),
      Transaction.countDocuments({ isFlagged: true }),
    ]);

    // Compute Bank Liquidity
    const totalBankBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

    // Compute Deposit vs Withdrawal Totals
    let totalDeposits = 0;
    let totalWithdrawals = 0;

    transactions.forEach((t) => {
      if (t.transactionType === 'DEPOSIT' || t.transactionType === 'LOAN_DISBURSEMENT') {
        totalDeposits += t.amount;
      } else if (t.transactionType === 'WITHDRAWAL' || t.transactionType === 'LOAN_REPAYMENT') {
        totalWithdrawals += t.amount;
      }
    });

    const totalActiveLoanDebt = activeLoans.reduce((sum, l) => sum + l.remainingBalance, 0);

    // 1. Monthly Volume Chart Data (past 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const monthlyMap: {
      [key: string]: {
        month: string;
        deposits: number;
        withdrawals: number;
        transfers: number;
        volume: number;
      };
    } = {};

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthlyMap[key] = {
        month: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
        deposits: 0,
        withdrawals: 0,
        transfers: 0,
        volume: 0,
      };
    }

    transactions.forEach((t) => {
      const d = new Date(t.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthlyMap[key]) {
        monthlyMap[key].volume += t.amount;
        if (t.transactionType === 'DEPOSIT' || t.transactionType === 'LOAN_DISBURSEMENT') {
          monthlyMap[key].deposits += t.amount;
        } else if (t.transactionType === 'WITHDRAWAL' || t.transactionType === 'LOAN_REPAYMENT') {
          monthlyMap[key].withdrawals += t.amount;
        } else if (t.transactionType === 'TRANSFER') {
          monthlyMap[key].transfers += t.amount;
        }
      }
    });

    const monthlyVolume = Object.values(monthlyMap);

    // 2. Account Distribution Chart Data
    const accountDistributionMap: { [key: string]: { count: number; totalBalance: number } } = {
      SAVINGS: { count: 0, totalBalance: 0 },
      CHECKING: { count: 0, totalBalance: 0 },
      CURRENT: { count: 0, totalBalance: 0 },
      BUSINESS: { count: 0, totalBalance: 0 },
    };

    accounts.forEach((acc) => {
      const type = acc.accountType || 'SAVINGS';
      if (!accountDistributionMap[type]) {
        accountDistributionMap[type] = { count: 0, totalBalance: 0 };
      }
      accountDistributionMap[type].count += 1;
      accountDistributionMap[type].totalBalance += acc.balance || 0;
    });

    const accountDistribution = Object.keys(accountDistributionMap).map((type) => ({
      type,
      count: accountDistributionMap[type].count,
      totalBalance: Number(accountDistributionMap[type].totalBalance.toFixed(2)),
    }));

    // 3. Loan Status Distribution
    const allLoans = await Loan.find({});
    const loanStatsMap: { [key: string]: { count: number; totalAmount: number } } = {
      PENDING: { count: 0, totalAmount: 0 },
      UNDER_REVIEW: { count: 0, totalAmount: 0 },
      ACTIVE: { count: 0, totalAmount: 0 },
      PAID_OFF: { count: 0, totalAmount: 0 },
      REJECTED: { count: 0, totalAmount: 0 },
    };

    allLoans.forEach((l) => {
      const status = l.status || 'PENDING';
      if (!loanStatsMap[status]) {
        loanStatsMap[status] = { count: 0, totalAmount: 0 };
      }
      loanStatsMap[status].count += 1;
      loanStatsMap[status].totalAmount += l.amount || 0;
    });

    const loanStats = Object.keys(loanStatsMap).map((status) => ({
      status,
      count: loanStatsMap[status].count,
      totalAmount: Number(loanStatsMap[status].totalAmount.toFixed(2)),
    }));

    res.status(200).json({
      success: true,
      data: {
        metrics: {
          totalCustomers,
          totalStaff,
          totalAccounts,
          totalBankBalance: Number(totalBankBalance.toFixed(2)),
          totalDeposits: Number(totalDeposits.toFixed(2)),
          totalWithdrawals: Number(totalWithdrawals.toFixed(2)),
          totalTransactions: transactions.length,
          pendingLoansCount,
          activeLoansCount: activeLoans.length,
          totalActiveLoanDebt: Number(totalActiveLoanDebt.toFixed(2)),
          pendingRequestsCount,
          flaggedTransactionsCount,
        },
        charts: {
          monthlyVolume,
          accountDistribution,
          loanStats,
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Analytics error:', error);
    res.status(500).json({ success: false, message: 'Server error generating analytics.' });
  }
};

/**
 * 2. Get All Customers (Admin view)
 */
export const getCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, page = '1', limit = '15' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    const query: any = { role: 'CUSTOMER' };

    if (status && typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    if (search && typeof search === 'string') {
      const s = search.trim();
      query.$or = [
        { name: { $regex: s, $options: 'i' } },
        { email: { $regex: s, $options: 'i' } },
        { phone: { $regex: s, $options: 'i' } },
      ];
    }

    const [customers, total] = await Promise.all([
      User.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      User.countDocuments(query),
    ]);

    const customerIds = customers.map((c) => c._id);
    const accounts = await BankAccount.find({ userId: { $in: customerIds } });

    const accountsByUserId: { [key: string]: any[] } = {};
    accounts.forEach((acc) => {
      const uId = acc.userId.toString();
      if (!accountsByUserId[uId]) accountsByUserId[uId] = [];
      accountsByUserId[uId].push(acc);
    });

    const data = customers.map((c) => ({
      id: c._id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      address: c.address,
      status: c.status,
      createdAt: c.createdAt,
      accounts: accountsByUserId[c._id.toString()] || [],
    }));

    res.status(200).json({
      success: true,
      data: {
        customers: data,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Get customers error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving customers.' });
  }
};

/**
 * 3. Update Customer Status (ACTIVE, INACTIVE, BLOCKED)
 */
export const updateCustomerStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { status } = req.body;

    const validStatuses: UserStatus[] = ['ACTIVE', 'INACTIVE', 'BLOCKED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Must be ACTIVE, INACTIVE, or BLOCKED.',
      });
      return;
    }

    const user = await User.findById(id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    user.status = status;
    await user.save();

    await Notification.create({
      userId: user._id,
      title: 'Profile Status Changed',
      message: `Your online banking status has been set to ${status} by bank administration.`,
      type: status === 'BLOCKED' ? 'ALERT' : 'INFO',
    });

    res.status(200).json({
      success: true,
      message: `Customer status updated to ${status}.`,
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        status: user.status,
      },
    });
  } catch (error) {
    console.error('[Admin] Update customer status error:', error);
    res.status(500).json({ success: false, message: 'Server error updating customer status.' });
  }
};

/**
 * 4. Get All Bank Accounts (Admin view)
 */
export const getAccounts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, type, page = '1', limit = '15' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};

    if (status && typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    if (type && typeof type === 'string' && type !== 'ALL') {
      query.accountType = type;
    }

    if (search && typeof search === 'string') {
      query.accountNumber = { $regex: search.trim(), $options: 'i' };
    }

    const [accounts, total] = await Promise.all([
      BankAccount.find(query)
        .populate('userId', 'name email phone status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      BankAccount.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        accounts,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('[Admin] Get accounts error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving accounts.' });
  }
};

/**
 * 5. Create Bank Account by Admin
 */
export const createAccount = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      userId,
      accountType = 'SAVINGS',
      initialBalance = 0,
      currency = 'USD',
      dailyLimit = 10000,
      maxSingleLimit = 5000,
      minBalance = 0,
    } = req.body;

    if (!userId) {
      res.status(400).json({ success: false, message: 'User ID is required.' });
      return;
    }

    const user = await User.findById(userId);
    if (!user) {
      res.status(404).json({ success: false, message: 'Target customer user not found.' });
      return;
    }

    const depositAmount = Math.max(0, Number(initialBalance) || 0);

    const newAccount = await BankAccount.create({
      userId: user._id,
      accountNumber: generateAccountNumber(accountType),
      accountType,
      balance: depositAmount,
      currency,
      status: 'ACTIVE',
      dailyLimit: Math.max(0, Number(dailyLimit) || 10000),
      maxSingleLimit: Math.max(0, Number(maxSingleLimit) || 5000),
      minBalance: Math.max(0, Number(minBalance) || 0),
    });

    if (depositAmount > 0) {
      const ref = generateTransactionRef('DEP');
      await Transaction.create({
        transactionType: 'DEPOSIT',
        toAccount: newAccount._id,
        receiverUserId: user._id,
        amount: depositAmount,
        status: 'COMPLETED',
        description: 'Initial Account Deposit',
        reference: ref,
      });
    }

    await Notification.create({
      userId: user._id,
      title: 'New Account Provisioned',
      message: `A new ${accountType} account (${newAccount.accountNumber}) has been created for your profile.`,
      type: 'INFO',
    });

    res.status(201).json({
      success: true,
      message: 'Account created successfully.',
      data: newAccount,
    });
  } catch (error) {
    console.error('[Admin] Create account error:', error);
    res.status(500).json({ success: false, message: 'Server error creating account.' });
  }
};

/**
 * 6. Update Account Status (FREEZE / UNFREEZE / CLOSE)
 */
export const updateAccountStatus = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { status } = req.body;

    const validStatuses: AccountStatus[] = ['ACTIVE', 'FROZEN', 'CLOSED'];
    if (!validStatuses.includes(status)) {
      res.status(400).json({
        success: false,
        message: 'Invalid status. Must be ACTIVE, FROZEN, or CLOSED.',
      });
      return;
    }

    const account = await BankAccount.findById(id);
    if (!account) {
      res.status(404).json({ success: false, message: 'Bank account not found.' });
      return;
    }

    account.status = status;
    await account.save();

    await Notification.create({
      userId: account.userId,
      title: 'Account Status Updated',
      message: `Account ${account.accountNumber} has been updated to status: ${status}.`,
      type: status === 'FROZEN' ? 'ALERT' : 'INFO',
    });

    res.status(200).json({
      success: true,
      message: `Account status updated to ${status}.`,
      data: account,
    });
  } catch (error) {
    console.error('[Admin] Update account status error:', error);
    res.status(500).json({ success: false, message: 'Server error updating account status.' });
  }
};

/**
 * 7. Set Account Limits & Minimum Balance
 */
export const updateAccountLimits = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { dailyLimit, maxSingleLimit, minBalance } = req.body;

    const account = await BankAccount.findById(id);
    if (!account) {
      res.status(404).json({ success: false, message: 'Bank account not found.' });
      return;
    }

    if (dailyLimit !== undefined) {
      account.dailyLimit = Math.max(0, Number(dailyLimit) || 0);
    }
    if (maxSingleLimit !== undefined) {
      account.maxSingleLimit = Math.max(0, Number(maxSingleLimit) || 0);
    }
    if (minBalance !== undefined) {
      account.minBalance = Math.max(0, Number(minBalance) || 0);
    }

    await account.save();

    res.status(200).json({
      success: true,
      message: 'Account limits updated successfully.',
      data: account,
    });
  } catch (error) {
    console.error('[Admin] Update account limits error:', error);
    res.status(500).json({ success: false, message: 'Server error updating account limits.' });
  }
};

/**
 * 8. Approve / Reject Deposit & Withdrawal Requests
 * Atomically updates balance and creates COMPLETED transaction on approval.
 */
export const reviewRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { status, reviewNotes } = req.body;
    const adminId = req.user?.id;

    if (status !== 'APPROVED' && status !== 'REJECTED') {
      res.status(400).json({
        success: false,
        message: 'Status must be either APPROVED or REJECTED.',
      });
      return;
    }

    const request = await Request.findById(id);
    if (!request) {
      res.status(404).json({ success: false, message: 'Request not found.' });
      return;
    }

    if (request.status !== 'PENDING') {
      res.status(400).json({
        success: false,
        message: `Request has already been reviewed (${request.status}).`,
      });
      return;
    }

    if (status === 'APPROVED' && (request.requestType === 'DEPOSIT' || request.requestType === 'WITHDRAWAL')) {
      if (!request.accountId) {
        res.status(400).json({
          success: false,
          message: 'Cannot process request without linked bank account.',
        });
        return;
      }

      const account = await BankAccount.findById(request.accountId);
      if (!account) {
        res.status(404).json({ success: false, message: 'Target bank account not found.' });
        return;
      }

      if (account.status !== 'ACTIVE') {
        res.status(400).json({
          success: false,
          message: `Cannot approve request for account in status ${account.status}.`,
        });
        return;
      }

      const requestAmount = request.amount || 0;
      if (requestAmount <= 0) {
        res.status(400).json({ success: false, message: 'Request amount must be greater than zero.' });
        return;
      }

      // Check balance for withdrawal
      if (request.requestType === 'WITHDRAWAL') {
        if (account.balance - requestAmount < (account.minBalance || 0)) {
          res.status(400).json({
            success: false,
            message: `Cannot approve withdrawal: Insufficient balance. Account balance: $${account.balance.toFixed(2)}.`,
          });
          return;
        }
      }

      // Execute balance update & transaction creation atomically
      await executeTransaction(async (session) => {
        const balanceChange = request.requestType === 'DEPOSIT' ? requestAmount : -requestAmount;

        await BankAccount.findByIdAndUpdate(
          account._id,
          { $inc: { balance: balanceChange } },
          { session: session || undefined }
        );

        const ref = generateTransactionRef(request.requestType === 'DEPOSIT' ? 'DEP' : 'WTH');

        const txnData: any = {
          transactionType: request.requestType,
          amount: requestAmount,
          status: 'COMPLETED',
          description: `Approved request: ${request.title}`,
          reference: ref,
        };

        if (request.requestType === 'WITHDRAWAL') {
          txnData.fromAccount = account._id;
          txnData.senderUserId = request.userId;
        } else if (request.requestType === 'DEPOSIT') {
          txnData.toAccount = account._id;
          txnData.receiverUserId = request.userId;
        }

        await Transaction.create([txnData], { session: session || undefined, ordered: true });

        request.status = 'APPROVED';
        request.reviewedBy = adminId as any;
        request.reviewNotes = reviewNotes?.trim() || 'Approved by Administrator';
        await request.save({ session: session || undefined });

        await Notification.create(
          [
            {
              userId: request.userId,
              title: `${request.requestType} Request Approved`,
              message: `Your ${request.requestType.toLowerCase()} request for $${requestAmount.toFixed(2)} on account ${account.accountNumber} was approved and processed.`,
              type: 'TRANSACTION',
            },
          ],
          { session: session || undefined, ordered: true }
        );
      });

      res.status(200).json({
        success: true,
        message: `${request.requestType} request approved and processed successfully.`,
        data: request,
      });
      return;
    }

    // For rejection or general non-financial requests
    request.status = status;
    request.reviewedBy = adminId as any;
    request.reviewNotes = reviewNotes?.trim() || `${status} by Administrator`;
    await request.save();

    await Notification.create({
      userId: request.userId,
      title: `Request ${status}`,
      message: `Your request "${request.title}" has been ${status.toLowerCase()}.${reviewNotes ? ` Notes: ${reviewNotes}` : ''}`,
      type: status === 'APPROVED' ? 'INFO' : 'ALERT',
    });

    res.status(200).json({
      success: true,
      message: `Request has been ${status.toLowerCase()}.`,
      data: request,
    });
  } catch (error: any) {
    console.error('[Admin] Review request error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error reviewing request.',
    });
  }
};

/**
 * 9. Approve / Reject Loan Applications
 * On approval: auto-disburse loan into customer's account with a LOAN_DISBURSEMENT transaction
 * and set status to ACTIVE.
 */
export const reviewLoanDecision = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { decision, reviewNotes } = req.body;
    const adminId = req.user?.id;

    if (decision !== 'APPROVED' && decision !== 'REJECTED') {
      res.status(400).json({
        success: false,
        message: 'Decision must be either APPROVED or REJECTED.',
      });
      return;
    }

    const loan = await Loan.findById(id);
    if (!loan) {
      res.status(404).json({ success: false, message: 'Loan application not found.' });
      return;
    }

    if (loan.status === 'ACTIVE' || loan.status === 'PAID_OFF') {
      res.status(400).json({
        success: false,
        message: `Cannot change decision: Loan is already in ${loan.status} status.`,
      });
      return;
    }

    if (decision === 'REJECTED') {
      loan.status = 'REJECTED';
      loan.approvedBy = adminId as any;
      if (reviewNotes) loan.staffNotes = (loan.staffNotes ? loan.staffNotes + '\n' : '') + `Admin: ${reviewNotes}`;
      await loan.save();

      await Notification.create({
        userId: loan.userId,
        title: 'Loan Application Rejected',
        message: `Your loan application for $${loan.amount.toFixed(2)} was not approved.${reviewNotes ? ` Reason: ${reviewNotes}` : ''}`,
        type: 'ALERT',
      });

      res.status(200).json({
        success: true,
        message: 'Loan application has been rejected.',
        data: loan,
      });
      return;
    }

    // On APPROVAL: Auto-disburse loan into customer's bank account
    const account = await BankAccount.findById(loan.accountId);
    if (!account) {
      res.status(404).json({
        success: false,
        message: 'Designated disbursement bank account not found.',
      });
      return;
    }

    if (account.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        message: `Disbursement account must be active. Current status: ${account.status}.`,
      });
      return;
    }

    const disbursementRef = generateTransactionRef('DSB');

    await executeTransaction(async (session) => {
      // 1. Credit customer's account with principal loan amount
      await BankAccount.findByIdAndUpdate(
        account._id,
        { $inc: { balance: loan.amount } },
        { session: session || undefined }
      );

      // 2. Set loan to ACTIVE
      loan.status = 'ACTIVE';
      loan.approvedBy = adminId as any;
      if (reviewNotes) {
        loan.staffNotes = (loan.staffNotes ? loan.staffNotes + '\n' : '') + `Admin: ${reviewNotes}`;
      }
      await loan.save({ session: session || undefined });

      // 3. Create LOAN_DISBURSEMENT transaction
      await Transaction.create(
        [
          {
            transactionType: 'LOAN_DISBURSEMENT',
            toAccount: account._id,
            receiverUserId: loan.userId,
            amount: loan.amount,
            status: 'COMPLETED',
            description: `Auto loan disbursement for Loan ${loan._id}`,
            reference: disbursementRef,
          },
        ],
        { session: session || undefined, ordered: true }
      );

      // 4. Send approval notification to customer
      await Notification.create(
        [
          {
            userId: loan.userId,
            title: 'Loan Approved & Disbursed!',
            message: `Your loan of $${loan.amount.toFixed(2)} has been approved and disbursed directly to account ${account.accountNumber}. Monthly installment: $${loan.monthlyInstallment.toFixed(2)}.`,
            type: 'TRANSACTION',
          },
        ],
        { session: session || undefined, ordered: true }
      );
    });

    res.status(200).json({
      success: true,
      message: 'Loan approved and funds disbursed successfully to customer account.',
      data: loan,
    });
  } catch (error: any) {
    console.error('[Admin] Review loan decision error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error processing loan approval.',
    });
  }
};
