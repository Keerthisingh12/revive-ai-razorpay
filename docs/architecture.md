# ReviveAI — Architecture

## Core Recovery Loop

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Transaction Dataset (2,000 rows)                   │
│              Seeded: realistic Indian payment failures                 │
│     Status mix: FAILED / AT_RISK / PENDING / CAPTURED / REFUNDED     │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Stage 1 — Revenue Risk Engine                            │
│              backend/src/services/riskEngine.ts                       │
│                                                                       │
│  Inputs:  Transaction (amount, failureCode, retryCount,               │
│           isReturningCustomer, priorSuccess/Failure counts,           │
│           optedOutOfContact, status)                                  │
│                                                                       │
│  Logic:   8 weighted risk signals → composite riskScore (0–100)      │
│           Thresholds: LOW <30, MEDIUM 30–59, HIGH 60–79, CRITICAL 80+│
│                                                                       │
│  Output:  { riskLevel, riskScore, amountAtRisk, isActionable,        │
│             signals: [...] }                                           │
│                                                                       │
│  Non-actionable (CAPTURED, REFUNDED, opted-out) → filtered out here  │
└───────────────────────────────┬─────────────────────────────────────┘
                                │ isActionable = true
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Stage 2 — AI Diagnosis Agent                             │
│              backend/src/services/diagnosisAgent.ts                   │
│                                                                       │
│  Primary:   Gemini 1.5 Flash                                          │
│             Prompt → strict JSON schema → Zod validation             │
│             10-second timeout                                          │
│                                                                       │
│  Fallback:  deterministic_diagnose() — always available              │
│             Maps failureCode → rootCause via lookup table            │
│             (BANK_TIMEOUT → BANK_TIMEOUT, CARD_EXPIRED, etc.)        │
│                                                                       │
│  Output:   { rootCause, confidence, recoverability, reasoning,       │
│              recommendedAction, source: "AI" | "FALLBACK" }           │
│                                                                       │
│  Batch mode always uses FALLBACK (labeled diagnosisMode=deterministic)│
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Stage 3 — Recovery Strategy Recommender                  │
│              backend/src/services/strategyRecommender.ts              │
│                                                                       │
│  Maps diagnosis → recovery action with priority and rationale         │
│  HIGH recoverability + BANK_TIMEOUT → RETRY_PAYMENT                  │
│  CARD_EXPIRED → SEND_PAYMENT_LINK                                     │
│  INSUFFICIENT_FUNDS → OFFER_ALTERNATIVE_METHOD                        │
│  FRAUD_HOLD → ESCALATE_TO_HUMAN                                       │
│  Amount > threshold or low confidence → ESCALATE_TO_HUMAN            │
│                                                                       │
│  Output:  { strategy, reason, priority, allowed, estimatedRecovery } │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│     Stage 4 — Guardrail Engine (DETERMINISTIC — the critical one)    │
│     backend/src/services/guardrailEngine.ts                           │
│                                                                       │
│  "The LLM recommends. This engine decides what's allowed to run."    │
│                                                                       │
│  8 independent rules evaluated in sequence:                           │
│  1. OPT_OUT_CHECK     — customer opted out → always BLOCK            │
│  2. MAX_RETRIES       — retryCount ≥ 2 → BLOCK                       │
│  3. FRAUD_HOLD        — fraud diagnosis → ESCALATE                   │
│  4. AMOUNT_CEILING    — amount > ₹25,000 → BLOCK (hard ceiling)      │
│  5. HIGH_VALUE        — ₹5,000–₹25,000 → ESCALATE to human review   │
│  6. LOW_CONFIDENCE    — AI confidence < 70% → ESCALATE               │
│  7. RECOVERABILITY    — recoverability = NONE → BLOCK                │
│  8. SAFE_TO_EXECUTE   — all checks pass → APPROVE                    │
│                                                                       │
│  Decision: APPROVED | ESCALATED | BLOCKED                            │
│  Every check records its result in guardrailChecks[]                 │
└──────────────────┬──────────────────────────┬────────────────────────┘
                   │ APPROVED                  │ ESCALATED / BLOCKED
                   ▼                           ▼
┌──────────────────────────┐   ┌─────────────────────────────────────┐
│  Stage 5 — Executor       │   │  Human Review Queue                  │
│  recoveryExecutor.ts      │   │  backend/src/routes/review.ts        │
│                           │   │                                      │
│  Deterministic simulation │   │  Shows: transaction, amount,         │
│  Seeded outcomes (seed=42)│   │  risk level, AI recommendation,      │
│  Maps action → outcome:   │   │  confidence, guardrail reason,       │
│  RETRY → 70% success      │   │  failed rule list                    │
│  PAYMENT_LINK → 60%       │   │                                      │
│  REMINDER → 40%           │   │  Actions:                            │
│  SCHEDULE_RETRY → 50%     │   │  APPROVE → runs executor +           │
│                           │   │            writes 3 audit records    │
│  Records amountRecovered  │   │  REJECT  → marks FAILED + 1 audit   │
└──────────┬────────────────┘   │  STOP    → marks STOPPED + 1 audit  │
           │                    └──────────────┬──────────────────────┘
           └──────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Stage 6 — Audit Trail                                    │
│              AuditLog table (Prisma)                                  │
│                                                                       │
│  Every pipeline stage writes a record:                                │
│  RISK_DETECTED → AI_DIAGNOSIS → AI_RECOMMENDATION →                 │
│  GUARDRAIL_CHECK → ACTION_EXECUTED → OUTCOME_RECORDED                │
│  HUMAN_APPROVED | HUMAN_REJECTED | HUMAN_STOPPED                     │
│                                                                       │
│  Fields: transactionId, eventType, summary, detail (JSON),           │
│          actor, createdAt                                             │
│                                                                       │
│  Queryable via GET /api/v1/audit with filters                        │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Batch Simulation + Dashboard                              │
│              simulationEngine.ts + SimulationRun (Prisma)             │
│                                                                       │
│  Batch: runs all 2,000 txns through stages 1–5 in ~0.1s             │
│  Aggregates: atRiskCount, recoveredCount, recoveredAmount,           │
│              escalatedCount, stoppedCount, recoveryRate               │
│  Persisted to SimulationRun table; referenced by dashboard           │
│                                                                       │
│  Reproducible: fixed dataset ordering (id ASC) + deterministic       │
│  executor → same dataset always produces identical numbers           │
└─────────────────────────────────────────────────────────────────────┘
```

## Safety Architecture

**The AI never directly executes a financial action. Ever.**

The system enforces a strict separation between recommendation and execution:

1. Gemini 1.5 Flash produces a structured JSON recommendation: `{ rootCause, recommendedAction, confidence }`. This is a data object — it has no ability to call any API or trigger any side effect.

2. The recommendation is passed to the **Guardrail Engine** (`guardrailEngine.ts`), a fully deterministic, stateless function with 8 independent rules. It reads the recommendation but makes its own decision. The AI cannot override it.

3. Only if the Guardrail Engine returns `decision: "APPROVED"` does the Recovery Executor run.

4. For high-value cases (₹5,000–₹25,000) and fraud holds, the Guardrail Engine routes to the **Human Review Queue** regardless of what the AI recommended.

5. Amounts over ₹25,000 are never auto-executed — hard ceiling, not configurable.

This design means that even if the AI were to hallucinate an aggressive recovery action, the guardrail engine would block or escalate it before it could be executed.

## Data Flow (per-transaction, single call)

```
POST /api/v1/agent/analyze/:id
  → assessRisk(txn)
  → diagnose(txn, risk)         // Gemini → fallback
  → recommendStrategy(txn, risk, diagnosis)
  → checkGuardrails(txn, risk, diagnosis, strategy, existingAction)
  → executeRecovery(txn, strategy, guardrail, diagnosis)
  → writeAuditLogs([RISK_DETECTED, AI_DIAGNOSIS, AI_RECOMMENDATION,
                    GUARDRAIL_CHECK, ACTION_EXECUTED, OUTCOME_RECORDED])
  → upsert RecoveryActionRecord
  → upsert AgentDecision
  → return full pipeline object
```

## Database Schema (key tables)

| Table | Purpose |
|---|---|
| `Transaction` | Source of truth — 2,000 seeded payments |
| `RiskAssessmentResult` | Cached risk score per transaction |
| `AgentDecision` | Cached AI diagnosis + guardrail decision per transaction |
| `RecoveryActionRecord` | Action taken + outcome + amount recovered |
| `AuditLog` | Full event log — one row per pipeline stage per transaction |
| `SimulationRun` | Batch run aggregates + funnel data + metadata |

## File Structure

```
revive-ai-razorpay/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma          — full DB schema
│   │   ├── migrations/            — versioned migrations (committed)
│   │   └── seed.ts                — 2,000 seeded transactions
│   └── src/
│       ├── services/
│       │   ├── riskEngine.ts          — Stage 1: risk scoring
│       │   ├── diagnosisAgent.ts      — Stage 2: AI + fallback diagnosis
│       │   ├── strategyRecommender.ts — Stage 3: action recommendation
│       │   ├── guardrailEngine.ts     — Stage 4: deterministic policy
│       │   ├── recoveryExecutor.ts    — Stage 5: execution simulation
│       │   └── simulationEngine.ts   — Batch engine: all 2,000 txns
│       └── routes/
│           ├── transactions.ts
│           ├── agent.ts               — POST /analyze/:id (full pipeline)
│           ├── recovery.ts            — POST /process/:id (save + execute)
│           ├── simulation.ts          — POST /run, GET /latest
│           ├── audit.ts               — GET /audit (filtered)
│           └── review.ts              — GET /review, POST approve/reject/stop
└── frontend/
    └── src/
        ├── pages/
        │   ├── DashboardPage.tsx
        │   ├── TransactionsPage.tsx
        │   ├── SimulationPage.tsx
        │   ├── AuditPage.tsx
        │   └── ReviewPage.tsx
        └── api.ts                     — typed API client
```
