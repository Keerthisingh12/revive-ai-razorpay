/**
 * Comparison routes
 *   GET /api/v1/comparison/baseline — baseline vs ReviveAI comparison (read-only)
 */

import { Router, Request, Response } from 'express';
import { runBaselineComparison } from '../services/baselineComparison';

const router = Router();

router.get('/baseline', async (_req: Request, res: Response) => {
  const result = await runBaselineComparison();
  res.json(result);
});

export default router;
