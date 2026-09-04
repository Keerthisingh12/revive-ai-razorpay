/**
 * Guardrail Policy Configuration
 *
 * All thresholds live here. In a future sprint these will be per-merchant
 * from the MerchantPolicy table. For now they read from env with safe defaults.
 *
 * Policy thresholds are displayed read-only on the Dashboard.
 * Dynamic threshold configuration is supported via environment variables.
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
