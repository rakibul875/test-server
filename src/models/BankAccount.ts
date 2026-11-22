import mongoose, { Document, Schema, Types } from 'mongoose';

export type AccountType = 'SAVINGS' | 'CHECKING' | 'CURRENT' | 'BUSINESS';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface IBankAccount extends Document {
  userId: Types.ObjectId;
  accountNumber: string;
  accountType: AccountType;
  balance: number;
  currency: string;
  status: AccountStatus;
  dailyLimit: number;
  maxSingleLimit: number;
  minBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

const bankAccountSchema = new Schema<IBankAccount>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    accountNumber: {
      type: String,
      required: [true, 'Account number is required'],
      unique: true,
      trim: true,
    },
    accountType: {
      type: String,
      enum: ['SAVINGS', 'CHECKING', 'CURRENT', 'BUSINESS'],
      default: 'SAVINGS',
    },
    balance: {
      type: Number,
      default: 0,
      min: [0, 'Balance cannot be negative'],
    },
    currency: {
      type: String,
      default: 'USD',
      trim: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'FROZEN', 'CLOSED'],
      default: 'ACTIVE',
    },
    dailyLimit: {
      type: Number,
      default: 10000,
      min: [0, 'Daily limit cannot be negative'],
    },
    maxSingleLimit: {
      type: Number,
      default: 5000,
      min: [0, 'Max single limit cannot be negative'],
    },
    minBalance: {
      type: Number,
      default: 0,
      min: [0, 'Minimum balance cannot be negative'],
    },
  },
  {
    timestamps: true,
  }
);

export const BankAccount = mongoose.model<IBankAccount>('BankAccount', bankAccountSchema);
