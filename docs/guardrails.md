# ReviveAI — Guardrail Engine Reference

The guardrail engine (`backend/src/services/guardrailEngine.ts`) is the only component that decides what recovery actions are actually executed. The AI's recommendation is an input — it does not determine the output.

---

## Policy Tiers

| Tier | Condition | Decision |
|---|---|---|
| **Auto-execute** | Amount < ₹5,000 AND confidence ≥ 70% AND retries < 2 AND not opted-out | `APPROVED` |
| **Human review** | Amount ₹5,000–₹25,000 OR confidence < 70% OR fraud diagnosis | `ESCALATED` |
| **Hard block** | Amount > ₹25,000 OR retry count ≥ 2 OR opted-out of contact | `BLOCKED` |

---

## The 8 Rules (evaluated in order)

### Rule 1: `OPT_OUT_CHECK`
```
IF transaction.optedOutOfContact == true
  → decision: BLOCKED
  → reason: "Customer has opted out of all contact"
```
This check runs first. If the customer opted out, no further rules are evaluated — the case is blocked unconditionally.

---

### Rule 2: `MAX_RETRIES`
```
IF transaction.retryCount >= 2
  → decision: BLOCKED
  → reason: "Maximum retry count reached (2)"
```
Prevents retry-spamming on transactions that have already failed multiple times.

---

### Rule 3: `FRAUD_HOLD`
```
IF diagnosis.rootCause == "FRAUD_HOLD"
  → decision: ESCALATED
  → reason: "Fraud hold detected — requires human review"
```
Any fraud-flagged transaction is automatically escalated regardless of amount or confidence.

---

### Rule 4: `AMOUNT_CEILING`
```
IF transaction.amount > 25000
  → decision: BLOCKED
  → reason: "Amount ₹X exceeds hard ceiling ₹25,000 — manual only"
```
Hard ceiling. Never auto-executed, ever. Not configurable at runtime.

---

### Rule 5: `HIGH_VALUE_LIMIT`
```
IF transaction.amount >= 5000 AND transaction.amount <= 25000
  → decision: ESCALATED
  → reason: "Amount ₹X exceeds automatic action limit ₹5,000"
```
High-value but below ceiling → routed to human review queue.

---

### Rule 6: `LOW_CONFIDENCE`
```
IF diagnosis.confidence < 0.70
  → decision: ESCALATED
  → reason: "AI confidence X% below threshold 70%"
```
When the diagnosis is uncertain, escalate rather than act. Applies even for small amounts.

---

### Rule 7: `RECOVERABILITY_NONE`
```
IF diagnosis.recoverability == "NONE"
  → decision: BLOCKED
  → reason: "Transaction assessed as non-recoverable"
```
If the diagnosis engine determines no recovery is possible (e.g. chargebacks, duplicate declines already resolved), block without wasting a recovery attempt.

---

### Rule 8: `SAFE_TO_EXECUTE`
```
All prior checks passed
  → decision: APPROVED
  → reason: "All guardrail checks passed — safe to execute"
```
Only reached if none of the blocking/escalating rules triggered.

---

## Thresholds in Use

| Parameter | Value | Set in |
|---|---|---|
| Auto-action ceiling | ₹5,000 | `guardrailEngine.ts` (line ~25) |
| Human approval ceiling | ₹25,000 | `guardrailEngine.ts` (line ~25) |
| Max retries | 2 | `guardrailEngine.ts` (line ~25) |
| Confidence threshold | 70% (0.70) | `guardrailEngine.ts` (line ~25) |

These defaults come from `process.env.DEFAULT_*` values (set in `.env`) and can be adjusted there without code changes.

---

## Output Format

Every guardrail call returns:

```typescript
{
  decision: 'APPROVED' | 'ESCALATED' | 'BLOCKED',
  allowed: boolean,              // true only for APPROVED
  reason: string,                // human-readable explanation
  checks: Array<{
    rule: string,                // e.g. "OPT_OUT_CHECK"
    passed: boolean,
    detail: string               // e.g. "customer.optedOut = false"
  }>,
  policy: {
    autoActionLimit: number,
    humanApprovalLimit: number,
    maxRetries: number,
    confidenceThreshold: number,
  }
}
```

The `checks` array is stored in `AgentDecision.guardrailChecks` and displayed in the Human Review Queue UI, so reviewers can see exactly which rule triggered the escalation.

---

## Re-running guardrails on human approval

When a human approves a case in the review queue (`POST /api/v1/review/:txnId/approve`), the backend:

1. Re-runs `assessRisk` and `deterministic_diagnose` on the original transaction.
2. Re-runs `recommendStrategy`.
3. Constructs a **human-override guardrail result** (`decision: APPROVED`, `reason: "Human approved by human:reviewer"`).
4. Passes this to `executeRecovery`.

The human override intentionally bypasses the amount/confidence guardrail rules while preserving the opt-out check logic in the executor itself. A human reviewer accepting responsibility for the action is the explicit override mechanism — this is intentional, not a gap.
