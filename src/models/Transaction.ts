import mongoose, { Document, Schema, Types } from 'mongoose';

export type TransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'TRANSFER'
  | 'LOAN_DISBURSEMENT'
  | 'LOAN_REPAYMENT';
export type TransactionStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export interface ITransaction extends Document {
  transactionType: TransactionType;
  fromAccount?: Types.ObjectId;
  toAccount?: Types.ObjectId;
  senderUserId?: Types.ObjectId;
  receiverUserId?: Types.ObjectId;
  amount: number;
  status: TransactionStatus;
  description?: string;
  reference: string;
  isFlagged: boolean;
  flagReason?: string;
  flaggedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    transactionType: {
      type: String,
      enum: ['DEPOSIT', 'WITHDRAWAL', 'TRANSFER', 'LOAN_DISBURSEMENT', 'LOAN_REPAYMENT'],
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
    senderUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    receiverUserId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
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
    isFlagged: {
      type: Boolean,
      default: false,
    },
    flagReason: {
      type: String,
      default: '',
    },
    flaggedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

export const Transaction = mongoose.model<ITransaction>('Transaction', transactionSchema);
