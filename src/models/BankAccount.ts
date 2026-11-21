import mongoose, { Document, Schema, Types } from 'mongoose';

export type AccountType = 'SAVINGS' | 'CHECKING' | 'BUSINESS';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface IBankAccount extends Document {
  userId: Types.ObjectId;
  accountNumber: string;
  accountType: AccountType;
  balance: number;
  currency: string;
  status: AccountStatus;
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
      enum: ['SAVINGS', 'CHECKING', 'BUSINESS'],
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
  },
  {
    timestamps: true,
  }
);

export const BankAccount = mongoose.model<IBankAccount>('BankAccount', bankAccountSchema);
