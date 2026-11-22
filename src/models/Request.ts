import mongoose, { Document, Schema, Types } from 'mongoose';

export type RequestType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'ACCOUNT_OPENING'
  | 'LOAN_APPLICATION'
  | 'CARD_REPLACEMENT'
  | 'SUPPORT_TICKET';
export type RequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface IRequest extends Document {
  userId: Types.ObjectId;
  accountId?: Types.ObjectId;
  requestType: RequestType;
  amount?: number;
  title: string;
  description: string;
  data?: Record<string, any>;
  status: RequestStatus;
  reviewedBy?: Types.ObjectId;
  reviewNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

const requestSchema = new Schema<IRequest>(
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
      default: null,
    },
    requestType: {
      type: String,
      enum: [
        'DEPOSIT',
        'WITHDRAWAL',
        'ACCOUNT_OPENING',
        'LOAN_APPLICATION',
        'CARD_REPLACEMENT',
        'SUPPORT_TICKET',
      ],
      required: [true, 'Request type is required'],
    },
    amount: {
      type: Number,
      default: 0,
      min: [0, 'Amount cannot be negative'],
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: {},
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED'],
      default: 'PENDING',
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewNotes: {
      type: String,
      default: '',
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export const Request = mongoose.model<IRequest>('Request', requestSchema);
