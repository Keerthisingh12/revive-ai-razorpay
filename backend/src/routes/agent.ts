/**
 * Agent analysis route
 *   POST /api/v1/agent/analyze/:transactionId
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { assessRisk } from '../services/riskEngine';
import { diagnose } from '../services/diagnosisAgent';
import { recommendStrategy } from '../services/strategyRecommender';
import type { RiskLevel as PrismaRiskLevel } from '@prisma/client';

const router = Router();

const toRiskLevel = (level: string): PrismaRiskLevel => level as PrismaRiskLevel;

const actionMap: Record<string, string> = {
  RETRY_PAYMENT:            'RETRY',
  SEND_PAYMENT_LINK:        'PAYMENT_LINK',
  SEND_REMINDER:            'REMINDER',
  OFFER_ALTERNATIVE_METHOD: 'SCHEDULE_RETRY',
  ESCALATE_TO_HUMAN:        'ESCALATE',
  DO_NOT_CONTACT:           'STOP',
};

// Helper: safely cast any object to Prisma-compatible InputJsonValue
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const toJson = (obj: unknown): any => JSON.parse(JSON.stringify(obj));

// ─── POST /api/v1/agent/analyze/:transactionId ───────────────────────────────

router.post('/:transactionId', async (req: Request, res: Response) => {
  const transactionId = String(req.params.transactionId);

  const txn = await prisma.transaction.findUnique({
    where: { id: transactionId },
  });

  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  // ── Step 1: Risk assessment ──────────────────────────────────────────────
  const risk = assessRisk(txn);

  await prisma.riskAssessment.upsert({
    where: { transactionId },
    update: {
      riskLevel: toRiskLevel(risk.riskLevel),
      riskScore: risk.riskScore / 100,
      amountAtRisk: risk.amountAtRisk,
      riskFactors: risk.signals.map((s) => s.description),
    },
    create: {
      transactionId,
      riskLevel: toRiskLevel(risk.riskLevel),
      riskScore: risk.riskScore / 100,
      amountAtRisk: risk.amountAtRisk,
      riskFactors: risk.signals.map((s) => s.description),
    },
  });

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'RISK_DETECTED',
      summary: `Risk level: ${risk.riskLevel} (score ${risk.riskScore}/100)`,
      detail: toJson({ risk }),
      actor: 'system',
    },
  });

  // ── Step 2: AI Diagnosis ─────────────────────────────────────────────────
  const diagnosis = await diagnose(txn, risk);

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'AI_DIAGNOSIS',
      summary: `${diagnosis.source}: ${diagnosis.rootCause}, confidence ${(diagnosis.confidence * 100).toFixed(0)}%`,
      detail: toJson({ diagnosis }),
      actor: diagnosis.source === 'AI' ? 'ai' : 'system',
    },
  });

  // ── Step 3: Recovery strategy ────────────────────────────────────────────
  const strategy = recommendStrategy(txn, risk, diagnosis);

  await prisma.auditLog.create({
    data: {
      transactionId,
      eventType: 'AI_RECOMMENDATION',
      summary: `Recommended: ${strategy.strategy} (${strategy.allowed ? 'allowed' : 'blocked'})`,
      detail: toJson({ strategy }),
      actor: 'system',
    },
  });

  // ── Persist AgentDecision ────────────────────────────────────────────────
  const mappedAction = (actionMap[strategy.strategy] ?? 'STOP') as
    'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP';

  await prisma.agentDecision.upsert({
    where: { transactionId },
    update: {
      diagnosis: diagnosis.rootCause,
      recommendedAction: mappedAction,
      confidence: diagnosis.confidence,
      expectedRecoveryAmount: strategy.estimatedRecoveryAmount,
      reason: strategy.reason,
      aiRaw: toJson(diagnosis),
      fallbackUsed: diagnosis.source === 'FALLBACK',
      guardrailDecision: 'APPROVED',
      guardrailReason: 'Pending Day 3 guardrail engine',
      guardrailChecks: [],
      finalAction: mappedAction,
    },
    create: {
      transactionId,
      diagnosis: diagnosis.rootCause,
      recommendedAction: mappedAction,
      confidence: diagnosis.confidence,
      expectedRecoveryAmount: strategy.estimatedRecoveryAmount,
      reason: strategy.reason,
      aiRaw: toJson(diagnosis),
      fallbackUsed: diagnosis.source === 'FALLBACK',
      guardrailDecision: 'APPROVED',
      guardrailReason: 'Pending Day 3 guardrail engine',
      guardrailChecks: [],
      finalAction: mappedAction,
    },
  });

  res.json({
    transactionId,
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
      },
      strategy: {
        strategy: strategy.strategy,
        reason: strategy.reason,
        allowed: strategy.allowed,
        blockerReason: strategy.blockerReason,
        priority: strategy.priority,
        estimatedRecoveryAmount: strategy.estimatedRecoveryAmount,
      },
    },
    message: 'Analysis complete — Day 3 guardrail engine will enforce execution policy',
  });
});

export default router;
