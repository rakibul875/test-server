import mongoose, { ClientSession } from 'mongoose';

/**
 * Generate unique bank account number
 */
export const generateAccountNumber = (accountType = 'SAVINGS'): string => {
  const typeCode =
    accountType === 'CHECKING' || accountType === 'CURRENT'
      ? '100'
      : accountType === 'BUSINESS'
      ? '300'
      : '200';
  const randomPart1 = Math.floor(1000 + Math.random() * 9000);
  const randomPart2 = Math.floor(100000 + Math.random() * 900000);
  return `ACC-${typeCode}${randomPart1}-${randomPart2}`;
};

/**
 * Generate unique transaction reference code
 */
export const generateTransactionRef = (type = 'TXN'): string => {
  const timeHex = Date.now().toString(36).toUpperCase();
  const randHex = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `${type}-${timeHex}-${randHex}`;
};

/**
 * Execute work inside a MongoDB transaction with automatic fallback
 * for standalone MongoDB instances that do not support replica set transactions.
 */
export const executeTransaction = async <T>(
  callback: (session: ClientSession | null) => Promise<T>
): Promise<T> => {
  let session: ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error: any) {
    if (session) {
      try {
        await session.abortTransaction();
      } catch (abortErr) {
        // Ignored if abort fails
      }
    }

    // Check if error is due to MongoDB standalone without replica set
    const isStandaloneError =
      error?.message?.includes('replica set member or mongos') ||
      error?.codeName === 'IllegalOperation' ||
      error?.code === 20;

    if (isStandaloneError) {
      // Re-run without session
      return await callback(null);
    }

    throw error;
  } finally {
    if (session) {
      session.endSession();
    }
  }
};
