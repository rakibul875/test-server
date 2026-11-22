import { Response } from 'express';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { AuthRequest } from '../middlewares/authMiddleware';
import { User } from '../models/User';
import { BankAccount, AccountType } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { Request } from '../models/Request';
import { Loan } from '../models/Loan';
import { Notification } from '../models/Notification';
import { generateAccountNumber, generateTransactionRef } from '../utils/helpers';

/**
 * 1. Register Customer & Provision Account by Staff
 */
export const registerCustomer = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      email,
      password,
      phone,
      address,
      transactionPin = '1234',
      accountType = 'SAVINGS',
      initialDeposit = 0,
    } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Customer name, email, and password are required.',
      });
      return;
    }

    if (!/^\d{4}$/.test(transactionPin.toString())) {
      res.status(400).json({
        success: false,
        message: 'Transaction PIN must be exactly 4 numeric digits.',
      });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'A user with this email address already exists.',
      });
      return;
    }

    const validAccountTypes: AccountType[] = ['SAVINGS', 'CURRENT', 'CHECKING', 'BUSINESS'];
    const chosenType = validAccountTypes.includes(accountType) ? accountType : 'SAVINGS';

    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(transactionPin.toString(), 10);

    const newUser = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      transactionPin: hashedPin,
      role: 'CUSTOMER',
      phone: phone?.trim() || '',
      address: address?.trim() || '',
      status: 'ACTIVE',
    });

    const depositAmount = Math.max(0, Number(initialDeposit) || 0);

    const newAccount = await BankAccount.create({
      userId: newUser._id,
      accountNumber: generateAccountNumber(chosenType),
      accountType: chosenType,
      balance: depositAmount,
      currency: 'USD',
      status: 'ACTIVE',
      dailyLimit: 10000,
      maxSingleLimit: 5000,
      minBalance: 0,
    });

    if (depositAmount > 0) {
      const ref = generateTransactionRef('DEP');
      await Transaction.create({
        transactionType: 'DEPOSIT',
        toAccount: newAccount._id,
        receiverUserId: newUser._id,
        amount: depositAmount,
        status: 'COMPLETED',
        description: 'Branch Initial Account Deposit',
        reference: ref,
      });
    }

    await Notification.create({
      userId: newUser._id,
      title: 'Account Opened by Branch Staff',
      message: `Your new ${chosenType} Account (${newAccount.accountNumber}) has been provisioned. Initial balance: $${depositAmount.toFixed(2)}.`,
      type: 'INFO',
    });

    res.status(201).json({
      success: true,
      message: 'Customer and bank account created successfully.',
      data: {
        customer: {
          id: newUser._id,
          name: newUser.name,
          email: newUser.email,
          phone: newUser.phone,
          address: newUser.address,
          status: newUser.status,
        },
        account: newAccount,
      },
    });
  } catch (error) {
    console.error('[Staff] Register customer error:', error);
    res.status(500).json({ success: false, message: 'Server error creating customer.' });
  }
};

/**
 * 2. View/Search Customers
 */
export const getCustomers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { search, status, page = '1', limit = '10' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 10));
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

    // Attach account numbers and total balance for each customer
    const customerIds = customers.map((c) => c._id);
    const accounts = await BankAccount.find({ userId: { $in: customerIds } });

    const accountsMap: { [key: string]: any[] } = {};
    accounts.forEach((acc) => {
      const uId = acc.userId.toString();
      if (!accountsMap[uId]) accountsMap[uId] = [];
      accountsMap[uId].push(acc);
    });

    const enrichedCustomers = customers.map((c) => {
      const userAccounts = accountsMap[c._id.toString()] || [];
      const totalBalance = userAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
      return {
        id: c._id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        address: c.address,
        status: c.status,
        createdAt: c.createdAt,
        accounts: userAccounts,
        totalBalance: Number(totalBalance.toFixed(2)),
      };
    });

    res.status(200).json({
      success: true,
      data: {
        customers: enrichedCustomers,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
    });
  } catch (error) {
    console.error('[Staff] Get customers error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving customers.' });
  }
};

/**
 * 3. Get Single Customer Profile & Details
 */
export const getCustomerById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;

    const customer = await User.findOne({ _id: id, role: 'CUSTOMER' });
    if (!customer) {
      res.status(404).json({ success: false, message: 'Customer not found.' });
      return;
    }

    const accounts = await BankAccount.find({ userId: customer._id });
    const accountIds = accounts.map((a) => a._id);

    const [loans, recentTransactions] = await Promise.all([
      Loan.find({ userId: customer._id }).sort({ createdAt: -1 }),
      Transaction.find({
        $or: [{ fromAccount: { $in: accountIds } }, { toAccount: { $in: accountIds } }],
      })
        .populate('fromAccount', 'accountNumber accountType')
        .populate('toAccount', 'accountNumber accountType')
        .sort({ createdAt: -1 })
        .limit(10),
    ]);

    res.status(200).json({
      success: true,
      data: {
        customer: {
          id: customer._id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          address: customer.address,
          status: customer.status,
          createdAt: customer.createdAt,
        },
        accounts,
        loans,
        recentTransactions,
      },
    });
  } catch (error) {
    console.error('[Staff] Get customer details error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving customer details.' });
  }
};

/**
 * 4. Get Account Details
 */
export const getAccountById = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id) {
      res.status(400).json({ success: false, message: 'Account ID is required.' });
      return;
    }

    const isObjectId = mongoose.Types.ObjectId.isValid(id);
    const account = await BankAccount.findOne({
      $or: isObjectId ? [{ _id: id }, { accountNumber: id }] : [{ accountNumber: id }],
    }).populate('userId', 'name email phone status');

    if (!account) {
      res.status(404).json({ success: false, message: 'Bank account not found.' });
      return;
    }

    const transactions = await Transaction.find({
      $or: [{ fromAccount: account._id }, { toAccount: account._id }],
    })
      .sort({ createdAt: -1 })
      .limit(20);

    res.status(200).json({
      success: true,
      data: {
        account,
        transactions,
      },
    });
  } catch (error) {
    console.error('[Staff] Get account details error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving account details.' });
  }
};

/**
 * 5. View/Search All Transactions across Bank
 */
export const getAllTransactions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      search,
      type,
      status,
      isFlagged,
      startDate,
      endDate,
      page = '1',
      limit = '15',
    } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 15));
    const skip = (pageNum - 1) * limitNum;

    const query: any = {};

    if (type && typeof type === 'string' && type !== 'ALL') {
      query.transactionType = type;
    }

    if (status && typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    if (isFlagged !== undefined) {
      query.isFlagged = isFlagged === 'true';
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate as string);
      if (endDate) {
        const end = new Date(endDate as string);
        end.setHours(23, 59, 59, 999);
        query.createdAt.$lte = end;
      }
    }

    if (search && typeof search === 'string') {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ reference: searchRegex }, { description: searchRegex }];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(query)
        .populate('fromAccount', 'accountNumber accountType balance')
        .populate('toAccount', 'accountNumber accountType balance')
        .populate('senderUserId', 'name email')
        .populate('receiverUserId', 'name email')
        .populate('flaggedBy', 'name email role')
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
    console.error('[Staff] Get all transactions error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving transactions.' });
  }
};

/**
 * 6. Flag Suspicious Transaction for Admin
 */
export const flagTransaction = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { flagReason } = req.body;
    const staffId = req.user?.id;

    if (!flagReason || !flagReason.trim()) {
      res.status(400).json({
        success: false,
        message: 'A reason for flagging this transaction is required.',
      });
      return;
    }

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      res.status(404).json({ success: false, message: 'Transaction not found.' });
      return;
    }

    transaction.isFlagged = true;
    transaction.flagReason = flagReason.trim();
    transaction.flaggedBy = staffId as any;
    await transaction.save();

    // Alert Administrators
    const admins = await User.find({ role: 'ADMIN' });
    const notifications = admins.map((admin) => ({
      userId: admin._id,
      title: 'Suspicious Transaction Flagged',
      message: `Transaction ${transaction.reference} was flagged for review. Reason: ${flagReason}`,
      type: 'ALERT' as const,
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    res.status(200).json({
      success: true,
      message: 'Transaction flagged successfully for Admin review.',
      data: transaction,
    });
  } catch (error) {
    console.error('[Staff] Flag transaction error:', error);
    res.status(500).json({ success: false, message: 'Server error flagging transaction.' });
  }
};

/**
 * 7. View All Customer Requests
 */
export const getRequests = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status, type } = req.query;
    const query: any = {};

    if (status && typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    if (type && typeof type === 'string' && type !== 'ALL') {
      query.requestType = type;
    }

    const requests = await Request.find(query)
      .populate('userId', 'name email phone status')
      .populate('accountId', 'accountNumber accountType balance')
      .populate('reviewedBy', 'name email role')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    console.error('[Staff] Get requests error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving requests.' });
  }
};

/**
 * 8. View All Loan Applications
 */
export const getLoans = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { status } = req.query;
    const query: any = {};

    if (status && typeof status === 'string' && status !== 'ALL') {
      query.status = status;
    }

    const loans = await Loan.find(query)
      .populate('userId', 'name email phone address')
      .populate('accountId', 'accountNumber accountType balance')
      .populate('reviewedByStaff', 'name email')
      .populate('approvedBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: loans,
    });
  } catch (error) {
    console.error('[Staff] Get loans error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving loan applications.' });
  }
};

/**
 * 9. Review Loan Application (Staff adds notes & forwards to Admin)
 * STRICT REQUIREMENT: Block Staff from approving or rejecting loans.
 */
export const reviewLoan = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const { staffNotes, status } = req.body;
    const staffId = req.user?.id;

    // Strictly enforce role limitation: Staff CANNOT approve or reject loans
    if (status === 'APPROVED' || status === 'REJECTED') {
      res.status(403).json({
        success: false,
        message:
          'Forbidden: Staff members are strictly prohibited from approving or rejecting loans. Loan approval authority is reserved solely for Administrators.',
      });
      return;
    }

    if (!staffNotes || !staffNotes.trim()) {
      res.status(400).json({
        success: false,
        message: 'Internal staff review notes are required before forwarding to Admin.',
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
        message: `Cannot review loan because it is already ${loan.status}.`,
      });
      return;
    }

    loan.staffNotes = staffNotes.trim();
    loan.reviewedByStaff = staffId as any;
    loan.status = 'UNDER_REVIEW';
    await loan.save();

    // Alert Admin that loan is ready for decision
    const admins = await User.find({ role: 'ADMIN' });
    const notifications = admins.map((admin) => ({
      userId: admin._id,
      title: 'Loan Forwarded for Final Approval',
      message: `Staff forwarded loan application (${loan._id}) for $${loan.amount.toFixed(2)} with internal notes.`,
      type: 'INFO' as const,
    }));

    if (notifications.length > 0) {
      await Notification.insertMany(notifications);
    }

    res.status(200).json({
      success: true,
      message: 'Loan successfully forwarded to Admin under review status.',
      data: loan,
    });
  } catch (error) {
    console.error('[Staff] Review loan error:', error);
    res.status(500).json({ success: false, message: 'Server error updating loan review.' });
  }
};
