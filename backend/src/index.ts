/**
 * ReviveAI Backend — Express Entry Point
 * Day 2: Transaction API + Risk Engine + AI Diagnosis + Recovery Strategy wired up.
 */

import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

dotenv.config();

import transactionsRouter from './routes/transactions';
import riskRouter from './routes/risk';
import agentRouter from './routes/agent';

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

// ─── Health ───────────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reviveai-backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    mode: 'demo',
    ai: process.env.GEMINI_API_KEY ? 'gemini-enabled' : 'fallback-only',
  });
});

// ─── API v1 ───────────────────────────────────────────────────────────────────

app.get('/api/v1', (_req, res) => {
  res.json({
    message: 'ReviveAI API v1',
    day: 2,
    endpoints: {
      transactions: [
        'GET  /api/v1/transactions                  — list with pagination, filters, search',
        'GET  /api/v1/transactions/:id              — full detail with relations',
      ],
      risk: [
        'GET  /api/v1/risk/summary                  — aggregate risk stats (real computed)',
        'GET  /api/v1/risk/transaction/:id          — per-transaction risk assessment',
      ],
      agent: [
        'POST /api/v1/agent/analyze/:transactionId  — full pipeline: risk→diagnosis→strategy',
      ],
      comingDay3: [
        'POST /api/v1/guardrails/check/:id          — deterministic guardrail engine',
        'POST /api/v1/recovery/execute/:id          — bounded executor',
      ],
      comingDay4: [
        'POST /api/v1/simulation/run',
        'GET  /api/v1/simulation/runs',
      ],
      comingDay5: [
        'GET  /api/v1/audit',
        'GET  /api/v1/review/queue',
        'POST /api/v1/review/:actionId/approve',
        'POST /api/v1/review/:actionId/reject',
        'POST /api/v1/review/:actionId/stop',
      ],
    },
  });
});

// ─── Routers ──────────────────────────────────────────────────────────────────

app.use('/api/v1/transactions', transactionsRouter);
app.use('/api/v1/risk', riskRouter);
app.use('/api/v1/agent/analyze', agentRouter);

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
  console.log(`   AI:     ${process.env.GEMINI_API_KEY ? '✅ Gemini enabled' : '⚠️  Fallback mode (no GEMINI_API_KEY)'}`);
});

export default app;
