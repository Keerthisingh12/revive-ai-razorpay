# ReviveAI Intelligence Layer & Risk Engine Technical Notes

**Component:** Intelligence Layer (`riskEngine`, `diagnosisAgent`, `strategyRecommender`)

---

## New endpoints (all under `/api/v1`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/transactions` | Paginated list — `page`, `limit`, `status`, `search`, `sortBy`, `sortDir` |
| `GET` | `/transactions/:id` | Full detail with riskAssessment, agentDecision, recoveryAction, auditLogs |
| `GET` | `/risk/summary` | Real-time aggregate: total, failed, at-risk ₹, recoverable, by-level distribution |
| `GET` | `/risk/transaction/:id` | Per-transaction risk score + signals |
| `POST` | `/agent/analyze/:id` | Full pipeline: Risk → Diagnosis → Strategy; persists to DB + audit log |

---

## Risk scoring bands

Score computed from 6 explicit signals (all visible in the API response):

| Band | Score | Label |
|------|-------|-------|
| 0–24 | LOW | No urgent action needed |
| 25–49 | MEDIUM | Monitor / low-touch action |
| 50–74 | HIGH | Active recovery warranted |
| 75–100 | CRITICAL | Immediate intervention |

**Signals:**
1. `FAILURE_CODE` — base points from failure type (BANK_TIMEOUT=55, DUPLICATE_DECLINED=5, etc.)
2. `TRANSACTION_AMOUNT` — ₹199→+3pts, ₹1k→+8, ₹5k→+15, ₹25k→+20
3. `PRIOR_FAILURE_HISTORY` — +5pts per prior failure, capped at 15
4. `RETURNING_CUSTOMER` — negative signal (reduces score) if prior successes ≥ 1
5. `RETRY_COUNT` — +6 for 1 retry, +12 for 2+
6. `FRESH_FAILURE` / `STALENESS` — ±5pts for age

---

## AI diagnosis + fallback

**AI path** (when `GEMINI_API_KEY` is set):
- Calls Gemini 1.5 Flash with low temperature (0.1) for structured output
- 10-second timeout; strips markdown code fences before JSON parse
- Validates response against Zod schema before use
- `source: "AI"` in response

**Fallback path** (always available, always honest):
- Deterministic rules keyed on `failureCode`
- Adjusts confidence by customer history and retry count
- Downgrades RETRY → PAYMENT_LINK if retry count ≥ 2
- `source: "FALLBACK"` — never masquerades as AI

---

## Recovery strategy rules

| Condition | Strategy |
|-----------|----------|
| `optedOutOfContact = true` | `DO_NOT_CONTACT` |
| `recoverability = NONE` | `DO_NOT_CONTACT` |
| `retryCount ≥ 2` AND action is RETRY | `ESCALATE_TO_HUMAN` |
| `amount ≥ ₹25,000` AND action is RETRY | `ESCALATE_TO_HUMAN` |
| `confidence < 65%` | `ESCALATE_TO_HUMAN` |
| Otherwise | Follows AI/fallback recommendation |

**Note:** This `allowed` flag is a first-pass sanity check. The dedicated guardrail engine (amount limits, confidence gates, cooldown windows, dedup) sits on top.

---

## Env vars required

| Var | Required? | Notes |
|-----|-----------|-------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `PORT` | optional | Defaults to 3001 |
| `GEMINI_API_KEY` | optional | Without it, fallback mode runs |

---

## Verification & Smoke Test Results

| Test | Result |
|------|--------|
| `GET /transactions?limit=3&page=1` | ✅ 2000 total, correct pagination |
| Failed transaction detail | ✅ Status, amount, failureCode all correct |
| CAPTURED transaction → agent analyze | ✅ riskLevel=LOW, strategy=DO_NOT_CONTACT, allowed=false |
| Failed transaction → full pipeline | ✅ Risk signals, FALLBACK diagnosis, strategy with reason |
| High-value (₹67,989) NETWORK_ERROR | ✅ ESCALATE_TO_HUMAN (high-value gate) |
| DUPLICATE_DECLINED | ✅ DO_NOT_CONTACT, allowed=false, correct reason |
| No API key → fallback | ✅ source=FALLBACK, works correctly |
| `GET /risk/summary` | ✅ 594 failed, ₹56,47,382 at risk, real computed |
| Frontend transaction list | ✅ Real API data, pagination works |
| Frontend transaction detail + analysis | ✅ Risk signals, diagnosis, strategy, audit timeline |

---

## Files added/modified

```
backend/src/lib/prisma.ts                   NEW  — Prisma singleton
backend/src/services/riskEngine.ts          NEW  — deterministic risk scoring
backend/src/services/diagnosisAgent.ts      NEW  — AI + fallback diagnosis
backend/src/services/strategyRecommender.ts NEW  — recovery strategy
backend/src/routes/transactions.ts          NEW  — GET /transactions, GET /transactions/:id
backend/src/routes/risk.ts                  NEW  — GET /risk/summary, GET /risk/transaction/:id
backend/src/routes/agent.ts                 NEW  — POST /agent/analyze/:id
backend/src/index.ts                        MOD  — wired all routers
frontend/src/api.ts                         NEW  — typed fetch client
frontend/src/pages/TransactionsPage.tsx     NEW  — list + detail view
frontend/src/App.tsx                        MOD  — replaced stub with real component
```
