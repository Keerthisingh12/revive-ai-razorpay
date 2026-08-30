/**
 * AI Diagnosis Agent
 *
 * Calls Gemini (if GEMINI_API_KEY is present and valid) to diagnose a failed
 * payment and recommend a recovery action. Returns strict validated JSON.
 *
 * If the AI is unavailable, times out, or returns invalid JSON, falls back to
 * a deterministic rule-based diagnosis. The `source` field is always honest:
 *   "AI"       — Gemini responded with valid structured output
 *   "FALLBACK" — deterministic rules were used (AI unavailable or invalid)
 *
 * The LLM is NEVER given execution authority. It only produces a recommendation.
 * The guardrail engine (Day 3) decides what's actually allowed to run.
 */

import { z } from 'zod';
import type { Transaction } from '@prisma/client';
import type { RiskAssessmentResult } from './riskEngine';

// ─── Output Schema (Zod) ──────────────────────────────────────────────────────

const RootCauseEnum = z.enum([
  'INSUFFICIENT_FUNDS',
  'CARD_EXPIRED',
  'BANK_TIMEOUT',
  'NETWORK_ERROR',
  'GATEWAY_TIMEOUT',
  'AUTHENTICATION_FAILED',
  'FRAUD_HOLD',
  'DUPLICATE_DECLINED',
  'UNKNOWN',
]);

const RecoveryActionEnum = z.enum([
  'RETRY_PAYMENT',
  'SEND_PAYMENT_LINK',
  'SEND_REMINDER',
  'OFFER_ALTERNATIVE_METHOD',
  'ESCALATE_TO_HUMAN',
  'DO_NOT_CONTACT',
]);

const RecoverabilityEnum = z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']);
const SourceEnum = z.enum(['AI', 'FALLBACK']);

export const DiagnosisSchema = z.object({
  rootCause: RootCauseEnum,
  confidence: z.number().min(0).max(1),
  recoverability: RecoverabilityEnum,
  reasoning: z.string().min(10).max(500),
  recommendedAction: RecoveryActionEnum,
  source: SourceEnum,
});

export type DiagnosisResult = z.infer<typeof DiagnosisSchema>;
export type RecoveryAction = z.infer<typeof RecoveryActionEnum>;

// ─── Fallback rule map ─────────────────────────────────────────────────────────

interface FallbackRule {
  rootCause: z.infer<typeof RootCauseEnum>;
  recoverability: z.infer<typeof RecoverabilityEnum>;
  recommendedAction: z.infer<typeof RecoveryActionEnum>;
  baseConfidence: number;
}

const FAILURE_CODE_RULES: Record<string, FallbackRule> = {
  BANK_TIMEOUT: {
    rootCause: 'BANK_TIMEOUT',
    recoverability: 'HIGH',
    recommendedAction: 'RETRY_PAYMENT',
    baseConfidence: 0.87,
  },
  NETWORK_ERROR: {
    rootCause: 'NETWORK_ERROR',
    recoverability: 'HIGH',
    recommendedAction: 'RETRY_PAYMENT',
    baseConfidence: 0.84,
  },
  GATEWAY_TIMEOUT: {
    rootCause: 'GATEWAY_TIMEOUT',
    recoverability: 'HIGH',
    recommendedAction: 'RETRY_PAYMENT',
    baseConfidence: 0.82,
  },
  INSUFFICIENT_FUNDS: {
    rootCause: 'INSUFFICIENT_FUNDS',
    recoverability: 'MEDIUM',
    recommendedAction: 'SEND_PAYMENT_LINK',
    baseConfidence: 0.78,
  },
  CARD_EXPIRED: {
    rootCause: 'CARD_EXPIRED',
    recoverability: 'MEDIUM',
    recommendedAction: 'SEND_REMINDER',
    baseConfidence: 0.91,
  },
  AUTHENTICATION_FAILED: {
    rootCause: 'AUTHENTICATION_FAILED',
    recoverability: 'MEDIUM',
    recommendedAction: 'SEND_REMINDER',
    baseConfidence: 0.75,
  },
  FRAUD_HOLD: {
    rootCause: 'FRAUD_HOLD',
    recoverability: 'LOW',
    recommendedAction: 'ESCALATE_TO_HUMAN',
    baseConfidence: 0.93,
  },
  DUPLICATE_DECLINED: {
    rootCause: 'DUPLICATE_DECLINED',
    recoverability: 'NONE',
    recommendedAction: 'DO_NOT_CONTACT',
    baseConfidence: 0.97,
  },
};

const DEFAULT_FALLBACK_RULE: FallbackRule = {
  rootCause: 'UNKNOWN',
  recoverability: 'LOW',
  recommendedAction: 'ESCALATE_TO_HUMAN',
  baseConfidence: 0.55,
};

// ─── Deterministic fallback ───────────────────────────────────────────────────

export function deterministic_diagnose(
  txn: Transaction,
  risk: RiskAssessmentResult
): DiagnosisResult {
  // Hard blocker: opted out
  if (txn.optedOutOfContact) {
    return {
      rootCause: txn.failureCode && FAILURE_CODE_RULES[txn.failureCode]
        ? FAILURE_CODE_RULES[txn.failureCode].rootCause
        : 'UNKNOWN',
      confidence: 0.99,
      recoverability: 'NONE',
      reasoning: 'Customer has opted out of contact. No recovery action is permitted.',
      recommendedAction: 'DO_NOT_CONTACT',
      source: 'FALLBACK',
    };
  }

  const rule = txn.failureCode
    ? (FAILURE_CODE_RULES[txn.failureCode] ?? DEFAULT_FALLBACK_RULE)
    : DEFAULT_FALLBACK_RULE;

  // Adjust confidence by customer history
  let confidence = rule.baseConfidence;
  if (txn.isReturningCustomer && txn.priorSuccessCount >= 3) {
    confidence = Math.min(0.99, confidence + 0.06);
  }
  if (txn.retryCount >= 2) {
    confidence = Math.max(0.50, confidence - 0.08); // repeated failures reduce certainty
  }

  // Downgrade action if too many retries
  let recommendedAction = rule.recommendedAction;
  if (txn.retryCount >= 2 && recommendedAction === 'RETRY_PAYMENT') {
    recommendedAction = 'SEND_PAYMENT_LINK';
  }

  const reasoning = buildFallbackReasoning(txn, rule, risk);

  return {
    rootCause: rule.rootCause,
    confidence: Math.round(confidence * 100) / 100,
    recoverability: rule.recoverability,
    reasoning,
    recommendedAction,
    source: 'FALLBACK',
  };
}

function buildFallbackReasoning(
  txn: Transaction,
  rule: FallbackRule,
  risk: RiskAssessmentResult
): string {
  const parts: string[] = [];
  parts.push(`Failure code: ${txn.failureCode ?? 'unknown'}.`);
  if (txn.isReturningCustomer && txn.priorSuccessCount > 0) {
    parts.push(`Returning customer with ${txn.priorSuccessCount} prior successful payment(s).`);
  }
  if (txn.retryCount > 0) {
    parts.push(`Already retried ${txn.retryCount} time(s).`);
  }
  parts.push(`Risk level: ${risk.riskLevel} (score ${risk.riskScore}/100).`);
  parts.push(`Recoverability assessed as ${rule.recoverability}.`);
  return parts.join(' ');
}

// ─── AI Gemini call ───────────────────────────────────────────────────────────

let geminiInitialized = false;
let googleAI: import('@google/generative-ai').GoogleGenerativeAI | null = null;

function getGeminiClient(): import('@google/generative-ai').GoogleGenerativeAI | null {
  if (geminiInitialized) return googleAI;
  geminiInitialized = true;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.log('[DiagnosisAgent] No GEMINI_API_KEY — will use deterministic fallback');
    return null;
  }

  try {
    // Dynamic import to avoid crashing if package not found
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    googleAI = new GoogleGenerativeAI(apiKey);
    console.log('[DiagnosisAgent] Gemini initialized');
    return googleAI;
  } catch (e) {
    console.warn('[DiagnosisAgent] Failed to initialize Gemini client:', e);
    return null;
  }
}

function buildPrompt(txn: Transaction, risk: RiskAssessmentResult): string {
  return `You are a payment recovery AI for an Indian fintech platform.

Analyze this failed payment and return ONLY a JSON object — no markdown, no explanation outside the JSON.

Transaction context:
- Amount: ₹${txn.amount}
- Failure code: ${txn.failureCode ?? 'unknown'}
- Failure reason: ${txn.failureReason ?? 'unknown'}
- Retry count: ${txn.retryCount}
- Is returning customer: ${txn.isReturningCustomer}
- Prior successes: ${txn.priorSuccessCount}
- Prior failures: ${txn.priorFailureCount}
- Risk level: ${risk.riskLevel} (score: ${risk.riskScore}/100)
- Customer opted out: ${txn.optedOutOfContact}

Return exactly this JSON structure:
{
  "rootCause": "<one of: INSUFFICIENT_FUNDS | CARD_EXPIRED | BANK_TIMEOUT | NETWORK_ERROR | GATEWAY_TIMEOUT | AUTHENTICATION_FAILED | FRAUD_HOLD | DUPLICATE_DECLINED | UNKNOWN>",
  "confidence": <0.0 to 1.0>,
  "recoverability": "<HIGH | MEDIUM | LOW | NONE>",
  "reasoning": "<1-2 sentences, plain English, no jargon>",
  "recommendedAction": "<one of: RETRY_PAYMENT | SEND_PAYMENT_LINK | SEND_REMINDER | OFFER_ALTERNATIVE_METHOD | ESCALATE_TO_HUMAN | DO_NOT_CONTACT>",
  "source": "AI"
}`;
}

async function callGemini(
  txn: Transaction,
  risk: RiskAssessmentResult
): Promise<DiagnosisResult | null> {
  const client = getGeminiClient();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        temperature: 0.1,       // low temperature for deterministic, structured output
        maxOutputTokens: 300,
      },
    });

    const prompt = buildPrompt(txn, risk);

    // 10-second timeout
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini timeout after 10s')), 10000)
      ),
    ]);

    const text = (result as Awaited<ReturnType<typeof model.generateContent>>)
      .response.text().trim();

    // Strip markdown code fences if model wraps in ```json ... ```
    const jsonText = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      console.warn('[DiagnosisAgent] Gemini returned non-JSON:', text.substring(0, 200));
      return null;
    }

    // Zod validate
    const validated = DiagnosisSchema.safeParse(parsed);
    if (!validated.success) {
      console.warn(
        '[DiagnosisAgent] Gemini response failed schema validation:',
        validated.error.flatten()
      );
      return null;
    }

    return validated.data;
  } catch (err) {
    console.warn('[DiagnosisAgent] Gemini call failed:', (err as Error).message);
    return null;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Primary entry point.
 * Tries AI first; falls back to deterministic rules if AI is unavailable.
 * `source` field in the result is always honest.
 */
export async function diagnose(
  txn: Transaction,
  risk: RiskAssessmentResult
): Promise<DiagnosisResult> {
  // Never call AI for non-failed transactions
  if (txn.status === 'CAPTURED' || txn.status === 'REFUNDED') {
    return {
      rootCause: 'UNKNOWN',
      confidence: 1.0,
      recoverability: 'NONE',
      reasoning: `Transaction is ${txn.status} — no diagnosis needed.`,
      recommendedAction: 'DO_NOT_CONTACT',
      source: 'FALLBACK',
    };
  }

  // Try AI
  const aiResult = await callGemini(txn, risk);
  if (aiResult) return aiResult;

  // Fallback
  return deterministic_diagnose(txn, risk);
}
