/**
 * Baseline Comparison
 *
 * Read-only. Zero Prisma writes (no create/update/upsert/delete).
 *
 * Compares:
 *   1. Naive "retry everything once" baseline (no diagnosis, no guardrails)
 *   2. ReviveAI's existing guardrailed pipeline (read from latest SimulationRun)
 *
 * Uses the exact same at-risk population logic as simulationEngine.ts.
 */

import { prisma } from '../lib/prisma';
import { assessRisk } from './riskEngine';
import { deterministic_diagnose } from './diagnosisAgent';
import { recommendStrategy } from './strategyRecommender';
import { checkGuardrails } from './guardrailEngine';
import type { Transaction } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BaselineComparisonResult {
  population: {
    totalTransactions: number;
    atRiskCount: number;
    atRiskAmount: number;
  };
  baseline: {
    actionsCount: number;
    recoveredCount: number;
    recoveredAmount: number;
    recoveryRate: number;
  };
  reviveai: {
    actionsCount: number;
    recoveredCount: number;
    recoveredAmount: number;
    recoveryRate: number;
  } | null;
  safety: {
    baselineRiskyActions: number;
    preventedTransactionCount: number;
    byRule: Record<string, number>;
    note: string;
  };
  strategyEffectiveness: {
    data: Array<{
      failureCode: string | null;
      action: string;
      outcome: string;
      count: number;
      totalRecovered: number;
    }>;
    caveat: string;
  } | null;
  additionalRevenueRecovered: number | null;
}

// ─── Deterministic outcome mirror ─────────────────────────────────────────────
//
// Mirrors recoveryExecutor.ts's simulateSuccess exactly.
// Do not let this drift — recoveryExecutor.ts is the source of truth
// and is NOT to be modified or imported from for this feature.

const RECOVERY_RATES: Record<string, number> = {
  BANK_TIMEOUT:          0.82,
  NETWORK_ERROR:         0.79,
  GATEWAY_TIMEOUT:       0.76,
  INSUFFICIENT_FUNDS:    0.52,
  CARD_EXPIRED:          0.61,
  AUTHENTICATION_FAILED: 0.58,
  FRAUD_HOLD:            0.18,
  DUPLICATE_DECLINED:    0.00,
};

const DEFAULT_RECOVERY_RATE = 0.50;

function mirrorSimulateSuccess(txn: Transaction, failureCode: string | null): boolean {
  const rate = failureCode
    ? (RECOVERY_RATES[failureCode] ?? DEFAULT_RECOVERY_RATE)
    : DEFAULT_RECOVERY_RATE;

  const tail = txn.id.slice(-4);
  const num = parseInt(tail.replace(/[^0-9]/g, '0'), 10) / 9999;
  const normalized = isNaN(num) ? 0.5 : Math.min(1, Math.max(0, num));

  const boost = txn.isReturningCustomer && txn.priorSuccessCount >= 2 ? 0.10 : 0;

  return normalized < (rate + boost);
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function runBaselineComparison(): Promise<BaselineComparisonResult> {
  // ── Fetch all transactions (same ordering as simulationEngine.ts) ───────────
  const allTxns = await prisma.transaction.findMany({
    orderBy: { id: 'asc' },
  });

  const totalTransactions = allTxns.length;

  // ── Identify at-risk population (same logic as simulationEngine.ts) ──────────
  // Skip if !risk.isActionable || status is CAPTURED/REFUNDED
  const atRiskTxns: Transaction[] = [];
  let atRiskAmount = 0;

  for (const txn of allTxns) {
    const risk = assessRisk(txn);
    if (!risk.isActionable || txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
      continue;
    }
    atRiskTxns.push(txn);
    atRiskAmount += risk.amountAtRisk;
  }

  const atRiskCount = atRiskTxns.length;

  // ── Baseline arm ───────────────────────────────────────────────────────────
  // For each at-risk transaction:
  //   - If retryCount >= 1, baseline does NOT act.
  //   - Otherwise attempts exactly one RETRY_PAYMENT.
  //   - No diagnosis, no strategy, no guardrail checks.

  let baselineActionsCount = 0;
  let baselineRecoveredCount = 0;
  let baselineRecoveredAmount = 0;

  // Track which txn IDs the baseline would act on (used for safety arm below)
  const baselineActedIds = new Set<string>();

  for (const txn of atRiskTxns) {
    if (txn.retryCount >= 1) {
      // Baseline does not act
      continue;
    }
    // Baseline acts: one RETRY_PAYMENT
    baselineActionsCount++;
    baselineActedIds.add(txn.id);

    const succeeded = mirrorSimulateSuccess(txn, txn.failureCode);
    if (succeeded) {
      baselineRecoveredCount++;
      baselineRecoveredAmount += txn.amount;
    }
  }

  const baselineRecoveryRate =
    atRiskCount > 0
      ? parseFloat(((baselineRecoveredCount / atRiskCount) * 100).toFixed(1))
      : 0;

  // ── Safety arm ─────────────────────────────────────────────────────────────
  // For every transaction where baseline WOULD act:
  //   - run deterministic_diagnose, recommendStrategy, checkGuardrails
  //   - if guardrail.allowed === false, it's a prevented transaction

  // preventedTransactionCount: unique txn IDs where baseline would act AND guardrail blocks
  const preventedIds = new Set<string>();
  const byRule: Record<string, number> = {};

  for (const txn of atRiskTxns) {
    if (!baselineActedIds.has(txn.id)) continue;

    const risk = assessRisk(txn);
    const diagnosis = deterministic_diagnose(txn, risk);
    const strategy = recommendStrategy(txn, risk, diagnosis);
    const guardrail = checkGuardrails(txn, risk, diagnosis, strategy, null);

    if (!guardrail.allowed) {
      preventedIds.add(txn.id);

      // The engine short-circuits on the first failed rule.
      // Find the first failed check — that is the rule that blocked this txn.
      const firstFailed = guardrail.checks.find(c => !c.passed);
      const ruleName = firstFailed ? firstFailed.rule : 'UNKNOWN';
      byRule[ruleName] = (byRule[ruleName] ?? 0) + 1;
    }
  }

  const preventedTransactionCount = preventedIds.size;

  // ASSERT: sum(byRule values) === preventedTransactionCount
  const byRuleSum = Object.values(byRule).reduce((s, v) => s + v, 0);
  if (byRuleSum !== preventedTransactionCount) {
    // This is a bug in the comparison code — surface it clearly
    throw new Error(
      `Invariant violation: sum(byRule) = ${byRuleSum} !== preventedTransactionCount = ${preventedTransactionCount}. ` +
      'This is a bug in baselineComparison.ts, not in guardrailEngine.ts.'
    );
  }

  // ── Read latest ReviveAI SimulationRun (no write) ───────────────────────────
  const latestRun = await prisma.simulationRun.findFirst({
    orderBy: { completedAt: 'desc' },
  });

  let reviveai: BaselineComparisonResult['reviveai'] = null;

  if (latestRun) {
    const reviveaiRecoveryRate =
      latestRun.atRiskCount > 0
        ? parseFloat(((latestRun.recoveredCount / latestRun.atRiskCount) * 100).toFixed(1))
        : 0;

    reviveai = {
      actionsCount:    latestRun.executedCount,
      recoveredCount:  latestRun.recoveredCount,
      recoveredAmount: latestRun.recoveredAmount,
      recoveryRate:    reviveaiRecoveryRate,
    };
  }

  // ── Strategy effectiveness (optional, read-only) ────────────────────────────
  // Only included if it can be safely derived using simulationRunId as provenance.
  // If no latestRun exists, skip entirely.

  let strategyEffectiveness: BaselineComparisonResult['strategyEffectiveness'] = null;

  if (latestRun) {
    const records = await prisma.recoveryActionRecord.findMany({
      where: { simulationRunId: latestRun.id },
      include: { transaction: { select: { failureCode: true } } },
    });

    // Group by failureCode × action × outcome
    const grouped = new Map<string, { count: number; totalRecovered: number }>();

    for (const rec of records) {
      const key = `${rec.transaction?.failureCode ?? 'UNKNOWN'}|${rec.action}|${rec.outcome}`;
      const existing = grouped.get(key) ?? { count: 0, totalRecovered: 0 };
      existing.count += 1;
      existing.totalRecovered += rec.amountRecovered;
      grouped.set(key, existing);
    }

    const data = Array.from(grouped.entries())
      .map(([key, stats]) => {
        const [failureCode, action, outcome] = key.split('|');
        return {
          failureCode: failureCode === 'UNKNOWN' ? null : failureCode,
          action,
          outcome,
          count: stats.count,
          totalRecovered: stats.totalRecovered,
        };
      })
      .sort((a, b) => b.count - a.count);

    strategyEffectiveness = {
      data,
      caveat:
        'Rows are filtered by simulationRunId, but a human review action (approve/reject/stop) taken after this batch run could have modified a row\'s outcome without clearing simulationRunId. This table reflects the batch run\'s records as they currently stand in the database, which may include later manual overrides.',
    };
  }

  // ── additionalRevenueRecovered ───────────────────────────────────────────────
  const additionalRevenueRecovered =
    reviveai !== null
      ? reviveai.recoveredAmount - baselineRecoveredAmount
      : null;

  return {
    population: {
      totalTransactions,
      atRiskCount,
      atRiskAmount,
    },
    baseline: {
      actionsCount:    baselineActionsCount,
      recoveredCount:  baselineRecoveredCount,
      recoveredAmount: baselineRecoveredAmount,
      recoveryRate:    baselineRecoveryRate,
    },
    reviveai,
    safety: {
      baselineRiskyActions:    baselineActionsCount,
      preventedTransactionCount,
      byRule,
      note: 'baselineRiskyActions = number of transactions the naive baseline attempted with no safety checks. preventedTransactionCount = transactions where checkGuardrails() returned allowed=false. Each prevented transaction is counted by exactly one rule (the first failing rule the engine short-circuits on).',
    },
    strategyEffectiveness,
    additionalRevenueRecovered,
  };
}
