import mongoose, { Document, Schema, Types } from 'mongoose';

export type TransactionType = 'DEPOSIT' | 'WITHDRAWAL' | 'TRANSFER';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ITransaction extends Document {
  transactionType: TransactionType;
  fromAccount?: Types.ObjectId;
  toAccount?: Types.ObjectId;
  amount: number;
  status: TransactionStatus;
  description?: string;
  reference: string;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    transactionType: {
      type: String,
      enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER'],
      required: [true, 'Transaction type is required'],
    },
    fromAccount: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      default: null,
    },
    toAccount: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      default: null,
    },
    amount: {
      type: Number,
      required: [true, 'Transaction amount is required'],
      min: [0.01, 'Amount must be greater than zero'],
    },
    status: {
      type: String,
      enum: ['PENDING', 'COMPLETED', 'FAILED'],
      default: 'COMPLETED',
    },
    description: {
      type: String,
      trim: true,
      default: '',
    },
    reference: {
      type: String,
      required: [true, 'Transaction reference code is required'],
      unique: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
