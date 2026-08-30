/**
 * Guardrail Policy Configuration
 *
 * All thresholds live here. In a future sprint these will be per-merchant
 * from the MerchantPolicy table. For now they read from env with safe defaults.
 *
 * A settings UI that renders these values read-only is built in Day 4.
 * An editable UI is a Day 6 stretch goal.
 */

export interface GuardrailPolicy {
  /** Auto-action limit: amounts below this can be executed automatically */
  autoActionLimit: number;
  /** Human approval limit: amounts above this ALWAYS require human sign-off */
  humanApprovalLimit: number;
  /** Maximum automatic retry attempts before STOP is enforced */
  maxRetries: number;
  /** Minimum diagnosis confidence to allow automatic execution */
  confidenceThreshold: number;
  /** Maximum contacts per customer per day */
  maxContactsPerDay: number;
}

export const DEFAULT_POLICY: GuardrailPolicy = {
  autoActionLimit:    parseFloat(process.env.DEFAULT_AUTO_ACTION_LIMIT    ?? '5000'),
  humanApprovalLimit: parseFloat(process.env.DEFAULT_HUMAN_APPROVAL_LIMIT ?? '25000'),
  maxRetries:         parseInt(  process.env.DEFAULT_MAX_RETRIES           ?? '2',   10),
  confidenceThreshold:parseFloat(process.env.DEFAULT_CONFIDENCE_THRESHOLD  ?? '0.70'),
  maxContactsPerDay:  2,
};
