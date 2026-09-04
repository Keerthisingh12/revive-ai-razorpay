/**
 * Guardrail Engine — deterministic, LLM-free enforcement layer.
 *
 * Takes the recovery strategy recommendation and decides what is
 * ACTUALLY allowed to execute. The LLM only recommends; this decides.
 *
 * Rules evaluated in order, all checks recorded for transparency:
 *   1. OPT_OUT_CHECK         — customer opted out → STOP, never override
 *   2. DUPLICATE_ACTION      — action already executed for this txn → NO_ACTION
 *   3. ALREADY_RESOLVED      — txn is CAPTURED/REFUNDED → NO_ACTION
 *   4. UNRECOVERABLE_FAILURE — failure type not actionable → STOP
 *   5. HARD_CEILING          — amount > humanApprovalLimit → ESCALATE always
 *   6. AMOUNT_LIMIT          — amount > autoActionLimit → ESCALATE
 *   7. RETRY_COUNT           — retryCount >= maxRetries → STOP
 *   8. CONFIDENCE            — confidence < threshold → ESCALATE
 *
 * Output shape matches the frontend contract exactly.
 */

import type { Transaction, RecoveryActionRecord } from '@prisma/client';
import type { RiskAssessmentResult } from './riskEngine';
import type { DiagnosisResult } from './diagnosisAgent';
import type { StrategyResult } from './strategyRecommender';
import { DEFAULT_POLICY, type GuardrailPolicy } from '../config/guardrailPolicy';

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardrailDecisionType = 'APPROVED' | 'ESCALATED' | 'BLOCKED' | 'NO_ACTION';

export interface GuardrailCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface GuardrailResult {
  decision: GuardrailDecisionType;
  allowed: boolean;          // true only for APPROVED
  checks: GuardrailCheck[];
  reason: string;
  policy: {
    autoActionLimit: number;
    humanApprovalLimit: number;
    maxRetries: number;
    confidenceThreshold: number;
  };
}

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Primary guardrail check.
 * @param txn            The transaction being processed
 * @param risk           Risk engine output
 * @param diagnosis      AI/fallback diagnosis
 * @param strategy       Recovery strategy recommendation
 * @param existingAction Existing RecoveryActionRecord if any (dedup check)
 * @param policy         Policy to apply (defaults to DEFAULT_POLICY)
 */
export function checkGuardrails(
  txn: Transaction,
  risk: RiskAssessmentResult,
  diagnosis: DiagnosisResult,
  strategy: StrategyResult,
  existingAction: RecoveryActionRecord | null,
  policy: GuardrailPolicy = DEFAULT_POLICY
): GuardrailResult {
  const checks: GuardrailCheck[] = [];

  // ── Rule 1: OPT_OUT ───────────────────────────────────────────────────────
  const optedOut = txn.optedOutOfContact;
  checks.push({
    rule: 'OPT_OUT_CHECK',
    passed: !optedOut,
    detail: optedOut
      ? 'Customer opted out of contact — all recovery actions blocked'
      : 'Customer has not opted out',
  });
  if (optedOut) {
    return result('BLOCKED', false, checks, 'Customer opted out of contact — no action permitted', policy);
  }

  // ── Rule 2: DUPLICATE_ACTION ──────────────────────────────────────────────
  const alreadyActioned =
    existingAction !== null &&
    existingAction.outcome !== 'PENDING' &&
    existingAction.outcome !== 'FAILED';
  checks.push({
    rule: 'DUPLICATE_ACTION',
    passed: !alreadyActioned,
    detail: alreadyActioned
      ? `Action already executed with outcome: ${existingAction!.outcome}`
      : 'No prior completed action for this transaction',
  });
  if (alreadyActioned) {
    return result('NO_ACTION', false, checks, 'Recovery action already completed for this transaction', policy);
  }

  // ── Rule 3: ALREADY_RESOLVED ─────────────────────────────────────────────
  const resolved = txn.status === 'CAPTURED' || txn.status === 'REFUNDED';
  checks.push({
    rule: 'ALREADY_RESOLVED',
    passed: !resolved,
    detail: resolved
      ? `Transaction status is ${txn.status} — already resolved`
      : `Transaction status is ${txn.status} — recovery needed`,
  });
  if (resolved) {
    return result('NO_ACTION', false, checks, `Transaction is already ${txn.status}`, policy);
  }

  // ── Rule 4: UNRECOVERABLE_FAILURE ────────────────────────────────────────
  const unrecoverable = diagnosis.recoverability === 'NONE' || !risk.isActionable;
  checks.push({
    rule: 'UNRECOVERABLE_FAILURE',
    passed: !unrecoverable,
    detail: unrecoverable
      ? `Failure type not recoverable: ${txn.failureCode ?? 'unknown'} (recoverability=${diagnosis.recoverability})`
      : `Failure type is recoverable (recoverability=${diagnosis.recoverability})`,
  });
  if (unrecoverable) {
    return result('BLOCKED', false, checks, 'Failure type is not recoverable — no action permitted', policy);
  }

  // ── Rule 5: HARD_CEILING (humanApprovalLimit) ─────────────────────────────
  const exceedsCeiling = txn.amount > policy.humanApprovalLimit;
  checks.push({
    rule: 'HARD_CEILING',
    passed: !exceedsCeiling,
    detail: exceedsCeiling
      ? `₹${txn.amount.toLocaleString('en-IN')} exceeds hard ceiling ₹${policy.humanApprovalLimit.toLocaleString('en-IN')} — human approval mandatory`
      : `₹${txn.amount.toLocaleString('en-IN')} ≤ hard ceiling ₹${policy.humanApprovalLimit.toLocaleString('en-IN')}`,
  });
  if (exceedsCeiling) {
    return result('ESCALATED', false, checks, `Amount ₹${txn.amount.toLocaleString('en-IN')} exceeds hard ceiling ₹${policy.humanApprovalLimit.toLocaleString('en-IN')} — mandatory human approval`, policy);
  }

  // ── Rule 6: AMOUNT_LIMIT (autoActionLimit) ────────────────────────────────
  const exceedsAutoLimit = txn.amount > policy.autoActionLimit;
  checks.push({
    rule: 'AMOUNT_LIMIT',
    passed: !exceedsAutoLimit,
    detail: exceedsAutoLimit
      ? `₹${txn.amount.toLocaleString('en-IN')} exceeds auto-action limit ₹${policy.autoActionLimit.toLocaleString('en-IN')}`
      : `₹${txn.amount.toLocaleString('en-IN')} ≤ auto-action limit ₹${policy.autoActionLimit.toLocaleString('en-IN')}`,
  });
  if (exceedsAutoLimit) {
    return result('ESCALATED', false, checks, `Amount ₹${txn.amount.toLocaleString('en-IN')} exceeds automatic action limit ₹${policy.autoActionLimit.toLocaleString('en-IN')}`, policy);
  }

  // ── Rule 7: RETRY_COUNT ───────────────────────────────────────────────────
  const tooManyRetries = txn.retryCount >= policy.maxRetries;
  checks.push({
    rule: 'RETRY_COUNT',
    passed: !tooManyRetries,
    detail: tooManyRetries
      ? `${txn.retryCount} retries ≥ max ${policy.maxRetries} — retry limit reached`
      : `${txn.retryCount} of ${policy.maxRetries} max retries used`,
  });
  if (tooManyRetries) {
    return result('BLOCKED', false, checks, `Maximum retry attempts (${policy.maxRetries}) reached`, policy);
  }

  // ── Rule 8: CONFIDENCE ────────────────────────────────────────────────────
  const lowConfidence = diagnosis.confidence < policy.confidenceThreshold;
  checks.push({
    rule: 'CONFIDENCE',
    passed: !lowConfidence,
    detail: lowConfidence
      ? `Confidence ${(diagnosis.confidence * 100).toFixed(0)}% < required ${(policy.confidenceThreshold * 100).toFixed(0)}%`
      : `Confidence ${(diagnosis.confidence * 100).toFixed(0)}% ≥ required ${(policy.confidenceThreshold * 100).toFixed(0)}%`,
  });
  if (lowConfidence) {
    return result('ESCALATED', false, checks, `Diagnosis confidence ${(diagnosis.confidence * 100).toFixed(0)}% is below threshold ${(policy.confidenceThreshold * 100).toFixed(0)}%`, policy);
  }

  // ── All checks passed → APPROVED ─────────────────────────────────────────
  return result('APPROVED', true, checks, 'All guardrail checks passed — action approved for execution', policy);
}

function result(
  decision: GuardrailDecisionType,
  allowed: boolean,
  checks: GuardrailCheck[],
  reason: string,
  policy: GuardrailPolicy
): GuardrailResult {
  return {
    decision,
    allowed,
    checks,
    reason,
    policy: {
      autoActionLimit: policy.autoActionLimit,
      humanApprovalLimit: policy.humanApprovalLimit,
      maxRetries: policy.maxRetries,
      confidenceThreshold: policy.confidenceThreshold,
    },
  };
}
