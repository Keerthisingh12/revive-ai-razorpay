/**
 * Human Review Queue routes
 *
 *   GET  /api/v1/review                   — list ESCALATED transactions
 *   GET  /api/v1/review/:txnId            — detail for one escalated case
 *   POST /api/v1/review/:txnId/approve    — approve: run recovery executor + audit
 *   POST /api/v1/review/:txnId/reject     — reject: mark stopped, audit
 *   POST /api/v1/review/:txnId/stop       — stop: mark stopped with reason, audit
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { executeRecovery } from '../services/recoveryExecutor';
import { assessRisk } from '../services/riskEngine';
import { deterministic_diagnose } from '../services/diagnosisAgent';
import { recommendStrategy } from '../services/strategyRecommender';
import { checkGuardrails } from '../services/guardrailEngine';
import type { RecoveryOutcome } from '@prisma/client';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ACTION_MAP: Record<string, 'RETRY' | 'PAYMENT_LINK' | 'REMINDER' | 'SCHEDULE_RETRY' | 'ESCALATE' | 'STOP'> = {
  RETRY_PAYMENT:            'RETRY',
  SEND_PAYMENT_LINK:        'PAYMENT_LINK',
  SEND_REMINDER:            'REMINDER',
  OFFER_ALTERNATIVE_METHOD: 'SCHEDULE_RETRY',
  ESCALATE_TO_HUMAN:        'ESCALATE',
  DO_NOT_CONTACT:           'STOP',
};

// ─── GET /api/v1/review — escalated queue ─────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const page  = Math.max(1, parseInt(String(req.query.page  ?? '1')));
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));

  const [total, records] = await Promise.all([
    prisma.recoveryActionRecord.count({ where: { outcome: 'ESCALATED' } }),
    prisma.recoveryActionRecord.findMany({
      where: { outcome: 'ESCALATED' },
      orderBy: { executedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        transaction: {
          include: {
            riskAssessment: true,
            agentDecision: true,
          },
        },
      },
    }),
  ]);

  const data = records.map(r => ({
    id: r.id,
    transactionId: r.transactionId,
    action: r.action,
    outcome: r.outcome,
    outcomeReason: r.outcomeReason,
    executedAt: r.executedAt,
    transaction: r.transaction
      ? {
          id: r.transaction.id,
          amount: r.transaction.amount,
          status: r.transaction.status,
          failureCode: r.transaction.failureCode,
          merchantId: r.transaction.merchantId,
          customerEmail: r.transaction.customerEmail,
        }
      : null,
    risk: r.transaction?.riskAssessment
      ? {
          riskLevel: r.transaction.riskAssessment.riskLevel,
          riskScore:  r.transaction.riskAssessment.riskScore,
          amountAtRisk: r.transaction.riskAssessment.amountAtRisk,
        }
      : null,
    agentDecision: r.transaction?.agentDecision
      ? {
          diagnosis:           r.transaction.agentDecision.diagnosis,
          recommendedAction:   r.transaction.agentDecision.recommendedAction,
          confidence:          r.transaction.agentDecision.confidence,
          guardrailDecision:   r.transaction.agentDecision.guardrailDecision,
          guardrailReason:     r.transaction.agentDecision.guardrailReason,
          guardrailChecks:     r.transaction.agentDecision.guardrailChecks,
        }
      : null,
  }));

  res.json({
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });
});

// ─── GET /api/v1/review/:txnId ────────────────────────────────────────────────

router.get('/:txnId', async (req: Request, res: Response) => {
  const txnId = String(req.params.txnId);
  const record = await prisma.recoveryActionRecord.findUnique({
    where: { transactionId: txnId },
    include: {
      transaction: {
        include: { riskAssessment: true, agentDecision: true, auditLogs: { orderBy: { createdAt: 'asc' } } },
      },
    },
  });

  if (!record || record.outcome !== 'ESCALATED') {
    res.status(404).json({ error: `No escalated record for ${txnId}` });
    return;
  }

  res.json(record);
});

// ─── POST /api/v1/review/:txnId/approve ──────────────────────────────────────

router.post('/:txnId/approve', async (req: Request, res: Response) => {
  const txnId = String(req.params.txnId);
  const approvedBy: string = req.body?.approvedBy ?? 'human:reviewer';

  const txn = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: { recoveryAction: true, agentDecision: true },
  });

  if (!txn) {
    res.status(404).json({ error: `Transaction ${txnId} not found` });
    return;
  }
  if (!txn.recoveryAction || txn.recoveryAction.outcome !== 'ESCALATED') {
    res.status(400).json({ error: `Transaction ${txnId} is not in ESCALATED state` });
    return;
  }

  // Re-run pipeline to get execution context, but BYPASS amount guardrail for human approval
  const risk     = assessRisk(txn);
  const diagnosis= deterministic_diagnose(txn, risk);
  const strategy = recommendStrategy(txn, risk, diagnosis);

  // Build a mock guardrail result that marks APPROVED (human has overridden)
  const guardrailOverride = {
    decision:   'APPROVED' as const,
    allowed:    true,
    reason:     `Human approved by ${approvedBy}`,
    checks:     [{ rule: 'HUMAN_OVERRIDE', passed: true, detail: `Approved by ${approvedBy}` }],
    policy:     { autoActionLimit: 0, humanApprovalLimit: 0, maxRetries: 99, confidenceThreshold: 0 },
  };

  // Execute recovery
  const execution = executeRecovery(txn, strategy, guardrailOverride, diagnosis);

  const mappedAction = ACTION_MAP[execution.action] ?? 'RETRY';
  const mappedOutcome: RecoveryOutcome = execution.status === 'SUCCEEDED' ? 'RECOVERED'
    : execution.status === 'FAILED' ? 'FAILED' : 'STOPPED';
  const amountRecovered = execution.amountRecovered;

  // Persist outcome
  await prisma.recoveryActionRecord.update({
    where: { transactionId: txnId },
    data: {
      action:          mappedAction,
      outcome:         mappedOutcome,
      amountRecovered,
      outcomeReason:   `Human approved by ${approvedBy}. ${execution.outcomeReason}`,
      executedAt:      new Date(),
    },
  });

  // Audit records
  await prisma.auditLog.createMany({
    data: [
      {
        transactionId: txnId,
        eventType:     'HUMAN_APPROVED',
        summary:       `Human approved by ${approvedBy} — executing ${execution.action.replace(/_/g,' ')}`,
        detail:        { approvedBy, action: execution.action, guardrailOverride: true },
        actor:         approvedBy,
      },
      {
        transactionId: txnId,
        eventType:     'ACTION_EXECUTED',
        summary:       `Executed: ${execution.action} → ${execution.status} | recovered ₹${amountRecovered}`,
        detail:        { action: execution.action, status: execution.status, amountRecovered },
        actor:         approvedBy,
      },
      {
        transactionId: txnId,
        eventType:     'OUTCOME_RECORDED',
        summary:       `Outcome: ${mappedOutcome} | ₹${amountRecovered} recovered (human-approved)`,
        detail:        { outcome: mappedOutcome, amountRecovered, approvedBy },
        actor:         approvedBy,
      },
    ],
  });

  res.json({
    transactionId: txnId,
    action:         execution.action,
    outcome:        mappedOutcome,
    amountRecovered,
    outcomeReason:  execution.outcomeReason,
    auditRecords:   3,
  });
});

// ─── POST /api/v1/review/:txnId/reject ───────────────────────────────────────

router.post('/:txnId/reject', async (req: Request, res: Response) => {
  const txnId = String(req.params.txnId);
  const rejectedBy: string  = req.body?.rejectedBy ?? 'human:reviewer';
  const reason: string      = req.body?.reason ?? 'Manually rejected';

  const txn = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: { recoveryAction: true },
  });

  if (!txn) {
    res.status(404).json({ error: `Transaction ${txnId} not found` });
    return;
  }
  if (!txn.recoveryAction || txn.recoveryAction.outcome !== 'ESCALATED') {
    res.status(400).json({ error: `Transaction ${txnId} is not in ESCALATED state` });
    return;
  }

  await prisma.recoveryActionRecord.update({
    where:  { transactionId: txnId },
    data:   { outcome: 'FAILED', amountRecovered: 0, outcomeReason: `Rejected by ${rejectedBy}: ${reason}` },
  });

  await prisma.auditLog.create({
    data: {
      transactionId: txnId,
      eventType:     'HUMAN_REJECTED',
      summary:       `Human rejected by ${rejectedBy} — ${reason}`,
      detail:        { rejectedBy, reason, noActionTaken: true },
      actor:         rejectedBy,
    },
  });

  res.json({ transactionId: txnId, outcome: 'FAILED', reason, auditRecords: 1 });
});

// ─── POST /api/v1/review/:txnId/stop ─────────────────────────────────────────

router.post('/:txnId/stop', async (req: Request, res: Response) => {
  const txnId = String(req.params.txnId);
  const stoppedBy: string = req.body?.stoppedBy ?? 'human:reviewer';
  const reason: string   = req.body?.reason ?? 'Manually stopped';

  const txn = await prisma.transaction.findUnique({
    where: { id: txnId },
    include: { recoveryAction: true },
  });

  if (!txn) {
    res.status(404).json({ error: `Transaction ${txnId} not found` });
    return;
  }
  if (!txn.recoveryAction || txn.recoveryAction.outcome !== 'ESCALATED') {
    res.status(400).json({ error: `Transaction ${txnId} is not in ESCALATED state` });
    return;
  }

  await prisma.recoveryActionRecord.update({
    where: { transactionId: txnId },
    data:  { outcome: 'STOPPED', amountRecovered: 0, outcomeReason: `Stopped by ${stoppedBy}: ${reason}` },
  });

  await prisma.auditLog.create({
    data: {
      transactionId: txnId,
      eventType:     'HUMAN_STOPPED',
      summary:       `Human stopped by ${stoppedBy} — ${reason}`,
      detail:        { stoppedBy, reason, noActionTaken: true },
      actor:         stoppedBy,
    },
  });

  res.json({ transactionId: txnId, outcome: 'STOPPED', reason, auditRecords: 1 });
});

export default router;
