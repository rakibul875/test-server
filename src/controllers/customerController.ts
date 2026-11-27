import { Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthRequest } from '../middlewares/authMiddleware';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction, TransactionType } from '../models/Transaction';
import { Request } from '../models/Request';
import { Loan } from '../models/Loan';
import { Notification } from '../models/Notification';
import { executeTransaction, generateTransactionRef } from '../utils/helpers';

/**
 * 1. Customer Dashboard Overview
 */
export const getDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    // 1. Fetch user accounts
    const accounts = await BankAccount.find({ userId }).sort({ createdAt: -1 });
    const accountIds = accounts.map((acc) => acc._id);

    // Total balance
    const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

    // 2. Fetch completed transactions for all user accounts
    const transactions = await Transaction.find({
      status: 'COMPLETED',
      $or: [{ fromAccount: { $in: accountIds } }, { toAccount: { $in: accountIds } }],
    }).sort({ createdAt: -1 });

    let totalDeposits = 0;
    let totalWithdrawals = 0;

    const accountIdStrs = new Set(accountIds.map((id) => id.toString()));

    transactions.forEach((txn) => {
      const isFromUser = txn.fromAccount && accountIdStrs.has(txn.fromAccount.toString());
      const isToUser = txn.toAccount && accountIdStrs.has(txn.toAccount.toString());

      if (isToUser && !isFromUser) {
        totalDeposits += txn.amount;
      } else if (isFromUser && !isToUser) {
        totalWithdrawals += txn.amount;
      } else if (isFromUser && isToUser) {
        // Internal transfer between own accounts: count as activity or neutral
      }
    });

    // 3. Active Loans
    const activeLoans = await Loan.find({
      userId,
      status: { $in: ['ACTIVE', 'APPROVED'] },
    });
    const totalLoanDebt = activeLoans.reduce((sum, loan) => sum + loan.remainingBalance, 0);

    // 4. Monthly Spending & Deposit Chart Data (last 6 months)
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const now = new Date();
    const monthlyDataMap: { [key: string]: { month: string; deposits: number; withdrawals: number } } = {};

    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthlyDataMap[key] = {
        month: `${monthNames[d.getMonth()]} ${d.getFullYear()}`,
        deposits: 0,
        withdrawals: 0,
      };
    }

    transactions.forEach((txn) => {
      const d = new Date(txn.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      if (monthlyDataMap[key]) {
        const isFromUser = txn.fromAccount && accountIdStrs.has(txn.fromAccount.toString());
        const isToUser = txn.toAccount && accountIdStrs.has(txn.toAccount.toString());

        if (isToUser && !isFromUser) {
          monthlyDataMap[key].deposits += txn.amount;
        } else if (isFromUser && !isToUser) {
          monthlyDataMap[key].withdrawals += txn.amount;
        }
      }
    });

    const chartData = Object.values(monthlyDataMap);

    // 5. Recent 5 Transactions
    const recentTransactions = transactions.slice(0, 5);

    res.status(200).json({
      success: true,
      data: {
        accounts,
        totalBalance: Number(totalBalance.toFixed(2)),
        totalDeposits: Number(totalDeposits.toFixed(2)),
        totalWithdrawals: Number(totalWithdrawals.toFixed(2)),
        activeLoansCount: activeLoans.length,
        totalLoanDebt: Number(totalLoanDebt.toFixed(2)),
        chartData,
        recentTransactions,
      },
    });
  } catch (error) {
    console.error('[Customer] Dashboard error:', error);
    res.status(500).json({ success: false, message: 'Server error loading dashboard.' });
  }
};

/**
 * 2. Atomic Fund Transfer
 */
export const transferFunds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { fromAccountNumber, toAccountNumber, amount, pin, description } = req.body;

    // Validate inputs
    if (!fromAccountNumber || !toAccountNumber || amount === undefined || !pin) {
      res.status(400).json({
        success: false,
        message: 'Sender account, receiver account, transfer amount, and 4-digit PIN are required.',
      });
      return;
    }

    const transferAmount = Number(amount);
    if (isNaN(transferAmount) || transferAmount <= 0) {
      res.status(400).json({ success: false, message: 'Transfer amount must be greater than zero.' });
      return;
    }

    if (fromAccountNumber.trim() === toAccountNumber.trim()) {
      res.status(400).json({
        success: false,
        message: 'Sender and recipient account numbers cannot be identical.',
      });
      return;
    }

    // 1. Fetch user to verify transaction PIN
    const senderUser = await User.findById(userId).select('+transactionPin');
    if (!senderUser) {
      res.status(404).json({ success: false, message: 'Sender user profile not found.' });
      return;
    }

    if (!senderUser.transactionPin) {
      res.status(400).json({
        success: false,
        message: 'No transaction PIN configured. Please contact support or set your PIN.',
      });
      return;
    }

    const isPinValid = await bcrypt.compare(pin.toString(), senderUser.transactionPin);
    if (!isPinValid) {
      res.status(401).json({ success: false, message: 'Incorrect 4-digit transaction PIN.' });
      return;
    }

    // 2. Fetch and validate Sender Account
    const fromAccount = await BankAccount.findOne({
      accountNumber: fromAccountNumber.trim(),
      userId: senderUser._id,
    });

    if (!fromAccount) {
      res.status(404).json({
        success: false,
        message: 'Sender bank account not found or does not belong to you.',
      });
      return;
    }

    if (fromAccount.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        message: `Sender account cannot perform transfers because its status is ${fromAccount.status}.`,
      });
      return;
    }

    // 3. Fetch and validate Receiver Account
    const toAccount = await BankAccount.findOne({
      accountNumber: toAccountNumber.trim(),
    });

    if (!toAccount) {
      res.status(404).json({
        success: false,
        message: 'Recipient bank account number not found.',
      });
      return;
    }

    if (toAccount.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        message: `Recipient account is currently ${toAccount.status} and cannot receive funds.`,
      });
      return;
    }

    // 4. Validate Single Transaction Limit
    if (transferAmount > (fromAccount.maxSingleLimit || 5000)) {
      res.status(400).json({
        success: false,
        message: `Amount exceeds maximum single transfer limit of $${fromAccount.maxSingleLimit}.`,
      });
      return;
    }

    // 5. Validate Daily Transfer Limit
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const todayTransfers = await Transaction.find({
      fromAccount: fromAccount._id,
      status: 'COMPLETED',
      transactionType: { $in: ['TRANSFER', 'WITHDRAWAL'] },
      createdAt: { $gte: startOfToday },
    });

    const totalTransferredToday = todayTransfers.reduce((sum, t) => sum + t.amount, 0);
    if (totalTransferredToday + transferAmount > (fromAccount.dailyLimit || 10000)) {
      const remainingLimit = Math.max(0, fromAccount.dailyLimit - totalTransferredToday);
      res.status(400).json({
        success: false,
        message: `Transfer exceeds daily limit of $${fromAccount.dailyLimit}. Remaining daily limit: $${remainingLimit.toFixed(2)}.`,
      });
      return;
    }

    // 6. Validate Sufficient Balance
    const minimumAllowed = fromAccount.minBalance || 0;
    if (fromAccount.balance - transferAmount < minimumAllowed) {
      res.status(400).json({
        success: false,
        message: `Insufficient funds. Account balance: $${fromAccount.balance.toFixed(2)}, Minimum required balance: $${minimumAllowed.toFixed(2)}.`,
      });
      return;
    }

    // 7. Check if transfer triggers AML Auto-Flag (> $10,000 threshold or user specified)
    const LARGE_TRANSFER_THRESHOLD = 10000;
    const isLargeTransfer = transferAmount >= LARGE_TRANSFER_THRESHOLD;
    const flagReason = isLargeTransfer
      ? `Automated AML: Transfer of $${transferAmount.toFixed(2)} meets or exceeds $${LARGE_TRANSFER_THRESHOLD} threshold.`
      : '';

    const transactionReference = generateTransactionRef('TXN');

    // 8. Execute Atomic Balance Transfer
    const completedTransaction = await executeTransaction(async (session) => {
      // Deduct from sender
      const updatedSender = await BankAccount.findOneAndUpdate(
        { _id: fromAccount._id, balance: { $gte: transferAmount + minimumAllowed } },
        { $inc: { balance: -transferAmount } },
        { new: true, session: session || undefined }
      );

      if (!updatedSender) {
        throw new Error('Balance changed concurrently or insufficient funds. Transfer aborted.');
      }

      // Add to receiver
      await BankAccount.findByIdAndUpdate(
        toAccount._id,
        { $inc: { balance: transferAmount } },
        { session: session || undefined }
      );

      // Create completed transaction log
      const [newTxn] = await Transaction.create(
        [
          {
            transactionType: 'TRANSFER',
            fromAccount: fromAccount._id,
            toAccount: toAccount._id,
            senderUserId: senderUser._id,
            receiverUserId: toAccount.userId,
            amount: transferAmount,
            status: 'COMPLETED',
            description: description?.trim() || `Fund transfer to ${toAccount.accountNumber}`,
            reference: transactionReference,
            isFlagged: isLargeTransfer,
            flagReason,
          },
        ],
        { session: session || undefined, ordered: true }
      );

      // Create notifications for sender and receiver
      await Notification.create(
        [
          {
            userId: senderUser._id,
            title: 'Fund Transfer Sent',
            message: `Successfully transferred $${transferAmount.toFixed(2)} to account ${toAccount.accountNumber}. Ref: ${transactionReference}`,
            type: 'TRANSACTION',
          },
          {
            userId: toAccount.userId,
            title: 'Fund Transfer Received',
            message: `Received $${transferAmount.toFixed(2)} from account ${fromAccount.accountNumber}. Ref: ${transactionReference}`,
            type: 'TRANSACTION',
          },
        ],
        { session: session || undefined, ordered: true }
      );

      return newTxn;
    });

    res.status(200).json({
      success: true,
      message: 'Fund transfer completed successfully.',
      data: {
        reference: completedTransaction.reference,
        amount: completedTransaction.amount,
        fromAccount: fromAccount.accountNumber,
        toAccount: toAccount.accountNumber,
        isFlagged: completedTransaction.isFlagged,
        createdAt: completedTransaction.createdAt,
      },
    });
  } catch (error: any) {
    console.error('[Customer] Transfer error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Server error processing fund transfer.',
    });
  }
};

/**
 * 3. Submit Customer Request (Deposit / Withdrawal / Support)
 */
export const createRequest = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { requestType, accountId, amount, title, description, data } = req.body;

    if (!requestType || !title || !description) {
      res.status(400).json({
        success: false,
        message: 'Request type, title, and description are required.',
      });
      return;
    }

    let parsedAmount = 0;
    if (amount !== undefined) {
      parsedAmount = Number(amount);
      if (isNaN(parsedAmount) || parsedAmount < 0) {
        res.status(400).json({ success: false, message: 'Invalid amount.' });
        return;
      }
    }

    let validatedAccount = null;
    if (accountId) {
      validatedAccount = await BankAccount.findOne({ _id: accountId, userId });
      if (!validatedAccount) {
        res.status(404).json({ success: false, message: 'Designated account not found.' });
        return;
      }

      if (requestType === 'WITHDRAWAL') {
        if (validatedAccount.balance < parsedAmount) {
          res.status(400).json({
            success: false,
            message: `Insufficient funds for withdrawal request. Current balance: $${validatedAccount.balance.toFixed(2)}.`,
          });
          return;
        }
      }
    }

    const newRequest = await Request.create({
      userId,
      accountId: validatedAccount ? validatedAccount._id : undefined,
      requestType,
      amount: parsedAmount,
      title: title.trim(),
      description: description.trim(),
      data: data || {},
      status: 'PENDING',
    });

    res.status(201).json({
      success: true,
      message: 'Request submitted successfully and is pending review.',
      data: newRequest,
    });
  } catch (error) {
    console.error('[Customer] Create request error:', error);
    res.status(500).json({ success: false, message: 'Server error creating request.' });
  }
};

/**
 * 4. Get Customer Requests
 */
export const getRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const requests = await Request.find({ userId })
      .populate('accountId', 'accountNumber accountType balance')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.error('[Customer] Get requests error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving requests.' });
  }
};

/**
 * 5. Get Customer Transactions (with search, filter, pagination)
 */
export const getTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { search, type, startDate, endDate, page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    // Get user's account IDs
    const userAccounts = await BankAccount.find({ userId }).select('_id');
    const accountIds = userAccounts.map((acc) => acc._id);

    const query: any = {
      $or: [{ fromAccount: { $in: accountIds } }, { toAccount: { $in: accountIds } }],
    };

    // Filter by type
    if (type && typeof type === 'string' && type !== 'ALL') {
      query.transactionType = type;
    }

    // Filter by date range
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) {
        query.createdAt.$gte = new Date(startDate as string);
      }
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    // Search by reference or description
    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$and = [
        {
          $or: [{ reference: searchRegex }, { description: searchRegex }],
        },
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('fromAccount', 'accountNumber accountType')
        .populate('toAccount', 'accountNumber accountType')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Transaction.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      data: {
        transactions,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('[Customer] Get transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving transactions.' });
  }
};

/**
 * 6. Apply for Loan
 */
export const applyLoan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { accountId, amount, termMonths, purpose } = req.body;

    if (!accountId || !amount || !termMonths) {
      res.status(400).json({
        success: false,
        message: 'Account ID, loan amount, and term in months are required.',
      });
      return;
    }

    const loanAmount = Number(amount);
    const months = Number(termMonths);

    if (isNaN(loanAmount) || loanAmount < 500) {
      res.status(400).json({ success: false, message: 'Loan amount must be at least $500.' });
      return;
    }

    if (isNaN(months) || months < 3 || months > 60) {
      res.status(400).json({
        success: false,
        message: 'Loan term must be between 3 and 60 months.',
      });
      return;
    }

    // Validate account belongs to user and is active
    const account = await BankAccount.findOne({ _id: accountId, userId });
    if (!account) {
      res.status(404).json({ success: false, message: 'Selected bank account not found.' });
      return;
    }

    if (account.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        message: `Account must be active to apply for loan. Current status: ${account.status}.`,
      });
      return;
    }

    // Standard interest calculation (e.g. 6.5% annual rate)
    const annualInterestRate = 6.5;
    const totalInterest = loanAmount * (annualInterestRate / 100) * (months / 12);
    const totalRepayment = loanAmount + totalInterest;
    const monthlyInstallment = Number((totalRepayment / months).toFixed(2));

    const newLoan = await Loan.create({
      userId,
      accountId: account._id,
      amount: loanAmount,
      interestRate: annualInterestRate,
      termMonths: months,
      monthlyInstallment,
      remainingBalance: Number(totalRepayment.toFixed(2)),
      purpose: purpose?.trim() || 'Personal Loan',
      status: 'PENDING',
      repayments: [],
    });

    await Notification.create({
      userId,
      title: 'Loan Application Submitted',
      message: `Your application for a $${loanAmount.toFixed(2)} loan has been received and is pending review.`,
      type: 'INFO',
    });

    res.status(201).json({
      success: true,
      message: 'Loan application submitted successfully.',
      data: newLoan,
    });
  } catch (error) {
    console.error('[Customer] Apply loan error:', error);
    res.status(500).json({ success: false, message: 'Server error submitting loan application.' });
  }
};

/**
 * 7. Get Customer Loans
 */
export const getLoans = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const loans = await Loan.find({ userId })
      .populate('accountId', 'accountNumber accountType balance')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: loans,
    });
  } catch (error) {
    console.error('[Customer] Get loans error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving loans.' });
  }
};

/**
 * 8. Repay Loan Installment
 */
export const repayLoan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const rawLoanId = req.params.id;
    const loanId = Array.isArray(rawLoanId) ? rawLoanId[0] : rawLoanId;
    const { accountId, amount } = req.body;

    const loan = await Loan.findOne({ _id: loanId, userId });
    if (!loan) {
      res.status(404).json({ success: false, message: 'Loan record not found.' });
      return;
    }

    if (loan.status !== 'ACTIVE') {
      res.status(400).json({
        success: false,
        message: `Loan is not in active repayment status. Current status: ${loan.status}.`,
      });
      return;
    }

    const repaymentAmount = amount ? Number(amount) : loan.monthlyInstallment;
    if (isNaN(repaymentAmount) || repaymentAmount <= 0) {
      res.status(400).json({ success: false, message: 'Invalid repayment amount.' });
      return;
    }

    // Determine target repayment account
    const targetAccountId = accountId || loan.accountId;
    const account = await BankAccount.findOne({ _id: targetAccountId, userId });

    if (!account) {
      res.status(404).json({ success: false, message: 'Repayment bank account not found.' });
      return;
    }

    if (account.status !== 'ACTIVE') {
      res.status(400).json({ success: false, message: 'Repayment bank account is not active.' });
      return;
    }

    if (account.balance < repaymentAmount) {
      res.status(400).json({
        success: false,
        message: `Insufficient balance to make repayment of $${repaymentAmount.toFixed(2)}. Current balance: $${account.balance.toFixed(2)}.`,
      });
      return;
    }

    const actualPayment = Math.min(repaymentAmount, loan.remainingBalance);
    const transactionRef = generateTransactionRef('LRP');

    // Execute atomic repayment
    await executeTransaction(async (session) => {
      // Deduct from account
      await BankAccount.findByIdAndUpdate(
        account._id,
        { $inc: { balance: -actualPayment } },
        { session: session || undefined }
      );

      const newRemaining = Math.max(0, Number((loan.remainingBalance - actualPayment).toFixed(2)));
      const isPaidOff = newRemaining <= 0;

      // Update loan
      loan.remainingBalance = newRemaining;
      if (isPaidOff) {
        loan.status = 'PAID_OFF';
      }
      loan.repayments.push({
        amount: actualPayment,
        paidAt: new Date(),
        transactionReference: transactionRef,
      });

      await loan.save({ session: session || undefined });

      // Log transaction
      await Transaction.create(
        [
          {
            transactionType: 'LOAN_REPAYMENT',
            fromAccount: account._id,
            senderUserId: userId,
            amount: actualPayment,
            status: 'COMPLETED',
            description: `Installment payment for Loan ${loan._id}`,
            reference: transactionRef,
          },
        ],
        { session: session || undefined, ordered: true }
      );

      // Notification
      await Notification.create(
        [
          {
            userId,
            title: isPaidOff ? 'Loan Fully Paid Off!' : 'Loan Repayment Received',
            message: isPaidOff
              ? `Congratulations! Your loan of $${loan.amount.toFixed(2)} has been fully settled.`
              : `Payment of $${actualPayment.toFixed(2)} posted. Remaining loan balance: $${newRemaining.toFixed(2)}.`,
            type: 'TRANSACTION',
          },
        ],
        { session: session || undefined, ordered: true }
      );
    });

    res.status(200).json({
      success: true,
      message: 'Loan repayment processed successfully.',
      data: {
        paidAmount: actualPayment,
        remainingBalance: loan.remainingBalance,
        status: loan.status,
        reference: transactionRef,
      },
    });
  } catch (error) {
    console.error('[Customer] Repay loan error:', error);
    res.status(500).json({ success: false, message: 'Server error processing loan repayment.' });
  }
};

/**
 * 9. Get Customer Notifications
 */
export const getNotifications = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const notifications = await Notification.find({ userId }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = await Notification.countDocuments({ userId, isRead: false });

    res.status(200).json({
      success: true,
      data: {
        notifications,
        unreadCount,
      },
    });
  } catch (error) {
    console.error('[Customer] Get notifications error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving notifications.' });
  }
};

/**
 * 10. Mark Notification as Read
 */
export const markNotificationRead = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    if (id === 'all') {
      await Notification.updateMany({ userId, isRead: false }, { isRead: true });
      res.status(200).json({ success: true, message: 'All notifications marked as read.' });
      return;
    }

    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      res.status(404).json({ success: false, message: 'Notification not found.' });
      return;
    }

    res.status(200).json({
      success: true,
      data: notification,
    });
  } catch (error) {
    console.error('[Customer] Mark notification read error:', error);
    res.status(500).json({ success: false, message: 'Server error updating notification.' });
  }
};
