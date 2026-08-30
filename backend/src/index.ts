/**
 * ReviveAI Backend — Express Entry Point
 * Day 1: skeleton with health check and CORS.
 * Full routes added in Day 2.
 */

import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(helmet());
app.use(
  cors({
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(morgan('dev'));

// ─── Routes ──────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reviveai-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    mode: 'demo',
  });
});

// API v1 router (populated in Day 2+)
app.get('/api/v1', (_req, res) => {
  res.json({
    message: 'ReviveAI API v1',
    endpoints: [
      'GET  /api/v1/transactions',
      'GET  /api/v1/transactions/:id',
      'POST /api/v1/agent/analyze/:transactionId',
      'POST /api/v1/simulation/run',
      'GET  /api/v1/simulation/runs',
      'GET  /api/v1/audit',
      'GET  /api/v1/policies',
      'GET  /api/v1/review/queue',
      'POST /api/v1/review/:actionId/approve',
      'POST /api/v1/review/:actionId/reject',
      'POST /api/v1/review/:actionId/stop',
    ],
  });
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({
    error: err.message || 'Internal server error',
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`🚀 ReviveAI backend running on http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   API:    http://localhost:${PORT}/api/v1`);
  console.log(`   Mode:   ${process.env.NODE_ENV || 'development'}`);
});

export default app;
