import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Transaction } from '../models/Transaction';
import { Request } from '../models/Request';
import { Loan } from '../models/Loan';
import { Notification } from '../models/Notification';

export const seedDatabase = async (): Promise<void> => {
  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/bank';

  try {
    console.log('[Seed] Connecting to MongoDB...');
    const conn = await mongoose.connect(mongoUri, { dbName: 'bank' });
    const activeDb = conn.connection.db?.databaseName || conn.connection.name || 'bank';
    console.log(`[Seed] Connected to MongoDB: ${conn.connection.host} | Database: ${activeDb}`);

    const defaultPassword = await bcrypt.hash('Password123!', 10);
    const defaultPin = await bcrypt.hash('1234', 10);

    // 1. Ensure Demo Admin
    let admin = await User.findOne({ email: 'admin@bank.com' });
    if (!admin) {
      admin = await User.create({
        name: 'System Admin',
        email: 'admin@bank.com',
        password: defaultPassword,
        transactionPin: defaultPin,
        role: 'ADMIN',
        phone: '+1 800 555 0100',
        address: '100 Financial Center, New York, NY 10005',
        status: 'ACTIVE',
      });
      console.log('[Seed] Created Admin user (admin@bank.com).');
    } else {
      admin.password = defaultPassword;
      admin.transactionPin = defaultPin;
      admin.status = 'ACTIVE';
      await admin.save();
      console.log('[Seed] Verified Admin user (admin@bank.com).');
    }

    // 2. Ensure Demo Staff
    let staff = await User.findOne({ email: 'staff@bank.com' });
    if (!staff) {
      staff = await User.create({
        name: 'Sarah Jenkins',
        email: 'staff@bank.com',
        password: defaultPassword,
        transactionPin: defaultPin,
        role: 'STAFF',
        phone: '+1 800 555 0101',
        address: '102 Financial Center, New York, NY 10005',
        status: 'ACTIVE',
      });
      console.log('[Seed] Created Staff user (staff@bank.com).');
    } else {
      staff.password = defaultPassword;
      staff.transactionPin = defaultPin;
      staff.status = 'ACTIVE';
      await staff.save();
      console.log('[Seed] Verified Staff user (staff@bank.com).');
    }

    // 3. Ensure Demo Customer
    let customer = await User.findOne({ email: 'customer@bank.com' });
    if (!customer) {
      customer = await User.create({
        name: 'Alex Morgan',
        email: 'customer@bank.com',
        password: defaultPassword,
        transactionPin: defaultPin,
        role: 'CUSTOMER',
        phone: '+1 555 234 5678',
        address: '742 Evergreen Terrace, Springfield, OR 97477',
        status: 'ACTIVE',
      });
      console.log('[Seed] Created Customer user (customer@bank.com).');
    } else {
      customer.password = defaultPassword;
      customer.transactionPin = defaultPin;
      customer.status = 'ACTIVE';
      await customer.save();
      console.log('[Seed] Verified Customer user (customer@bank.com).');
    }

    // 4. Ensure Bank Accounts for Customer
    let checkingAccount = await BankAccount.findOne({
      userId: customer._id,
      accountType: { $in: ['CHECKING', 'CURRENT'] },
    });
    if (!checkingAccount) {
      checkingAccount = await BankAccount.create({
        userId: customer._id,
        accountNumber: 'ACC-1001-982341',
        accountType: 'CURRENT',
        balance: 5420.5,
        currency: 'USD',
        status: 'ACTIVE',
        dailyLimit: 10000,
        maxSingleLimit: 5000,
        minBalance: 0,
      });
      console.log('[Seed] Created Customer current account: ACC-1001-982341.');
    }

    let savingsAccount = await BankAccount.findOne({
      userId: customer._id,
      accountType: 'SAVINGS',
    });
    if (!savingsAccount) {
      savingsAccount = await BankAccount.create({
        userId: customer._id,
        accountNumber: 'ACC-2002-837192',
        accountType: 'SAVINGS',
        balance: 24850.75,
        currency: 'USD',
        status: 'ACTIVE',
        dailyLimit: 15000,
        maxSingleLimit: 8000,
        minBalance: 100,
      });
      console.log('[Seed] Created Customer savings account: ACC-2002-837192.');
    }

    // 5. Ensure Sample Transactions
    const txnCount = await Transaction.countDocuments({
      $or: [{ senderUserId: customer._id }, { receiverUserId: customer._id }],
    });
    if (txnCount === 0) {
      await Transaction.create([
        {
          transactionType: 'DEPOSIT',
          toAccount: checkingAccount._id,
          receiverUserId: customer._id,
          amount: 5000.0,
          status: 'COMPLETED',
          description: 'Payroll Direct Deposit - Acme Corp',
          reference: 'TXN-DEP-884102',
        },
        {
          transactionType: 'TRANSFER',
          fromAccount: checkingAccount._id,
          toAccount: savingsAccount._id,
          senderUserId: customer._id,
          receiverUserId: customer._id,
          amount: 1500.0,
          status: 'COMPLETED',
          description: 'Monthly Automated Savings Transfer',
          reference: 'TXN-TRF-992314',
        },
        {
          transactionType: 'WITHDRAWAL',
          fromAccount: checkingAccount._id,
          senderUserId: customer._id,
          amount: 79.5,
          status: 'COMPLETED',
          description: 'Supermarket Grocery Purchase',
          reference: 'TXN-WTH-110293',
        },
        {
          transactionType: 'TRANSFER',
          fromAccount: savingsAccount._id,
          toAccount: checkingAccount._id,
          senderUserId: customer._id,
          receiverUserId: customer._id,
          amount: 12500.0,
          status: 'COMPLETED',
          description: 'Large internal funds allocation',
          reference: 'TXN-TRF-774910',
          isFlagged: true,
          flagReason: 'Automated AML: Transfer of $12,500.00 meets or exceeds $10,000 threshold.',
        },
      ]);
      console.log('[Seed] Created sample transactions.');
    }

    // 6. Ensure Sample Loans
    const loanCount = await Loan.countDocuments({ userId: customer._id });
    if (loanCount === 0) {
      await Loan.create({
        userId: customer._id,
        accountId: checkingAccount._id,
        amount: 15000,
        interestRate: 5.5,
        termMonths: 36,
        monthlyInstallment: 452.95,
        remainingBalance: 12230.15,
        purpose: 'Home Energy Efficiency Upgrades',
        status: 'ACTIVE',
        approvedBy: admin._id,
        reviewedByStaff: staff._id,
        staffNotes: 'Customer credit score verified at 780. Stable employment history.',
        repayments: [
          {
            amount: 452.95,
            paidAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            transactionReference: 'LRP-OCT-001',
          },
        ],
      });

      await Loan.create({
        userId: customer._id,
        accountId: savingsAccount._id,
        amount: 5000,
        interestRate: 6.5,
        termMonths: 12,
        monthlyInstallment: 444.17,
        remainingBalance: 5330.0,
        purpose: 'Education Tuition Installment',
        status: 'UNDER_REVIEW',
        reviewedByStaff: staff._id,
        staffNotes: 'Application documents submitted and verified by branch staff.',
      });
      console.log('[Seed] Created sample loans.');
    }

    // 7. Ensure Sample Requests
    const reqCount = await Request.countDocuments({ userId: customer._id });
    if (reqCount === 0) {
      await Request.create([
        {
          userId: customer._id,
          accountId: checkingAccount._id,
          requestType: 'DEPOSIT',
          amount: 2500,
          title: 'Check Deposit Request',
          description: 'Cashier check deposit endorsement #992144',
          status: 'PENDING',
        },
        {
          userId: customer._id,
          accountId: checkingAccount._id,
          requestType: 'CARD_REPLACEMENT',
          amount: 0,
          title: 'Debit Card Replacement Request',
          description: 'Requesting replacement contactless debit card due to chip read errors.',
          status: 'PENDING',
        },
      ]);
      console.log('[Seed] Created sample customer requests.');
    }

    // 8. Ensure Notifications
    const notifCount = await Notification.countDocuments();
    if (notifCount === 0) {
      await Notification.create([
        {
          userId: customer._id,
          title: 'Welcome to Apex Digital Banking',
          message: 'Your online banking profile and primary accounts have been successfully established.',
          type: 'INFO',
          isRead: false,
        },
        {
          userId: customer._id,
          title: 'Deposit Received',
          message: 'A deposit of $5,000.00 was posted to your Checking Account (ACC-1001-982341).',
          type: 'TRANSACTION',
          isRead: true,
        },
        {
          userId: staff._id,
          title: 'Pending Card Request',
          message: 'Customer Alex Morgan submitted a card replacement request requiring verification.',
          type: 'ALERT',
          isRead: false,
        },
        {
          userId: admin._id,
          title: 'Flagged Transaction Alert',
          message: 'A transfer of $12,500.00 (TXN-TRF-774910) was automatically flagged for AML review.',
          type: 'ALERT',
          isRead: false,
        },
      ]);
      console.log('[Seed] Created sample notifications.');
    }

    console.log('\n================ DEMO ACCOUNTS SEEDED (DATABASE: bank) ================');
    console.log('Password for all accounts: Password123!');
    console.log('Transaction PIN for all accounts: 1234\n');
    console.log('1. Admin:    admin@bank.com');
    console.log('2. Staff:    staff@bank.com');
    console.log('3. Customer: customer@bank.com');
    console.log('========================================================================\n');
  } catch (error) {
    console.error('[Seed] Error populating database:', error);
  } finally {
    await mongoose.disconnect();
    console.log('[Seed] Database disconnected.');
  }
};

// Execute if run directly
seedDatabase();
