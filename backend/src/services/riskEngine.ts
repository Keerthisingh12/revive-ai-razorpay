/**
 * Revenue Risk Engine — deterministic, explainable scoring.
 *
 * Takes a transaction and returns a risk classification with explicit signals.
 * Every scoring decision is visible — no black-box heuristics.
 *
 * Score bands:
 *   0–24  → LOW
 *   25–49 → MEDIUM
 *   50–74 → HIGH
 *   75–100 → CRITICAL
 */

import type { Transaction } from '@prisma/client';

// ─── Types ────────────────────────────────────────────────────────────────────

export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SignalSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Recoverability = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface RiskSignal {
  type: string;
  severity: SignalSeverity;
  description: string;
  points: number; // how many score points this signal contributes
}

export interface RiskAssessmentResult {
  riskLevel: RiskLevel;
  riskScore: number;         // 0–100
  amountAtRisk: number;      // INR
  recoverability: Recoverability;
  signals: RiskSignal[];
  isActionable: boolean;     // false if opted-out, already captured, etc.
  blockerReason?: string;    // why it's not actionable
}

// ─── Failure code metadata ────────────────────────────────────────────────────

// Maps failure codes (from synthetic dataset) to recoverability + base points
const FAILURE_CODE_META: Record<string, { recoverability: Recoverability; basePoints: number }> = {
  BANK_TIMEOUT:           { recoverability: 'HIGH',   basePoints: 55 },
  NETWORK_ERROR:          { recoverability: 'HIGH',   basePoints: 50 },
  GATEWAY_TIMEOUT:        { recoverability: 'HIGH',   basePoints: 50 },
  INSUFFICIENT_FUNDS:     { recoverability: 'MEDIUM', basePoints: 40 },
  CARD_EXPIRED:           { recoverability: 'MEDIUM', basePoints: 35 },
  AUTHENTICATION_FAILED:  { recoverability: 'MEDIUM', basePoints: 35 },
  FRAUD_HOLD:             { recoverability: 'LOW',    basePoints: 20 },
  DUPLICATE_DECLINED:     { recoverability: 'NONE',   basePoints: 5  },
};

const DEFAULT_FAILURE_META = { recoverability: 'MEDIUM' as Recoverability, basePoints: 30 };

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreToLevel(score: number): RiskLevel {
  if (score >= 75) return 'CRITICAL';
  if (score >= 50) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

/**
 * Main scoring function.
 * Returns a fully-explained risk assessment for any transaction.
 */
export function assessRisk(txn: Transaction): RiskAssessmentResult {
  // Non-failed transactions don't need recovery
  if (txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
    return {
      riskLevel: 'LOW',
      riskScore: 0,
      amountAtRisk: 0,
      recoverability: 'NONE',
      signals: [],
      isActionable: false,
      blockerReason: `Transaction status is ${txn.status} — no recovery needed`,
    };
  }

  // Opted-out customers must not be contacted
  if (txn.optedOutOfContact) {
    return {
      riskLevel: 'LOW',
      riskScore: 5,
      amountAtRisk: txn.amount,
      recoverability: 'NONE',
      signals: [
        {
          type: 'OPT_OUT',
          severity: 'CRITICAL',
          description: 'Customer has opted out of contact — no recovery action permitted',
          points: 0,
        },
      ],
      isActionable: false,
      blockerReason: 'Customer opted out of contact',
    };
  }

  const signals: RiskSignal[] = [];
  let score = 0;

  // ── Signal 1: Base score from failure code ────────────────────────────────
  const failureMeta = txn.failureCode
    ? (FAILURE_CODE_META[txn.failureCode] ?? DEFAULT_FAILURE_META)
    : DEFAULT_FAILURE_META;

  const recoverability = failureMeta.recoverability;
  score += failureMeta.basePoints;

  if (txn.failureCode) {
    const sev: SignalSeverity =
      failureMeta.basePoints >= 50 ? 'HIGH'
      : failureMeta.basePoints >= 35 ? 'MEDIUM'
      : 'LOW';
    signals.push({
      type: 'FAILURE_CODE',
      severity: sev,
      description: `Failure code ${txn.failureCode} (${txn.failureReason ?? 'unknown reason'})`,
      points: failureMeta.basePoints,
    });
  }

  // ── Signal 2: Amount — higher amount = higher urgency ────────────────────
  let amountPoints = 0;
  let amountSev: SignalSeverity = 'LOW';
  if (txn.amount >= 25000) {
    amountPoints = 20; amountSev = 'CRITICAL';
  } else if (txn.amount >= 5000) {
    amountPoints = 15; amountSev = 'HIGH';
  } else if (txn.amount >= 1000) {
    amountPoints = 8; amountSev = 'MEDIUM';
  } else {
    amountPoints = 3; amountSev = 'LOW';
  }
  score += amountPoints;
  signals.push({
    type: 'TRANSACTION_AMOUNT',
    severity: amountSev,
    description: `Amount ₹${txn.amount.toLocaleString('en-IN')} — ${amountSev.toLowerCase()} revenue impact`,
    points: amountPoints,
  });

  // ── Signal 3: Prior failure history ──────────────────────────────────────
  if (txn.priorFailureCount > 0) {
    const failPoints = Math.min(txn.priorFailureCount * 5, 15);
    const failSev: SignalSeverity =
      txn.priorFailureCount >= 3 ? 'HIGH'
      : txn.priorFailureCount >= 2 ? 'MEDIUM'
      : 'LOW';
    score += failPoints;
    signals.push({
      type: 'PRIOR_FAILURE_HISTORY',
      severity: failSev,
      description: `${txn.priorFailureCount} prior payment failure(s) on record`,
      points: failPoints,
    });
  }

  // ── Signal 4: Prior success history (positive signal — reduces urgency) ──
  if (txn.priorSuccessCount > 0 && txn.isReturningCustomer) {
    // Returning customers with success history are more likely to retry willingly
    const successPoints = Math.min(txn.priorSuccessCount, 5) * -1; // reduce score
    score += successPoints; // negative
    signals.push({
      type: 'RETURNING_CUSTOMER',
      severity: 'LOW',
      description: `Returning customer with ${txn.priorSuccessCount} prior successful payment(s) — higher recovery likelihood`,
      points: successPoints,
    });
  }

  // ── Signal 5: Current retry count ────────────────────────────────────────
  if (txn.retryCount > 0) {
    const retryPoints = txn.retryCount >= 2 ? 12 : 6;
    const retrySev: SignalSeverity = txn.retryCount >= 2 ? 'HIGH' : 'MEDIUM';
    score += retryPoints;
    signals.push({
      type: 'RETRY_COUNT',
      severity: retrySev,
      description: `Payment has been retried ${txn.retryCount} time(s) without success`,
      points: retryPoints,
    });
  }

  // ── Signal 6: Staleness — older failures lose urgency ────────────────────
  const ageHours = (Date.now() - txn.createdAt.getTime()) / (1000 * 60 * 60);
  if (ageHours > 48) {
    const stalePoints = -5;
    score += stalePoints;
    signals.push({
      type: 'STALENESS',
      severity: 'LOW',
      description: `Failure is ${Math.round(ageHours)}h old — recovery window narrowing`,
      points: stalePoints,
    });
  } else if (ageHours < 1) {
    // Very fresh failure — high urgency
    const freshPoints = 5;
    score += freshPoints;
    signals.push({
      type: 'FRESH_FAILURE',
      severity: 'MEDIUM',
      description: 'Failure occurred within the last hour — immediate recovery opportunity',
      points: freshPoints,
    });
  }

  // Clamp to 0–100
  score = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = scoreToLevel(score);

  // Determine recoverability — override to NONE for duplicate/opted-out
  const finalRecoverability: Recoverability =
    txn.failureCode === 'DUPLICATE_DECLINED' ? 'NONE' : recoverability;

  return {
    riskLevel,
    riskScore: score,
    amountAtRisk: txn.amount,
    recoverability: finalRecoverability,
    signals,
    isActionable: true,
  };
}

/**
 * Lightweight aggregation over all transactions.
 * Used by GET /api/v1/risk/summary.
 */
export function computeRiskSummary(transactions: Transaction[]): {
  total: number;
  failed: number;
  captured: number;
  totalAtRiskAmount: number;
  recoverableCount: number;
  recoverableAmount: number;
  byRiskLevel: Record<RiskLevel, { count: number; amount: number }>;
  byFailureCode: Record<string, number>;
} {
  const byRiskLevel: Record<RiskLevel, { count: number; amount: number }> = {
    LOW: { count: 0, amount: 0 },
    MEDIUM: { count: 0, amount: 0 },
    HIGH: { count: 0, amount: 0 },
    CRITICAL: { count: 0, amount: 0 },
  };
  const byFailureCode: Record<string, number> = {};

  let failed = 0;
  let captured = 0;
  let totalAtRiskAmount = 0;
  let recoverableCount = 0;
  let recoverableAmount = 0;

  for (const txn of transactions) {
    if (txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
      captured++;
      continue;
    }
    failed++;

    const result = assessRisk(txn);
    totalAtRiskAmount += result.amountAtRisk;
    byRiskLevel[result.riskLevel].count++;
    byRiskLevel[result.riskLevel].amount += result.amountAtRisk;

    if (result.recoverability !== 'NONE' && result.isActionable) {
      recoverableCount++;
      recoverableAmount += result.amountAtRisk;
    }

    if (txn.failureCode) {
      byFailureCode[txn.failureCode] = (byFailureCode[txn.failureCode] ?? 0) + 1;
    }
  }

  return {
    total: transactions.length,
    failed,
    captured,
    totalAtRiskAmount: Math.round(totalAtRiskAmount),
    recoverableCount,
    recoverableAmount: Math.round(recoverableAmount),
    byRiskLevel,
    byFailureCode,
  };
}
