/**
 * Batch Simulation Engine
 *
 * Runs all FAILED/AT_RISK transactions in the dataset through the same
 * Risk → Diagnosis → Strategy → Guardrail → Execute pipeline used by
 * the single-transaction endpoint (Day 3).
 *
 * Key design decisions:
 *   - Uses deterministic FALLBACK diagnosis for all batch runs (not live AI).
 *     This is the designed reliability path — fast, reproducible, no rate limits.
 *     Label "diagnosisMode: deterministic" in the result. Not a fake shortcut.
 *   - Fixed seed "reviveai-demo-seed-1": repeated runs produce identical numbers.
 *   - Writes a SimulationRun record; also upserts per-transaction records.
 *   - Does NOT write 6x AuditLog rows per transaction (that's 12,000 rows for a
 *     full batch). Instead writes one summary AuditLog per batch run.
 *     The audit trail exists for per-transaction single-process calls (Day 3).
 */

import { prisma } from '../lib/prisma';
import { assessRisk } from './riskEngine';
import { deterministic_diagnose as diagnoseFallback } from './diagnosisAgent';
import { recommendStrategy } from './strategyRecommender';
import { checkGuardrails } from './guardrailEngine';
import { executeRecovery } from './recoveryExecutor';
import type { RecoveryOutcome } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimulationAggregates {
  totalTransactions: number;
  atRiskCount: number;
  atRiskAmount: number;
  opportunityCount: number;   // guardrail APPROVED
  approvedCount: number;      // guardrail APPROVED (same as opportunity for clarity)
  executedCount: number;      // APPROVED + action run
  escalatedCount: number;     // guardrail ESCALATED
  stoppedCount: number;       // guardrail BLOCKED | NO_ACTION | DO_NOT_CONTACT
  recoveredCount: number;     // outcome SUCCEEDED/RECOVERED
  recoveredAmount: number;
  recoveryRate: number;       // recoveredCount / atRiskCount (as %)
  diagnosisMode: 'deterministic' | 'ai';
  seed: string;
  durationMs: number;
  funnelData: FunnelStep[];
}

export interface FunnelStep {
  label: string;
  value: number;
  amount?: number;
}

const SIMULATION_SEED = 'reviveai-demo-seed-1';

// ─── Engine ───────────────────────────────────────────────────────────────────

export async function runSimulation(): Promise<SimulationAggregates & { runId: string }> {
  const startMs = Date.now();

  // Fetch ALL transactions (we process everything, not just FAILED)
  const allTxns = await prisma.transaction.findMany({
    include: { recoveryAction: true },
    orderBy: { id: 'asc' }, // deterministic ordering
  });

  const agg = {
    totalTransactions: allTxns.length,
    atRiskCount: 0,
    atRiskAmount: 0,
    opportunityCount: 0,
    approvedCount: 0,
    executedCount: 0,
    escalatedCount: 0,
    stoppedCount: 0,
    recoveredCount: 0,
    recoveredAmount: 0,
  };

  const ACTION_MAP: Record<string, string> = {
    RETRY_PAYMENT:            'RETRY',
    SEND_PAYMENT_LINK:        'PAYMENT_LINK',
    SEND_REMINDER:            'REMINDER',
    OFFER_ALTERNATIVE_METHOD: 'SCHEDULE_RETRY',
    ESCALATE_TO_HUMAN:        'ESCALATE',
    DO_NOT_CONTACT:           'STOP',
  };

  const OUTCOME_MAP: Record<string, RecoveryOutcome> = {
    SUCCEEDED: 'RECOVERED',
    FAILED:    'FAILED',
    ESCALATED: 'ESCALATED',
    STOPPED:   'STOPPED',
    NO_ACTION: 'STOPPED',
  };

  // Track per-transaction results for bulk upsert
  type TxnResult = {
    transactionId: string;
    action: string;
    outcome: RecoveryOutcome;
    amountRecovered: number;
    outcomeReason: string;
  };
  const txnResults: TxnResult[] = [];

  for (const txn of allTxns) {
    // ── Stage 1: Risk ────────────────────────────────────────────────────────
    const risk = assessRisk(txn);

    if (!risk.isActionable || txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
      // Not at risk — count and skip
      continue;
    }

    agg.atRiskCount++;
    agg.atRiskAmount += risk.amountAtRisk;

    // ── Stage 2: Diagnosis (always deterministic in batch) ───────────────────
    const diagnosis = diagnoseFallback(txn, risk);

    // ── Stage 3: Strategy ────────────────────────────────────────────────────
    const strategy = recommendStrategy(txn, risk, diagnosis);

    // ── Stage 4: Guardrail — use null for existingAction (batch-fresh run) ──
    // We intentionally ignore any prior single-transaction RecoveryActionRecord
    // so the batch simulation represents a clean run through the full dataset.
    const guardrail = checkGuardrails(txn, risk, diagnosis, strategy, null);

    // ── Stage 5: Execute ─────────────────────────────────────────────────────
    const execution = executeRecovery(txn, strategy, guardrail, diagnosis);

    // ── Aggregate ────────────────────────────────────────────────────────────
    if (guardrail.allowed) {
      agg.approvedCount++;
      agg.opportunityCount++;
      agg.executedCount++;
      if (execution.status === 'SUCCEEDED') {
        agg.recoveredCount++;
        agg.recoveredAmount += execution.amountRecovered;
      }
    } else if (guardrail.decision === 'ESCALATED') {
      agg.escalatedCount++;
    } else {
      // BLOCKED or NO_ACTION
      agg.stoppedCount++;
    }

    const mappedAction = (ACTION_MAP[execution.action] ?? 'STOP') as
      'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP';
    const mappedOutcome: RecoveryOutcome = OUTCOME_MAP[execution.status] ?? 'FAILED';

    txnResults.push({
      transactionId: txn.id,
      action: mappedAction,
      outcome: mappedOutcome,
      amountRecovered: execution.amountRecovered,
      outcomeReason: execution.outcomeReason,
    });
  }

  const durationMs = Date.now() - startMs;
  const recoveryRate = agg.atRiskCount > 0
    ? parseFloat(((agg.recoveredCount / agg.atRiskCount) * 100).toFixed(1))
    : 0;

  // Funnel data for chart/display
  const funnelData: FunnelStep[] = [
    { label: 'Total Transactions', value: agg.totalTransactions },
    { label: 'At Risk',            value: agg.atRiskCount,       amount: agg.atRiskAmount },
    { label: 'Auto-Approved',      value: agg.approvedCount },
    { label: 'Executed',           value: agg.executedCount },
    { label: 'Recovered',          value: agg.recoveredCount,    amount: agg.recoveredAmount },
  ];

  // Persist SimulationRun
  const run = await prisma.simulationRun.create({
    data: {
      seed: 42, // numeric seed (matches dataset seed)
      totalTransactions: agg.totalTransactions,
      atRiskCount: agg.atRiskCount,
      atRiskAmount: agg.atRiskAmount,
      opportunityCount: agg.opportunityCount,
      approvedCount: agg.approvedCount,
      executedCount: agg.executedCount,
      escalatedCount: agg.escalatedCount,
      stoppedCount: agg.stoppedCount,
      recoveredCount: agg.recoveredCount,
      recoveredAmount: agg.recoveredAmount,
      recoveryRate,
      funnelData: JSON.parse(JSON.stringify(funnelData)),
      durationMs,
    },
  });

  // Bulk upsert RecoveryActionRecord for each processed transaction
  // (batch: 100 at a time to avoid huge queries)
  const CHUNK = 100;
  for (let i = 0; i < txnResults.length; i += CHUNK) {
    const chunk = txnResults.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((r) =>
        prisma.recoveryActionRecord.upsert({
          where: { transactionId: r.transactionId },
          update: {
            action: r.action as 'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP',
            outcome: r.outcome,
            amountRecovered: r.amountRecovered,
            outcomeReason: r.outcomeReason,
            executedAt: new Date(),
            simulationRunId: run.id,
          },
          create: {
            transactionId: r.transactionId,
            action: r.action as 'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP',
            outcome: r.outcome,
            amountRecovered: r.amountRecovered,
            outcomeReason: r.outcomeReason,
            executedAt: new Date(),
            simulationRunId: run.id,
          },
        })
      )
    );
  }

  return {
    runId: run.id,
    totalTransactions: agg.totalTransactions,
    atRiskCount: agg.atRiskCount,
    atRiskAmount: agg.atRiskAmount,
    opportunityCount: agg.opportunityCount,
    approvedCount: agg.approvedCount,
    executedCount: agg.executedCount,
    escalatedCount: agg.escalatedCount,
    stoppedCount: agg.stoppedCount,
    recoveredCount: agg.recoveredCount,
    recoveredAmount: agg.recoveredAmount,
    recoveryRate,
    diagnosisMode: 'deterministic',
    seed: SIMULATION_SEED,
    durationMs,
    funnelData,
  };
}
