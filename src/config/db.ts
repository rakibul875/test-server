import mongoose from 'mongoose';

export const connectDB = async (): Promise<void> => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/bank';
    const conn = await mongoose.connect(mongoUri, { dbName: 'bank' });
    const activeDb = conn.connection.db?.databaseName || conn.connection.name || 'bank';
    console.log(`[Database] MongoDB Connected: ${conn.connection.host} | Database: ${activeDb}`);
  } catch (error) {
    console.error('[Database] Connection Error:', error);
    process.exit(1);
  }
};
