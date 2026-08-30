/**
 * Synthetic Transaction Dataset Generator
 *
 * Produces 2,000 realistic synthetic payment transactions with:
 * - Deterministic output via fixed seed (DEMO_SEED)
 * - Known ground-truth failure reasons
 * - Realistic amount distributions, customer history, merchant mix
 * - Mix of statuses: ~30% failed/at-risk, ~70% captured (healthy baseline)
 *
 * This data drives the entire core loop in Demo Mode — no real Razorpay calls needed.
 */

import { createRng } from './rng';

// ─── Constants ───────────────────────────────────────────────────────────────

export const DEMO_SEED = 42;
export const DATASET_SIZE = 2000;

// Failure reasons with realistic probability weights and recoverability hints
export const FAILURE_REASONS = [
  {
    code: 'BANK_TIMEOUT',
    label: 'Bank gateway timeout',
    weight: 0.22,
    recoverable: true,
    suggestedAction: 'RETRY' as const,
    typicalConfidence: 0.88,
  },
  {
    code: 'NETWORK_ERROR',
    label: 'Network connectivity error',
    weight: 0.18,
    recoverable: true,
    suggestedAction: 'RETRY' as const,
    typicalConfidence: 0.85,
  },
  {
    code: 'INSUFFICIENT_FUNDS',
    label: 'Insufficient funds in account',
    weight: 0.15,
    recoverable: true,
    suggestedAction: 'PAYMENT_LINK' as const,
    typicalConfidence: 0.79,
  },
  {
    code: 'CARD_EXPIRED',
    label: 'Card expired',
    weight: 0.12,
    recoverable: true,
    suggestedAction: 'REMINDER' as const,
    typicalConfidence: 0.92,
  },
  {
    code: 'GATEWAY_TIMEOUT',
    label: 'Payment gateway timeout',
    weight: 0.10,
    recoverable: true,
    suggestedAction: 'SCHEDULE_RETRY' as const,
    typicalConfidence: 0.82,
  },
  {
    code: 'AUTHENTICATION_FAILED',
    label: '3DS authentication failed',
    weight: 0.10,
    recoverable: true,
    suggestedAction: 'REMINDER' as const,
    typicalConfidence: 0.76,
  },
  {
    code: 'FRAUD_HOLD',
    label: 'Transaction flagged for fraud review',
    weight: 0.08,
    recoverable: false,
    suggestedAction: 'ESCALATE' as const,
    typicalConfidence: 0.94,
  },
  {
    code: 'DUPLICATE_DECLINED',
    label: 'Duplicate transaction declined',
    weight: 0.05,
    recoverable: false,
    suggestedAction: 'STOP' as const,
    typicalConfidence: 0.97,
  },
] as const;

// Merchant IDs for realistic multi-merchant demo
const MERCHANTS = [
  'merchant_ecommerce_001',
  'merchant_saas_002',
  'merchant_food_003',
  'merchant_travel_004',
  'merchant_retail_005',
];

// Amount buckets — weighted toward mid-range, with some high-value outliers
// All in INR
const AMOUNT_BUCKETS = [
  { min: 199, max: 999, weight: 0.30 },    // small: subscriptions, food
  { min: 1000, max: 4999, weight: 0.35 },  // medium: retail, SaaS
  { min: 5000, max: 24999, weight: 0.25 }, // large: travel, electronics
  { min: 25000, max: 75000, weight: 0.10 }, // high-value: B2C luxury, travel
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface SyntheticTransaction {
  id: string;
  merchantId: string;
  customerId: string;
  customerEmail: string;
  customerPhone: string;
  amount: number;          // INR
  currency: string;
  status: 'FAILED' | 'CAPTURED' | 'AT_RISK';
  failureReason: string | null;
  failureCode: string | null;
  isReturningCustomer: boolean;
  priorSuccessCount: number;
  priorFailureCount: number;
  retryCount: number;
  optedOutOfContact: boolean;
  // Ground truth for simulation validation
  groundTruthRecoverable: boolean;
  groundTruthSuggestedAction: string;
  groundTruthConfidence: number;
  createdAt: Date;
}

// ─── Generator ───────────────────────────────────────────────────────────────

function weightedPick<T extends { weight: number }>(items: readonly T[], rng: ReturnType<typeof createRng>): T {
  const total = items.reduce((sum, i) => sum + i.weight, 0);
  let r = rng.next() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

function generateAmount(rng: ReturnType<typeof createRng>): number {
  const bucket = weightedPick(AMOUNT_BUCKETS, rng);
  const raw = rng.float(bucket.min, bucket.max);
  // Round to nearest ₹1 for clean display
  return Math.round(raw);
}

function generateEmail(customerId: string, merchantId: string): string {
  const domains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'rediffmail.com'];
  const merchantSlug = merchantId.split('_')[1];
  return `${customerId.split('_')[1]}@${domains[parseInt(customerId.split('_')[2] || '0') % domains.length]}`;
}

/**
 * Main generator function.
 * @param seed - Random seed (default: DEMO_SEED for reproducible demos)
 * @param count - Number of transactions to generate (default: DATASET_SIZE)
 */
export function generateSyntheticDataset(
  seed: number = DEMO_SEED,
  count: number = DATASET_SIZE
): SyntheticTransaction[] {
  const rng = createRng(seed);
  const transactions: SyntheticTransaction[] = [];

  const now = new Date();

  for (let i = 0; i < count; i++) {
    const merchantId = rng.pick(MERCHANTS);
    const customerId = `cust_${merchantId.split('_')[1]}_${String(rng.int(1000, 9999))}`;

    // ~30% of transactions are failed/at-risk, 70% healthy captures
    const isFailed = rng.bool(0.30);

    // Customer history — returning customers have more history
    const isReturningCustomer = rng.bool(0.60);
    const priorSuccessCount = isReturningCustomer ? rng.int(1, 20) : 0;
    const priorFailureCount = isReturningCustomer ? rng.int(0, 3) : rng.int(0, 1);
    const retryCount = isFailed && priorFailureCount > 0 ? rng.int(0, 2) : 0;

    // Small fraction opted out of contact
    const optedOutOfContact = rng.bool(0.04);

    const amount = generateAmount(rng);

    let status: SyntheticTransaction['status'] = 'CAPTURED';
    let failureReason: string | null = null;
    let failureCode: string | null = null;
    let groundTruthRecoverable = false;
    let groundTruthSuggestedAction = 'STOP';
    let groundTruthConfidence = 0.5;

    if (isFailed) {
      const reason = weightedPick(FAILURE_REASONS, rng);
      status = 'FAILED';
      failureReason = reason.label;
      failureCode = reason.code;
      groundTruthRecoverable = reason.recoverable;
      groundTruthSuggestedAction = reason.suggestedAction;
      // Add small noise to confidence (±0.08) so it feels realistic
      groundTruthConfidence = Math.min(
        0.99,
        Math.max(0.50, reason.typicalConfidence + rng.float(-0.08, 0.08))
      );
    }

    // Timestamp spread: past 7 days
    const ageMs = rng.float(0, 7 * 24 * 60 * 60 * 1000);
    const createdAt = new Date(now.getTime() - ageMs);

    transactions.push({
      id: `txn_${String(i + 1).padStart(6, '0')}_${seed}`,
      merchantId,
      customerId,
      customerEmail: generateEmail(customerId, merchantId),
      customerPhone: `+91${rng.int(7000000000, 9999999999)}`,
      amount,
      currency: 'INR',
      status,
      failureReason,
      failureCode,
      isReturningCustomer,
      priorSuccessCount,
      priorFailureCount,
      retryCount,
      optedOutOfContact,
      groundTruthRecoverable,
      groundTruthSuggestedAction,
      groundTruthConfidence,
      createdAt,
    });
  }

  return transactions;
}

/**
 * Quick summary stats — useful for sanity-checking the dataset.
 */
export function summarizeDataset(txns: SyntheticTransaction[]) {
  const failed = txns.filter((t) => t.status === 'FAILED');
  const totalAtRisk = failed.reduce((s, t) => s + t.amount, 0);
  const recoverable = failed.filter((t) => t.groundTruthRecoverable);

  const byReason = FAILURE_REASONS.map((r) => ({
    code: r.code,
    count: failed.filter((t) => t.failureCode === r.code).length,
  }));

  return {
    total: txns.length,
    captured: txns.filter((t) => t.status === 'CAPTURED').length,
    failed: failed.length,
    failedRate: ((failed.length / txns.length) * 100).toFixed(1) + '%',
    totalAtRiskINR: totalAtRisk,
    recoverable: recoverable.length,
    recoverableRate: ((recoverable.length / failed.length) * 100).toFixed(1) + '%',
    optedOut: txns.filter((t) => t.optedOutOfContact).length,
    byReason,
  };
}
