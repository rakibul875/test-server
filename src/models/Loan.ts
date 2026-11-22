import mongoose, { Document, Schema, Types } from 'mongoose';

export type LoanStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'ACTIVE'
  | 'PAID_OFF';

export interface ILoanRepayment {
  amount: number;
  paidAt: Date;
  transactionReference: string;
}

export interface ILoan extends Document {
  userId: Types.ObjectId;
  accountId: Types.ObjectId;
  amount: number;
  interestRate: number;
  termMonths: number;
  monthlyInstallment: number;
  remainingBalance: number;
  purpose?: string;
  status: LoanStatus;
  staffNotes?: string;
  reviewedByStaff?: Types.ObjectId;
  approvedBy?: Types.ObjectId;
  repayments: ILoanRepayment[];
  createdAt: Date;
  updatedAt: Date;
}

const loanSchema = new Schema<ILoan>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'User reference is required'],
      index: true,
    },
    accountId: {
      type: Schema.Types.ObjectId,
      ref: 'BankAccount',
      required: [true, 'Account reference is required'],
    },
    amount: {
      type: Number,
      required: [true, 'Loan amount is required'],
      min: [100, 'Loan amount must be at least 100'],
    },
    interestRate: {
      type: Number,
      required: [true, 'Interest rate is required'],
      min: [0, 'Interest rate cannot be negative'],
    },
    termMonths: {
      type: Number,
      required: [true, 'Term in months is required'],
      min: [1, 'Term must be at least 1 month'],
    },
    monthlyInstallment: {
      type: Number,
      required: [true, 'Monthly installment is required'],
      min: [0, 'Monthly installment cannot be negative'],
    },
    remainingBalance: {
      type: Number,
      required: [true, 'Remaining balance is required'],
      min: [0, 'Remaining balance cannot be negative'],
    },
    purpose: {
      type: String,
      default: '',
      trim: true,
    },
    status: {
      type: String,
      enum: ['PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'ACTIVE', 'PAID_OFF'],
      default: 'PENDING',
    },
    staffNotes: {
      type: String,
      default: '',
      trim: true,
    },
    reviewedByStaff: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    repayments: [
      {
        amount: { type: Number, required: true },
        paidAt: { type: Date, default: Date.now },
        transactionReference: { type: String, required: true },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export const Loan = mongoose.model<ILoan>('Loan', loanSchema);
