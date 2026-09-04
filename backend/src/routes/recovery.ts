/**
 * Recovery processing route — the complete end-to-end loop for one transaction.
 *   POST /api/v1/recovery/process/:transactionId
 *
 * Runs every stage in sequence and returns all outputs:
 *   Risk → Diagnosis → Strategy → Guardrail Decision → Execution → Outcome
 *
 * Every stage writes a real AuditLog row. Nothing is faked.
 * The AgentDecision record is updated with the real guardrail decision (replacing
 * any preliminary placeholder if one was previously created).
 *
 * Additional route:
 *   GET /api/v1/recovery/process/:transactionId — fetch the persisted result
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { assessRisk } from '../services/riskEngine';
import { diagnose } from '../services/diagnosisAgent';
import { recommendStrategy } from '../services/strategyRecommender';
import { checkGuardrails } from '../services/guardrailEngine';
import { executeRecovery } from '../services/recoveryExecutor';
import type { RiskLevel as PrismaRiskLevel, RecoveryOutcome } from '@prisma/client';

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJson = (obj: unknown): any => JSON.parse(JSON.stringify(obj));

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

// ─── POST /api/v1/recovery/process/:transactionId ─────────────────────────────

router.post('/:transactionId', async (req: Request, res: Response) => {
  const transactionId = String(req.params.transactionId);

  // ── Fetch transaction ─────────────────────────────────────────────────────
  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: { recoveryAction: true },
  });

  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  // ── Stage 1: Risk Assessment ──────────────────────────────────────────────
  const risk = assessRisk(txn);

  await prisma.riskAssessment.upsert({
    where: { transactionId },
    update: {
      riskLevel: risk.riskLevel as PrismaRiskLevel,
      riskScore: risk.riskScore / 100,
      amountAtRisk: risk.amountAtRisk,
      riskFactors: risk.signals.map((s) => s.description),
    },
    create: {
      transactionId,
      riskLevel: risk.riskLevel as PrismaRiskLevel,
      riskScore: risk.riskScore / 100,
      amountAtRisk: risk.amountAtRisk,
      riskFactors: risk.signals.map((s) => s.description),
    },
  });

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'RISK_DETECTED',
      summary: `Risk: ${risk.riskLevel} (score ${risk.riskScore}/100) | At risk: ₹${risk.amountAtRisk}`,
      detail: toJson({ riskLevel: risk.riskLevel, riskScore: risk.riskScore, signals: risk.signals }),
      actor: 'system',
    },
  });

  // ── Stage 2: AI / Fallback Diagnosis ─────────────────────────────────────
  const diagnosis = await diagnose(txn, risk);

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'AI_DIAGNOSIS',
      summary: `[${diagnosis.source}] ${diagnosis.rootCause} | conf=${(diagnosis.confidence * 100).toFixed(0)}% | recoverability=${diagnosis.recoverability}`,
      detail: toJson(diagnosis),
      actor: diagnosis.source === 'AI' ? 'ai' : 'system',
    },
  });

  // ── Stage 3: Recovery Strategy Recommendation ─────────────────────────────
  const strategy = recommendStrategy(txn, risk, diagnosis);

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'AI_RECOMMENDATION',
      summary: `Recommended: ${strategy.strategy} | priority=${strategy.priority}`,
      detail: toJson(strategy),
      actor: 'system',
    },
  });

  // ── Stage 4: Guardrail Decision ───────────────────────────────────────────
  const guardrail = checkGuardrails(
    txn,
    risk,
    diagnosis,
    strategy,
    txn.recoveryAction,
  );

  const prismaGuardrailDecision = guardrail.decision === 'APPROVED'   ? 'APPROVED'
    : guardrail.decision === 'ESCALATED' ? 'ESCALATED'
    : guardrail.decision === 'NO_ACTION' ? 'APPROVED'   // treated as non-blocking
    : 'BLOCKED';

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'GUARDRAIL_CHECK',
      summary: `Guardrail: ${guardrail.decision} | ${guardrail.checks.length} rules checked`,
      detail: toJson(guardrail),
      actor: 'system',
    },
  });

  // ── Stage 5: Execute (or record why not) ─────────────────────────────────
  const execution = executeRecovery(txn, strategy, guardrail, diagnosis);
  const mappedAction = (ACTION_MAP[execution.action] ?? 'STOP') as
    'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP';
  const mappedOutcome: RecoveryOutcome = OUTCOME_MAP[execution.status] ?? 'FAILED';

  // Upsert RecoveryActionRecord
  await prisma.recoveryActionRecord.upsert({
    where: { transactionId },
    update: {
      action: mappedAction,
      outcome: mappedOutcome,
      amountRecovered: execution.amountRecovered,
      outcomeReason: execution.outcomeReason,
      executedAt: new Date(execution.simulatedAt),
    },
    create: {
      transactionId,
      action: mappedAction,
      outcome: mappedOutcome,
      amountRecovered: execution.amountRecovered,
      outcomeReason: execution.outcomeReason,
      executedAt: new Date(execution.simulatedAt),
    },
  });

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'ACTION_EXECUTED',
      summary: `Executed: ${execution.action} → ${execution.status} | recovered ₹${execution.amountRecovered}`,
      detail: toJson(execution),
      actor: 'system',
    },
  });

  // ── Stage 6: Record outcome audit entry ──────────────────────────────────
  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'OUTCOME_RECORDED',
      summary: `Outcome: ${mappedOutcome} | ₹${execution.amountRecovered} recovered`,
      detail: toJson({ outcome: mappedOutcome, amountRecovered: execution.amountRecovered, isSimulated: true }),
      actor: 'system',
    },
  });

  // ── Update AgentDecision with real guardrail decision ────────────────────
  const agentMappedAction = (ACTION_MAP[strategy.strategy] ?? 'STOP') as
    'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP';

  await prisma.agentDecision.upsert({
    where: { transactionId },
    update: {
      diagnosis: diagnosis.rootCause,
      recommendedAction: agentMappedAction,
      confidence: diagnosis.confidence,
      expectedRecoveryAmount: strategy.estimatedRecoveryAmount,
      reason: strategy.reason,
      aiRaw: toJson(diagnosis),
      fallbackUsed: diagnosis.source === 'FALLBACK',
      guardrailDecision: prismaGuardrailDecision as 'APPROVED' | 'DOWNGRADED' | 'ESCALATED' | 'BLOCKED',
      guardrailReason: guardrail.reason,
      guardrailChecks: toJson(guardrail.checks),
      finalAction: mappedAction,
    },
    create: {
      transactionId,
      diagnosis: diagnosis.rootCause,
      recommendedAction: agentMappedAction,
      confidence: diagnosis.confidence,
      expectedRecoveryAmount: strategy.estimatedRecoveryAmount,
      reason: strategy.reason,
      aiRaw: toJson(diagnosis),
      fallbackUsed: diagnosis.source === 'FALLBACK',
      guardrailDecision: prismaGuardrailDecision as 'APPROVED' | 'DOWNGRADED' | 'ESCALATED' | 'BLOCKED',
      guardrailReason: guardrail.reason,
      guardrailChecks: toJson(guardrail.checks),
      finalAction: mappedAction,
    },
  });

  // ── Response — full pipeline output ──────────────────────────────────────
  res.json({
    transactionId,
    transaction: {
      amount: txn.amount,
      status: txn.status,
      failureCode: txn.failureCode,
      retryCount: txn.retryCount,
    },
    pipeline: {
      risk: {
        riskLevel: risk.riskLevel,
        riskScore: risk.riskScore,
        amountAtRisk: risk.amountAtRisk,
        recoverability: risk.recoverability,
        signals: risk.signals,
        isActionable: risk.isActionable,
        blockerReason: risk.blockerReason,
      },
      diagnosis: {
        rootCause: diagnosis.rootCause,
        confidence: diagnosis.confidence,
        recoverability: diagnosis.recoverability,
        reasoning: diagnosis.reasoning,
        source: diagnosis.source,
        recommendedAction: diagnosis.recommendedAction,
      },
      strategy: {
        strategy: strategy.strategy,
        reason: strategy.reason,
        priority: strategy.priority,
        estimatedRecoveryAmount: strategy.estimatedRecoveryAmount,
      },
      guardrail: guardrail,
      execution: execution,
    },
    summary: {
      decision: guardrail.decision,
      actionExecuted: execution.action,
      outcome: execution.status,
      amountRecovered: execution.amountRecovered,
      isSimulated: true,
    },
  });
});

// ─── GET /api/v1/recovery/process/:transactionId ──────────────────────────────
// Returns the persisted pipeline result for a transaction

router.get('/:transactionId', async (req: Request, res: Response) => {
  const transactionId = String(req.params.transactionId);

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
    include: {
      riskAssessment: true,
      agentDecision: true,
      recoveryAction: true,
      auditLogs: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  res.json(txn);
});

export default router;
