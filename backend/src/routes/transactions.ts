/**
 * Transaction routes — GET /api/v1/transactions, GET /api/v1/transactions/:id
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import type { TransactionStatus } from '@prisma/client';

const router = Router();

// ─── GET /api/v1/transactions ─────────────────────────────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const page    = Math.max(1, parseInt(String(req.query.page  ?? '1'), 10));
  const limit   = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? '25'), 10)));
  const skip    = (page - 1) * limit;
  const status  = req.query.status  ? String(req.query.status).toUpperCase()  : undefined;
  const search  = req.query.search  ? String(req.query.search)                 : undefined;
  const sortBy  = String(req.query.sortBy  ?? 'createdAt');
  const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';

  // Build where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};
  if (status) where.status = status as TransactionStatus;
  if (search) {
    where.OR = [
      { id: { contains: search, mode: 'insensitive' } },
      { customerEmail: { contains: search, mode: 'insensitive' } },
      { customerId: { contains: search, mode: 'insensitive' } },
      { failureCode: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [data, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { [sortBy]: sortDir },
      skip,
      take: limit,
      include: {
        riskAssessment: true,
        agentDecision: true,
        recoveryAction: true,
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  res.json({
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
});

// ─── GET /api/v1/transactions/:id ────────────────────────────────────────────

router.get('/:id', async (req: Request, res: Response) => {
  const txn = await prisma.transaction.findUnique({
    where: { id: String(req.params.id) },
    include: {
      riskAssessment: true,
      agentDecision: true,
      recoveryAction: true,
      auditLogs: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  res.json(txn);
});

export default router;
