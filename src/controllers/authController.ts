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

    // Validate name
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        success: false,
        message: 'Full legal name is required.',
      });
      return;
    }

    // Validate email
    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({
        success: false,
        message: 'Email address is required.',
      });
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      res.status(400).json({
        success: false,
        message: 'Please provide a valid email address.',
      });
      return;
    }

    // Validate password
    if (!password || typeof password !== 'string' || password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    // Validate transaction PIN
    if (!transactionPin) {
      res.status(400).json({
        success: false,
        message: 'A 4-digit transaction PIN is required.',
      });
      return;
    }

    const pinStr = String(transactionPin).trim();
    if (!/^\d{4}$/.test(pinStr)) {
      res.status(400).json({
        success: false,
        message: 'Transaction PIN must consist of exactly 4 numeric digits.',
      });
      return;
    }

    const cleanEmail = email.toLowerCase().trim();
    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in instead.',
      });
      return;
    }

    // Hash credentials
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(pinStr, 10);

    const user = await User.create({
      name: name.trim(),
      email: cleanEmail,
      password: hashedPassword,
      transactionPin: hashedPin,
      role: 'CUSTOMER',
      phone: phone ? String(phone).trim() : '',
      address: address ? String(address).trim() : '',
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
          id: user._id.toString(),
          _id: user._id.toString(),
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
  } catch (error: any) {
    console.error('[Auth] Register error:', error);
    if (error?.code === 11000) {
      res.status(409).json({
        success: false,
        message: 'An account with this email address already exists. Please log in.',
      });
      return;
    }
    res.status(500).json({
      success: false,
      message: error?.message || 'Server error occurred during customer registration.',
    });
  }
};

export const login = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Both email address and password are required.',
      });
      return;
    }

    const cleanEmail = String(email).toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail }).select('+password');
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
      return;
    }

    if (user.status === 'BLOCKED') {
      res.status(403).json({
        success: false,
        message: 'Your account has been suspended or blocked. Please contact customer support.',
      });
      return;
    }

    if (user.status === 'INACTIVE') {
      res.status(403).json({
        success: false,
        message: 'Your account is inactive. Please contact bank administration.',
      });
      return;
    }

    const isMatch = await bcrypt.compare(String(password), user.password || '');
    if (!isMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email address or password.',
      });
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
          id: user._id.toString(),
          _id: user._id.toString(),
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          address: user.address,
          status: user.status,
        },
      },
    });
  } catch (error: any) {
    console.error('[Auth] Login error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Server error occurred during login authentication.',
    });
  }
};

export const getProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Unauthorized session.' });
      return;
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found.' });
      return;
    }

    // Fetch user's bank accounts
    const accounts = await BankAccount.find({ userId: user._id });

    res.status(200).json({
      success: true,
      data: {
        user: {
          id: user._id.toString(),
          _id: user._id.toString(),
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
  } catch (error: any) {
    console.error('[Auth] Profile fetch error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Server error retrieving user profile.',
    });
  }
};
