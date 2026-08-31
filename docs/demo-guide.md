# ReviveAI — Demo Guide

Step-by-step walkthrough matching the pitch video structure. Every step is reproducible from the running app.

---

## Prerequisites

App running: `http://localhost:5173` (frontend), `http://localhost:3001` (backend).
Database seeded with 2,000 transactions. At least one simulation run already executed.

---

## 0. Open the app

Navigate to `http://localhost:5173`. You land on the **Dashboard**.

---

## 1. Dashboard (0:30–1:00 in video)

- KPI cards show: Revenue at Risk (₹53.96L), Revenue Recovered (₹2.53L), Recovery Rate (34.4%), Actions Executed (231).
- Recovery Funnel: 2,000 → 567 at risk → 231 approved → 231 executed → 195 recovered.
- Risk Distribution bar chart: LOW / MEDIUM / HIGH / CRITICAL breakdown.
- Outcome pie chart: recovered vs escalated vs stopped.
- Guardrail Policy card at bottom — three tiers read-only.

**What to say:** "These numbers come from a real computed batch run across all 2,000 transactions — not estimates."

---

## 2. Single Transaction — Approved Case (1:00–2:00 in video)

1. Click **Transactions** in the sidebar.
2. Filter by status = FAILED, find a transaction with amount < ₹5,000 and failure code `NETWORK_ERROR` or `BANK_TIMEOUT`.
3. Click it to open the detail view.
4. Click **Analyze Transaction** (if not yet analyzed).
5. Show the AI-vs-Guardrail panel:
   - **Risk**: score, level, signals.
   - **AI Diagnosis**: rootCause, confidence, recoverability.
   - **Guardrail**: APPROVED — list of checks all passed.
   - **Outcome**: RECOVERED or FAILED (with amount recovered if success).

**Good demo transaction IDs:** look for any txn where `recoveryAction.outcome == 'RECOVERED'` in the transactions list.

**What to say:** "The AI diagnosed this as a network timeout with 90% confidence. The guardrail approved it — amount is below ₹5,000, retry count is under the cap. Recovery was attempted and succeeded."

---

## 3. Single Transaction — Escalated Case (2:00–2:45 in video)

1. Still on Transactions — find a transaction with amount > ₹5,000 (e.g. ₹15,000–₹25,000).
2. Or navigate directly to **Human Review** in the sidebar.
3. Show an escalated card:
   - Transaction ID, amount, failure code.
   - AI recommendation (e.g. RETRY_PAYMENT, 85% confidence).
   - Guardrail reason: "Amount ₹15,538 exceeds automatic action limit ₹5,000".
   - Failed check: `HIGH_VALUE_LIMIT: amount ₹15,538 > ₹5,000 auto-limit`.

4. Click **Approve** — watch the button go to loading → then the card flips to "APPROVED" green state.

5. Go back to the Audit Trail and search for that transaction ID — show the `HUMAN_APPROVED`, `ACTION_EXECUTED`, and `OUTCOME_RECORDED` entries.

**What to say:** "The AI recommended a retry. The guardrail said: high-value transaction, route to human review. I'm approving it here — the system executes the recovery and writes a full audit record."

---

## 4. Batch Simulation (2:45–3:45 in video)

1. Click **Run Simulation** in the sidebar.
2. If a previous result is shown, click **Run Again** (top right).
3. Watch the 5-stage progress animation:
   - Detecting revenue risk…
   - Running deterministic failure diagnosis…
   - Applying guardrail rules…
   - Executing approved recovery actions…
   - Calculating recovery metrics…
4. Results appear:
   - At Risk: 567 txns | ₹53.96L
   - Recovered: 195 txns | ₹2.53L | 34.4%
   - Escalated: 221 | Stopped: 115
5. Recovery funnel visualization.
6. Run it again — identical numbers. **"This is reproducible."**

**What to say:** "2,000 transactions through the full pipeline in 0.1 seconds. 567 at risk. 231 got through the guardrail. 195 recovered. These numbers are computed, not estimated — and they're reproducible because the pipeline is deterministic."

---

## 5. Audit Trail (3:45–4:15 in video)

1. Click **Audit Trail** in the sidebar.
2. Show the list — timestamps, event types, transaction IDs, summaries.
3. Filter by **Transaction ID**: paste in the txn you approved in step 3.
4. Show the filtered timeline: `RISK_DETECTED` → `AI_DIAGNOSIS` → `AI_RECOMMENDATION` → `GUARDRAIL_CHECK` → `HUMAN_APPROVED` → `ACTION_EXECUTED` → `OUTCOME_RECORDED`.
5. Filter by event type = `HUMAN_REJECTED` — show that those rejection decisions are also recorded.

**What to say:** "Every step of the pipeline is logged. This is the audit trail the compliance team would review."

---

## 6. Architecture (4:15–4:45 in video)

Show `docs/architecture.md` or the diagram in the README.

**What to say (exact):** "The AI produces a recommendation object. It cannot execute anything. A separate deterministic guardrail engine evaluates 8 independent rules and decides what's allowed. Even if the AI hallucinated an aggressive action, the guardrail would catch it."

---

## 7. Close (4:45–5:00 in video)

**What's built:** risk engine, AI diagnosis with fallback, guardrail engine, recovery executor, audit trail, human review queue, batch simulation, dashboard.

**What's not built (honest):** live Razorpay webhook integration, editable guardrail thresholds UI, baseline comparison simulation. These are documented in the README as future work.

---

## Useful curl commands for live demo backup

```bash
# Run simulation
curl -X POST http://localhost:3001/api/v1/simulation/run

# Get latest results
curl http://localhost:3001/api/v1/simulation/latest | python3 -m json.tool

# Analyze a transaction
curl -X POST http://localhost:3001/api/v1/agent/analyze/txn_000001_42 | python3 -m json.tool

# Audit trail for a transaction
curl "http://localhost:3001/api/v1/audit/txn_000001_42" | python3 -m json.tool

# Review queue
curl http://localhost:3001/api/v1/review?limit=3 | python3 -m json.tool

# Approve an escalated case
curl -X POST http://localhost:3001/api/v1/review/txn_001014_42/approve \
     -H "Content-Type: application/json" \
     -d '{"approvedBy":"human:reviewer"}'
```
