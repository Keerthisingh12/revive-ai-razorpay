/**
 * Audit Trail routes
 *   GET /api/v1/audit           — paginated audit log, filterable
 *   GET /api/v1/audit/:txnId    — full timeline for one transaction
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import type { AuditEventType } from '@prisma/client';

const router = Router();

// ─── GET /api/v1/audit ────────────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const page     = Math.max(1, parseInt(String(req.query.page  ?? '1')));
  const limit    = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '50'))));
  const txnId    = req.query.txnId    ? String(req.query.txnId)    : undefined;
  const eventType= req.query.eventType? String(req.query.eventType): undefined;
  const search   = req.query.search   ? String(req.query.search)   : undefined;
  const since    = req.query.since    ? new Date(String(req.query.since)) : undefined;
  const until    = req.query.until    ? new Date(String(req.query.until)) : undefined;

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (txnId)    where.transactionId = { contains: txnId, mode: 'insensitive' };
  if (eventType) {
    const validTypes: AuditEventType[] = [
      'RISK_DETECTED','AI_DIAGNOSIS','AI_RECOMMENDATION',
      'GUARDRAIL_CHECK','ACTION_EXECUTED','OUTCOME_RECORDED',
      'HUMAN_APPROVED','HUMAN_REJECTED','HUMAN_STOPPED',
    ];
    if (validTypes.includes(eventType as AuditEventType)) {
      where.eventType = eventType as AuditEventType;
    }
  }
  if (search) {
    where.summary = { contains: search, mode: 'insensitive' };
  }
  if (since || until) {
    where.createdAt = {};
    if (since) where.createdAt.gte = since;
    if (until) where.createdAt.lte = until;
  }

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        transaction: {
          select: {
            id: true,
            amount: true,
            status: true,
            failureCode: true,
            merchantId: true,
            customerEmail: true,
          },
        },
      },
    }),
  ]);

  res.json({
    data: logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /api/v1/audit/:txnId ─────────────────────────────────────────────────

router.get('/:txnId', async (req: Request, res: Response) => {
  const txnId = String(req.params.txnId);

  // Verify transaction exists
  const txn = await prisma.transaction.findUnique({
    where: { id: txnId },
    select: { id: true, amount: true, status: true, failureCode: true, merchantId: true },
  });

  if (!txn) {
    res.status(404).json({ error: `Transaction ${txnId} not found` });
    return;
  }

  const logs = await prisma.auditLog.findMany({
    where: { transactionId: txnId },
    orderBy: { createdAt: 'asc' },
  });

  res.json({ transaction: txn, logs, count: logs.length });
});

export default router;
