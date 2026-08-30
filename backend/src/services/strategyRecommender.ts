/**
 * Recovery Strategy Recommender
 *
 * Combines risk assessment + AI diagnosis into a final recovery strategy.
 * This is a RECOMMENDATION only — not execution authority.
 * The Day 3 guardrail engine sits on top of this and decides what's allowed.
 *
 * Basic sense-checks are built in (max retries, unrecoverable cases),
 * but full policy enforcement (amount thresholds, confidence gates, cooldowns)
 * is Day 3's responsibility.
 */

import type { Transaction } from '@prisma/client';
import type { RiskAssessmentResult } from './riskEngine';
import type { DiagnosisResult, RecoveryAction } from './diagnosisAgent';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StrategyResult {
  strategy: RecoveryAction;
  reason: string;
  allowed: boolean;          // first-pass sanity check (NOT the full guardrail)
  blockerReason?: string;    // only set if allowed=false
  priority: 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW';
  estimatedRecoveryAmount: number;
}

// Max retries before this recommender stops suggesting RETRY_PAYMENT
const MAX_AUTO_RETRIES = 2;

// ─── Strategy logic ───────────────────────────────────────────────────────────

export function recommendStrategy(
  txn: Transaction,
  risk: RiskAssessmentResult,
  diagnosis: DiagnosisResult
): StrategyResult {
  const est = txn.amount; // best estimate = full amount until guardrail/executor refines

  // ── Hard blocks ───────────────────────────────────────────────────────────

  if (!risk.isActionable) {
    return {
      strategy: 'DO_NOT_CONTACT',
      reason: risk.blockerReason ?? 'Transaction is not actionable',
      allowed: false,
      blockerReason: risk.blockerReason,
      priority: 'LOW',
      estimatedRecoveryAmount: 0,
    };
  }

  if (diagnosis.recoverability === 'NONE') {
    return {
      strategy: 'DO_NOT_CONTACT',
      reason: `Failure code ${txn.failureCode ?? 'unknown'} is not recoverable via automated means`,
      allowed: false,
      blockerReason: 'Unrecoverable failure type',
      priority: 'LOW',
      estimatedRecoveryAmount: 0,
    };
  }

  if (txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
    return {
      strategy: 'DO_NOT_CONTACT',
      reason: `Transaction is already ${txn.status}`,
      allowed: false,
      blockerReason: 'Already resolved',
      priority: 'LOW',
      estimatedRecoveryAmount: 0,
    };
  }

  // ── Retry cap ─────────────────────────────────────────────────────────────
  // If retryCount has already hit the ceiling, don't suggest another retry
  if (txn.retryCount >= MAX_AUTO_RETRIES && diagnosis.recommendedAction === 'RETRY_PAYMENT') {
    return {
      strategy: 'ESCALATE_TO_HUMAN',
      reason: `Auto-retry limit (${MAX_AUTO_RETRIES}) reached — escalating to human review`,
      allowed: true,
      priority: 'HIGH',
      estimatedRecoveryAmount: est,
    };
  }

  // ── High-value transactions default to human escalation ───────────────────
  // (Full threshold enforcement is Day 3; this is a first-pass recommendation)
  if (txn.amount >= 25000 && diagnosis.recommendedAction === 'RETRY_PAYMENT') {
    return {
      strategy: 'ESCALATE_TO_HUMAN',
      reason: `High-value transaction (₹${txn.amount.toLocaleString('en-IN')}) — human approval recommended before retry`,
      allowed: true,
      priority: 'URGENT',
      estimatedRecoveryAmount: est,
    };
  }

  // ── Low confidence — escalate ─────────────────────────────────────────────
  if (diagnosis.confidence < 0.65) {
    return {
      strategy: 'ESCALATE_TO_HUMAN',
      reason: `Diagnosis confidence too low (${(diagnosis.confidence * 100).toFixed(0)}%) — human review needed`,
      allowed: true,
      priority: 'MEDIUM',
      estimatedRecoveryAmount: est,
    };
  }

  // ── Use AI/fallback recommendation ────────────────────────────────────────
  const priority = computePriority(risk, diagnosis);

  return {
    strategy: diagnosis.recommendedAction,
    reason: buildStrategyReason(txn, diagnosis),
    allowed: true,
    priority,
    estimatedRecoveryAmount: diagnosis.recoverability === 'HIGH' ? est
      : diagnosis.recoverability === 'MEDIUM' ? Math.round(est * 0.65)
      : Math.round(est * 0.30),
  };
}

function computePriority(
  risk: RiskAssessmentResult,
  diagnosis: DiagnosisResult
): 'URGENT' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (risk.riskLevel === 'CRITICAL') return 'URGENT';
  if (risk.riskLevel === 'HIGH' && diagnosis.recoverability === 'HIGH') return 'HIGH';
  if (risk.riskLevel === 'HIGH') return 'HIGH';
  if (risk.riskLevel === 'MEDIUM') return 'MEDIUM';
  return 'LOW';
}

function buildStrategyReason(txn: Transaction, diagnosis: DiagnosisResult): string {
  const action = diagnosis.recommendedAction.replace(/_/g, ' ').toLowerCase();
  const conf = `${(diagnosis.confidence * 100).toFixed(0)}% confidence`;
  const rec = diagnosis.recoverability.toLowerCase() + ' recoverability';
  const history = txn.isReturningCustomer && txn.priorSuccessCount > 0
    ? `, returning customer (${txn.priorSuccessCount} prior successes)`
    : '';
  return `Recommend ${action} — ${conf}, ${rec}${history}`;
}
