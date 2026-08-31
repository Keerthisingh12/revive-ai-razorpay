# ReviveAI — Autonomous Payment Recovery Agent

**Razorpay Buildathon 2025 · Track 3: AI Revenue Recovery**

---

## The Problem

Every day, thousands of payments fail silently — insufficient funds, bank timeouts, expired cards, gateway errors. Most payment systems log the failure and stop. The merchant never knows how much of that revenue was actually recoverable, and no automated intervention is attempted.

## The Solution

ReviveAI closes the loop. It detects which failed payments are at risk, uses AI to diagnose the root cause, recommends a recovery action, passes it through a deterministic guardrail engine (so the AI never directly executes a financial action), executes what's allowed, and measures exactly how much was recovered — across a full batch of 2,000 transactions in under a second.

The core claim: **₹2.53L recovered from ₹53.96L at risk (34.4% recovery rate) across 2,000 transactions, reproducibly, with a complete audit trail.**

---

## Screenshots

> **Dashboard** — real computed numbers from the latest batch simulation run.
> **Simulation** — staged progress through the recovery pipeline with funnel metrics.
> **Human Review** — escalated high-value transactions with guardrail reasons + Approve/Reject/Stop.
> **Audit Trail** — filterable timeline of every pipeline event, traceable to actual executions.

*(See the pitch video for a live walkthrough.)*

---

## How It Works — Core Recovery Loop

```
Transaction Dataset (2,000 seeded payments)
            │
            ▼
  ┌─────────────────────┐
  │  Revenue Risk Engine │  — deterministic, rule-based, explainable
  │  (assessRisk)        │    → riskScore, riskLevel, amountAtRisk, signals
  └────────┬────────────┘
           │ at-risk only
           ▼
  ┌─────────────────────┐
  │   AI Diagnosis       │  — Gemini 1.5 Flash (with deterministic fallback)
  │   (diagnose)         │    → rootCause, confidence, recoverability, reasoning
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────┐
  │  Strategy Recommender│  — maps diagnosis → action with priority
  │  (recommendStrategy) │    → RETRY / PAYMENT_LINK / REMINDER / ESCALATE
  └────────┬────────────┘
           │
           ▼
  ┌─────────────────────────────────────────────────────┐
  │              Guardrail Engine (deterministic)         │
  │  "The LLM recommends. This engine decides."          │
  │                                                       │
  │  APPROVE  →  amount < ₹5K, confidence > 70%,        │
  │               retries < 2, not opted-out             │
  │  ESCALATE →  ₹5K–₹25K, or confidence < 70%          │
  │  BLOCK    →  amount > ₹25K, retry cap, opt-out       │
  └──────┬──────────────────────┬────────────────────────┘
         │ APPROVED             │ ESCALATED
         ▼                      ▼
  Recovery Executor      Human Review Queue
  (executeRecovery)       ← Approve / Reject / Stop
         │                      │  (writes 3 audit records)
         └──────────────────────┘
                    │
                    ▼
           Outcome + Audit Log
           (every pipeline step recorded)
                    │
                    ▼
            Dashboard + Batch Metrics
```

**Safety architecture**: The AI (Gemini) only produces a recommendation object. A separate, fully deterministic guardrail engine evaluates 8 independent rules and makes the final allow/block/escalate decision. The AI has zero direct execution authority.

---

## Key Features Built

| Feature | Status |
|---|---|
| Revenue Risk Engine (deterministic, 8 risk signals) | ✅ Day 2 |
| AI Diagnosis via Gemini 1.5 Flash | ✅ Day 2 |
| Deterministic FALLBACK diagnosis (runs when AI unavailable) | ✅ Day 2 |
| Recovery Strategy Recommender | ✅ Day 3 |
| Guardrail Engine (8 rules, 3 tiers, amount/confidence/retry thresholds) | ✅ Day 3 |
| Recovery Executor (deterministic simulated outcomes, fixed seed) | ✅ Day 3 |
| Full audit trail (every pipeline stage logged to AuditLog table) | ✅ Day 3 |
| Batch Simulation Engine (2,000 txns, 0.1s, reproducible) | ✅ Day 4 |
| Dashboard with funnel, charts, policy card (Recharts) | ✅ Day 4 |
| Filterable Audit Trail page | ✅ Day 5 |
| Human Review Queue with Approve/Reject/Stop | ✅ Day 5 |
| Transactions list + per-transaction AI-vs-guardrail detail view | ✅ Day 2–3 |
| Seeded dataset (2,000 realistic Indian payment failures) | ✅ Day 1 |

**Not built (deliberate scope cuts):**
- Live Razorpay webhook integration (test-mode only, would need deployed server)
- Editable guardrail thresholds UI (thresholds visible read-only on dashboard)
- Baseline comparison simulation (stretch goal, not attempted)
- Multi-step human approval workflows or case assignment

---

## Setup Instructions

### Prerequisites
- Node.js 20+
- Docker + Docker Compose (for Postgres)
- (Optional) Gemini API key for live AI diagnosis — the app works without it using deterministic fallback

### 1. Clone and install

```bash
git clone https://github.com/Keerthisingh12/revive-ai-razorpay.git
cd revive-ai-razorpay
cd backend && npm install && cd ..
cd frontend && npm install && cd ..
```

### 2. Start Postgres

```bash
docker-compose up -d
```

### 3. Configure environment

```bash
cp .env.example backend/.env
# Edit backend/.env — set DATABASE_URL if not using Docker defaults
# Optionally add GEMINI_API_KEY for live AI diagnosis
```

### 4. Run database migrations and seed

```bash
cd backend
npx prisma migrate deploy
npx prisma db seed
```

This seeds 2,000 realistic Indian payment transactions with controlled failure modes.

### 5. Start the backend

```bash
cd backend
npm run dev
# Runs on http://localhost:3001
```

### 6. Start the frontend

```bash
cd frontend
npm run dev
# Runs on http://localhost:5173
```

### 7. Run the batch simulation

Navigate to **Run Simulation** in the app and click **Run Batch Recovery**, or:

```bash
curl -X POST http://localhost:3001/api/v1/simulation/run
```

---

## API Reference (quick)

```
GET  /api/v1/transactions            — paginated transaction list
GET  /api/v1/transactions/:id        — single transaction with audit log
POST /api/v1/agent/analyze/:id       — run full pipeline on one transaction
POST /api/v1/recovery/process/:id    — same as above, saves result

POST /api/v1/simulation/run          — batch simulation (2,000 txns, ~0.1s)
GET  /api/v1/simulation/latest       — most recent run aggregates
GET  /api/v1/simulation              — all simulation runs

GET  /api/v1/audit                   — audit log (filters: txnId, eventType, search)
GET  /api/v1/audit/:txnId            — full timeline for one transaction

GET  /api/v1/review                  — escalated queue
POST /api/v1/review/:txnId/approve   — approve + execute + write audit
POST /api/v1/review/:txnId/reject    — reject + write audit
POST /api/v1/review/:txnId/stop      — stop + write audit

GET  /api/v1/risk/summary            — risk distribution across full dataset
GET  /health                         — server health + AI mode
```

---

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 18, TypeScript, Vite, Recharts, Lucide |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 15 (via Docker) |
| ORM | Prisma |
| AI | Google Gemini 1.5 Flash (`@google/generative-ai`) |
| Styling | Vanilla CSS (dark theme) |

---

## Known Limitations

- **Recovery outcomes are simulated** — the executor uses a seeded deterministic function to decide success/failure. In a production system, this would call the actual payment gateway retry API and observe the real outcome.
- **AI diagnosis is rate-limited** — the batch simulation intentionally uses the deterministic fallback path for all 2,000 transactions (labeled `diagnosisMode: "deterministic"`). Single-transaction processing attempts live Gemini AI with a 10s timeout and automatic fallback.
- **No live webhook receiver** — Razorpay webhook handling was scoped out. The system is designed to receive `payment.failed` events; the integration point is documented but not implemented.
- **Seed data only** — the 2,000 transactions are seeded. Adding real merchant integrations requires the webhook layer.
