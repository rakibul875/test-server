import { Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User } from '../models/User';
import { BankAccount } from '../models/BankAccount';
import { Notification } from '../models/Notification';
import { AuthRequest } from '../middlewares/authMiddleware';
import { generateAccountNumber } from '../utils/helpers';

export const register = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { name, email, password, phone, address, transactionPin } = req.body;

    // Validate inputs
    if (!name || !email || !password || !transactionPin) {
      res.status(400).json({
        success: false,
        message: 'Name, email, password, and a 4-digit transaction PIN are required.',
      });
      return;
    }

    if (!/^\d{4}$/.test(transactionPin)) {
      res.status(400).json({
        success: false,
        message: 'Transaction PIN must be exactly 4 numeric digits.',
      });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'An account with this email address already exists.',
      });
      return;
    }

    // Hash credentials
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(transactionPin, 10);

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      transactionPin: hashedPin,
      role: 'CUSTOMER',
      phone: phone?.trim() || '',
      address: address?.trim() || '',
      status: 'ACTIVE',
    });

    // Automatically provision initial primary bank account
    const initialAccount = await BankAccount.create({
      userId: user._id,
      accountNumber: generateAccountNumber('SAVINGS'),
      accountType: 'SAVINGS',
      balance: 0,
      currency: 'USD',
      status: 'ACTIVE',
      dailyLimit: 10000,
      maxSingleLimit: 5000,
      minBalance: 0,
    });

    // Send welcome notification
    await Notification.create({
      userId: user._id,
      title: 'Welcome to Apex Digital Banking',
      message: `Your customer profile and primary Savings Account (${initialAccount.accountNumber}) have been created successfully.`,
      type: 'INFO',
    });

    const jwtSecret = process.env.JWT_SECRET || 'banking_secret_key_2026';
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      { expiresIn: '1d' }
    );

    res.status(201).json({
      success: true,
      message: 'Customer registered successfully.',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          address: user.address,
          status: user.status,
        },
        account: initialAccount,
      },
    });
  } catch (error) {
    console.error('[Auth] Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required.' });
      return;
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');
    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    if (user.status !== 'ACTIVE') {
      res.status(403).json({
        success: false,
        message: `Account is currently ${user.status.toLowerCase()}. Please contact bank support.`,
      });
      return;
    }

    const isMatch = await bcrypt.compare(password, user.password || '');
    if (!isMatch) {
      res.status(401).json({ success: false, message: 'Invalid email or password.' });
      return;
    }

    const jwtSecret = process.env.JWT_SECRET || 'banking_secret_key_2026';
    const token = jwt.sign(
      {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
      },
      jwtSecret,
      { expiresIn: '1d' }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          address: user.address,
          status: user.status,
        },
      },
    });
  } catch (error) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found.' });
      return;
    }

    // Fetch user's bank accounts
    const accounts = await BankAccount.find({ userId: user._id });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          address: user.address,
          status: user.status,
          createdAt: user.createdAt,
        },
        accounts,
      },
    });
  } catch (error) {
    console.error('[Auth] Profile fetch error:', error);
    res.status(500).json({ success: false, message: 'Server error retrieving profile.' });
  }
};
