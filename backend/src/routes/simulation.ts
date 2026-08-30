/**
 * Simulation routes
 *   POST /api/v1/simulation/run      — start a batch simulation run
 *   GET  /api/v1/simulation/latest   — fetch the most recent run
 *   GET  /api/v1/simulation/:id      — fetch a specific run by ID
 *   GET  /api/v1/simulation          — list all runs (most recent first)
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { runSimulation } from '../services/simulationEngine';

const router = Router();

// ─── POST /api/v1/simulation/run ──────────────────────────────────────────────

router.post('/run', async (_req: Request, res: Response) => {
  console.log('[Simulation] Starting batch run across full dataset...');
  const startAt = new Date().toISOString();

  const result = await runSimulation();

  console.log(`[Simulation] Completed in ${result.durationMs}ms — recovered ₹${result.recoveredAmount.toFixed(0)}`);

  res.json({
    status: 'completed',
    runId: result.runId,
    startedAt: startAt,
    completedAt: new Date().toISOString(),
    aggregates: {
      totalTransactions: result.totalTransactions,
      atRiskCount: result.atRiskCount,
      atRiskAmount: Math.round(result.atRiskAmount),
      opportunityCount: result.opportunityCount,
      approvedCount: result.approvedCount,
      executedCount: result.executedCount,
      escalatedCount: result.escalatedCount,
      stoppedCount: result.stoppedCount,
      recoveredCount: result.recoveredCount,
      recoveredAmount: Math.round(result.recoveredAmount),
      recoveryRate: result.recoveryRate,
    },
    meta: {
      diagnosisMode: result.diagnosisMode,
      seed: result.seed,
      durationMs: result.durationMs,
      durationSeconds: parseFloat((result.durationMs / 1000).toFixed(1)),
    },
    funnelData: result.funnelData,
  });
});

// ─── GET /api/v1/simulation/latest ────────────────────────────────────────────

router.get('/latest', async (_req: Request, res: Response) => {
  const run = await prisma.simulationRun.findFirst({
    orderBy: { completedAt: 'desc' },
  });

  if (!run) {
    res.status(404).json({ error: 'No simulation runs found. POST /api/v1/simulation/run to start one.' });
    return;
  }

  res.json(formatRun(run));
});

// ─── GET /api/v1/simulation ───────────────────────────────────────────────────

router.get('/', async (_req: Request, res: Response) => {
  const runs = await prisma.simulationRun.findMany({
    orderBy: { completedAt: 'desc' },
    take: 20,
  });
  res.json({ runs: runs.map(formatRun), count: runs.length });
});

// ─── GET /api/v1/simulation/:id ───────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const run = await prisma.simulationRun.findUnique({ where: { id } });

  if (!run) {
    res.status(404).json({ error: `Simulation run ${id} not found` });
    return;
  }

  res.json(formatRun(run));
});

// ─── Helper ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatRun(run: any) {
  return {
    id: run.id,
    completedAt: run.completedAt,
    durationMs: run.durationMs,
    durationSeconds: parseFloat((run.durationMs / 1000).toFixed(1)),
    seed: run.seed,
    aggregates: {
      totalTransactions: run.totalTransactions,
      atRiskCount: run.atRiskCount,
      atRiskAmount: Math.round(run.atRiskAmount),
      opportunityCount: run.opportunityCount,
      approvedCount: run.approvedCount,
      executedCount: run.executedCount,
      escalatedCount: run.escalatedCount,
      stoppedCount: run.stoppedCount,
      recoveredCount: run.recoveredCount,
      recoveredAmount: Math.round(run.recoveredAmount),
      recoveryRate: run.recoveryRate,
    },
    funnelData: run.funnelData,
    meta: {
      diagnosisMode: 'deterministic',
      seed: 'reviveai-demo-seed-1',
    },
  };
}

export default router;
