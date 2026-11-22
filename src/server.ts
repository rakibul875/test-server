import dotenv from 'dotenv';
dotenv.config();

import express, { Application, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { connectDB } from './config/db';
import apiRoutes from './routes';

const app: Application = express();
const PORT = process.env.PORT || 5000;

// Connect to Database
connectDB();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api', apiRoutes);

// Root route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({
    message: 'Digital Banking API is running.',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// 404 Handler
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Resource not found: ${req.method} ${req.originalUrl}`,
  });
});

// Global Error Handler
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('[Error] Unhandled error:', err.stack || err.message);
  res.status(500).json({
    success: false,
    message: 'Internal server error occurred.',
  });
});

// Server Initialization
app.listen(PORT, () => {
  console.log(`[Server] Banking backend running at http://localhost:${PORT}`);
});

export default app;
