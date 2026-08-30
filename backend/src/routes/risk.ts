/**
 * Risk routes
 *   GET /api/v1/risk/summary              — aggregate risk stats across all transactions
 *   GET /api/v1/transactions/:id/risk     — per-transaction risk assessment
 */
import { Router, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { assessRisk, computeRiskSummary } from '../services/riskEngine';

const router = Router();

// ─── GET /api/v1/risk/summary ─────────────────────────────────────────────────

router.get('/summary', async (_req: Request, res: Response) => {
  // Fetch all transactions (no join needed — engine works from Transaction fields only)
  const transactions = await prisma.transaction.findMany({
    select: {
      id: true,
      razorpayPaymentId: true,
      merchantId: true,
      customerId: true,
      customerEmail: true,
      customerPhone: true,
      amount: true,
      currency: true,
      status: true,
      failureReason: true,
      failureCode: true,
      isReturningCustomer: true,
      priorSuccessCount: true,
      priorFailureCount: true,
      retryCount: true,
      optedOutOfContact: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  const summary = computeRiskSummary(transactions);

  res.json({
    ...summary,
    computedAt: new Date().toISOString(),
    note: 'All values computed in real-time from the database — never hardcoded',
  });
});

// ─── GET /api/v1/transactions/:id/risk ───────────────────────────────────────

router.get('/transaction/:id', async (req: Request, res: Response) => {
  const txn = await prisma.transaction.findUnique({
    where: { id: String(req.params.id) },
  });

  if (!txn) {
    res.status(404).json({ error: 'Transaction not found' });
    return;
  }

  const result = assessRisk(txn);

  res.json({
    transactionId: txn.id,
    amount: txn.amount,
    status: txn.status,
    ...result,
  });
});

export default router;
