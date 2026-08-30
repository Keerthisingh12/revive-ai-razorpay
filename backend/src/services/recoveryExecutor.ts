/**
 * Recovery Executor
 *
 * Given an APPROVED guardrail decision, executes (simulates) the recovery action
 * and records an outcome. No real payment gateway calls in this sprint — execution
 * is simulated using the ground-truth recoverability baked into the synthetic dataset.
 *
 * Ground truth for simulation:
 *   BANK_TIMEOUT / NETWORK_ERROR / GATEWAY_TIMEOUT → recoverable=true (high chance)
 *   INSUFFICIENT_FUNDS / CARD_EXPIRED / AUTH_FAILED → medium chance
 *   FRAUD_HOLD                                       → low chance
 *   DUPLICATE_DECLINED                               → 0% (never gets here — blocked at guardrail)
 *
 * For escalated/blocked cases, we create a pending RecoveryActionRecord for human review.
 */

import type { Transaction } from '@prisma/client';
import type { GuardrailResult } from './guardrailEngine';
import type { StrategyResult } from './strategyRecommender';
import type { DiagnosisResult } from './diagnosisAgent';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExecutionStatus = 'SUCCEEDED' | 'FAILED' | 'ESCALATED' | 'STOPPED' | 'NO_ACTION';

export interface ExecutionResult {
  action: string;                // what was attempted
  status: ExecutionStatus;
  amountRecovered: number;
  outcomeReason: string;
  simulatedAt: string;
  isSimulated: true;             // always honest — this is demo mode
}

// ─── Ground-truth recovery success rates per failure code ─────────────────────
// These match the `recoverable` + `typicalConfidence` fields from generateDataset.ts

const RECOVERY_RATES: Record<string, number> = {
  BANK_TIMEOUT:         0.82,
  NETWORK_ERROR:        0.79,
  GATEWAY_TIMEOUT:      0.76,
  INSUFFICIENT_FUNDS:   0.52,
  CARD_EXPIRED:         0.61,
  AUTHENTICATION_FAILED:0.58,
  FRAUD_HOLD:           0.18,
  DUPLICATE_DECLINED:   0.00,
};

const DEFAULT_RECOVERY_RATE = 0.50;

/**
 * Use the transaction's own data + a deterministic seed to simulate outcome.
 * We don't use Math.random() — outcome is derived from the transaction ID
 * so the same transaction always produces the same outcome (repeatable demo).
 */
function simulateSuccess(txn: Transaction, failureCode: string | null): boolean {
  const rate = failureCode
    ? (RECOVERY_RATES[failureCode] ?? DEFAULT_RECOVERY_RATE)
    : DEFAULT_RECOVERY_RATE;

  // Deterministic: hash last 4 chars of txn ID to a 0–1 float
  const tail = txn.id.slice(-4);
  const num = parseInt(tail.replace(/[^0-9]/g, '0'), 10) / 9999;
  const normalized = isNaN(num) ? 0.5 : Math.min(1, Math.max(0, num));

  // Boost for returning customers with prior successes
  const boost = txn.isReturningCustomer && txn.priorSuccessCount >= 2 ? 0.10 : 0;

  return normalized < (rate + boost);
}

// ─── Executor ─────────────────────────────────────────────────────────────────

export function executeRecovery(
  txn: Transaction,
  strategy: StrategyResult,
  guardrail: GuardrailResult,
  diagnosis: DiagnosisResult
): ExecutionResult {
  const now = new Date().toISOString();
  const action = strategy.strategy;

  // Guardrail blocked — nothing to execute
  if (!guardrail.allowed) {
    if (guardrail.decision === 'ESCALATED') {
      return {
        action,
        status: 'ESCALATED',
        amountRecovered: 0,
        outcomeReason: `Escalated to human review: ${guardrail.reason}`,
        simulatedAt: now,
        isSimulated: true,
      };
    }
    if (guardrail.decision === 'NO_ACTION') {
      return {
        action,
        status: 'NO_ACTION',
        amountRecovered: 0,
        outcomeReason: `No action taken: ${guardrail.reason}`,
        simulatedAt: now,
        isSimulated: true,
      };
    }
    // BLOCKED
    return {
      action,
      status: 'STOPPED',
      amountRecovered: 0,
      outcomeReason: `Stopped by guardrail: ${guardrail.reason}`,
      simulatedAt: now,
      isSimulated: true,
    };
  }

  // ── APPROVED — simulate the specific action ───────────────────────────────

  switch (action) {
    case 'RETRY_PAYMENT': {
      const succeeded = simulateSuccess(txn, txn.failureCode);
      return {
        action,
        status: succeeded ? 'SUCCEEDED' : 'FAILED',
        amountRecovered: succeeded ? txn.amount : 0,
        outcomeReason: succeeded
          ? `Simulated retry succeeded — payment of ₹${txn.amount.toLocaleString('en-IN')} recovered`
          : `Simulated retry failed — failure code ${txn.failureCode ?? 'unknown'} persists`,
        simulatedAt: now,
        isSimulated: true,
      };
    }

    case 'SEND_PAYMENT_LINK': {
      // Sending a link always "succeeds" as a notification event;
      // actual payment collection probability drives a lower recovery rate
      const willPay = simulateSuccess(txn, txn.failureCode);
      return {
        action,
        status: 'SUCCEEDED',  // link was sent; customer may or may not pay
        amountRecovered: willPay ? Math.round(txn.amount * 0.65) : 0,
        outcomeReason: willPay
          ? `Payment link sent and simulated customer payment of ₹${Math.round(txn.amount * 0.65).toLocaleString('en-IN')} received`
          : `Payment link sent — simulated customer did not complete payment`,
        simulatedAt: now,
        isSimulated: true,
      };
    }

    case 'SEND_REMINDER': {
      return {
        action,
        status: 'SUCCEEDED',
        amountRecovered: 0,   // reminder outcome tracked separately when customer pays
        outcomeReason: `Reminder sent to ${txn.customerEmail} — follow-up payment pending`,
        simulatedAt: now,
        isSimulated: true,
      };
    }

    case 'OFFER_ALTERNATIVE_METHOD': {
      const willUseAlt = simulateSuccess(txn, txn.failureCode);
      return {
        action,
        status: 'SUCCEEDED',
        amountRecovered: willUseAlt ? Math.round(txn.amount * 0.55) : 0,
        outcomeReason: willUseAlt
          ? `Alternative payment method offer accepted — ₹${Math.round(txn.amount * 0.55).toLocaleString('en-IN')} recovered`
          : `Alternative payment method offered — customer did not respond`,
        simulatedAt: now,
        isSimulated: true,
      };
    }

    case 'ESCALATE_TO_HUMAN': {
      return {
        action,
        status: 'ESCALATED',
        amountRecovered: 0,
        outcomeReason: `Escalated for human review — ${diagnosis.reasoning}`,
        simulatedAt: now,
        isSimulated: true,
      };
    }

    case 'DO_NOT_CONTACT':
    default: {
      return {
        action,
        status: 'STOPPED',
        amountRecovered: 0,
        outcomeReason: `No contact — ${strategy.reason}`,
        simulatedAt: now,
        isSimulated: true,
      };
    }
  }
}
