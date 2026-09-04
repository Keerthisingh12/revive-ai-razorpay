/**
 * API client — thin wrapper over fetch pointing at the backend.
 * All API calls go through here; never expose keys to frontend.
 */

const API_BASE = '/api/v1';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Transaction {
  id: string;
  merchantId: string;
  customerId: string;
  customerEmail: string;
  customerPhone?: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'FAILED' | 'CAPTURED' | 'REFUNDED' | 'AT_RISK';
  failureReason?: string;
  failureCode?: string;
  isReturningCustomer: boolean;
  priorSuccessCount: number;
  priorFailureCount: number;
  retryCount: number;
  optedOutOfContact: boolean;
  createdAt: string;
  updatedAt: string;
  riskAssessment?: RiskAssessment;
  agentDecision?: AgentDecision;
  recoveryAction?: RecoveryActionRecord;
  auditLogs?: AuditLog[];
}

export interface RiskAssessment {
  id: string;
  transactionId: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskScore: number;
  amountAtRisk: number;
  riskFactors: string[];
  createdAt: string;
}

export interface AgentDecision {
  id: string;
  transactionId: string;
  diagnosis: string;
  recommendedAction: string;
  confidence: number;
  expectedRecoveryAmount: number;
  reason: string;
  aiRaw?: unknown;
  fallbackUsed: boolean;
  guardrailDecision: string;
  guardrailReason: string;
  guardrailChecks: unknown[];
  finalAction: string;
  createdAt: string;
}

export interface RecoveryActionRecord {
  id: string;
  transactionId: string;
  action: string;
  executedAt: string;
  outcome: string;
  amountRecovered: number;
  outcomeReason?: string;
}

export interface AuditLog {
  id: string;
  transactionId: string;
  eventType: string;
  summary: string;
  detail: unknown;
  actor: string;
  createdAt: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface TransactionListResponse {
  data: Transaction[];
  pagination: Pagination;
}

export interface RiskSignal {
  type: string;
  severity: string;
  description: string;
  points: number;
}

export interface AnalysisResult {
  transactionId: string;
  pipeline: {
    risk: {
      riskLevel: string;
      riskScore: number;
      amountAtRisk: number;
      recoverability: string;
      signals: RiskSignal[];
      isActionable: boolean;
      blockerReason?: string;
    };
    diagnosis: {
      rootCause: string;
      confidence: number;
      recoverability: string;
      reasoning: string;
      source: 'AI' | 'FALLBACK';
    };
    strategy: {
      strategy: string;
      reason: string;
      allowed: boolean;
      blockerReason?: string;
      priority: string;
      estimatedRecoveryAmount: number;
    };
  };
}

export interface RiskSummary {
  total: number;
  failed: number;
  captured: number;
  totalAtRiskAmount: number;
  recoverableCount: number;
  recoverableAmount: number;
  byRiskLevel: Record<string, { count: number; amount: number }>;
  byFailureCode: Record<string, number>;
  computedAt: string;
}

// ─── API functions ────────────────────────────────────────────────────────────

export interface TransactionFilters {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
}

export function getTransactions(filters: TransactionFilters = {}): Promise<TransactionListResponse> {
  const params = new URLSearchParams();
  if (filters.page)    params.set('page',    String(filters.page));
  if (filters.limit)   params.set('limit',   String(filters.limit));
  if (filters.status)  params.set('status',  filters.status);
  if (filters.search)  params.set('search',  filters.search);
  if (filters.sortBy)  params.set('sortBy',  filters.sortBy);
  if (filters.sortDir) params.set('sortDir', filters.sortDir);
  return request<TransactionListResponse>(`/transactions?${params}`);
}

export function getTransaction(id: string): Promise<Transaction> {
  return request<Transaction>(`/transactions/${id}`);
}

export function analyzeTransaction(id: string): Promise<AnalysisResult> {
  return request<AnalysisResult>(`/agent/analyze/${id}`, { method: 'POST' });
}

export function getRiskSummary(): Promise<RiskSummary> {
  return request<RiskSummary>('/risk/summary');
}

export function getTransactionRisk(id: string): Promise<unknown> {
  return request<unknown>(`/risk/transaction/${id}`);
}

// ─── Process (full loop) ─────────────────────────────────────────────────────

export interface GuardrailCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface ProcessResult {
  transactionId: string;
  transaction: { amount: number; status: string; failureCode?: string; retryCount: number };
  pipeline: {
    risk: AnalysisResult['pipeline']['risk'];
    diagnosis: AnalysisResult['pipeline']['diagnosis'] & { recommendedAction: string };
    strategy: { strategy: string; reason: string; priority: string; estimatedRecoveryAmount: number };
    guardrail: {
      decision: string;
      allowed: boolean;
      checks: GuardrailCheck[];
      reason: string;
      policy: { autoActionLimit: number; humanApprovalLimit: number; maxRetries: number; confidenceThreshold: number };
    };
    execution: {
      action: string;
      status: string;
      amountRecovered: number;
      outcomeReason: string;
      simulatedAt: string;
      isSimulated: boolean;
    };
  };
  summary: {
    decision: string;
    actionExecuted: string;
    outcome: string;
    amountRecovered: number;
    isSimulated: boolean;
  };
}

export function processTransaction(id: string): Promise<ProcessResult> {
  return request<ProcessResult>(`/recovery/process/${id}`, { method: 'POST' });
}

// ─── Simulation ───────────────────────────────────────────────────────────────

export interface FunnelStep {
  label: string;
  value: number;
  amount?: number;
}

export interface SimulationAggregates {
  totalTransactions: number;
  atRiskCount: number;
  atRiskAmount: number;
  opportunityCount: number;
  approvedCount: number;
  executedCount: number;
  escalatedCount: number;
  stoppedCount: number;
  recoveredCount: number;
  recoveredAmount: number;
  recoveryRate: number;
}

export interface SimulationRun {
  id: string;
  completedAt: string;
  durationMs: number;
  durationSeconds: number;
  seed: number;
  aggregates: SimulationAggregates;
  funnelData: FunnelStep[];
  meta: { diagnosisMode: string; seed: string };
}

export interface SimulationRunResult extends SimulationRun {
  runId: string;
  status: string;
  startedAt: string;
}

export function runSimulation(): Promise<SimulationRunResult> {
  return request<SimulationRunResult>('/simulation/run', { method: 'POST' });
}

export function getLatestSimulation(): Promise<SimulationRun> {
  return request<SimulationRun>('/simulation/latest');
}

export function getSimulationRuns(): Promise<{ runs: SimulationRun[]; count: number }> {
  return request<{ runs: SimulationRun[]; count: number }>('/simulation');
}

// ─── Risk summary (for dashboard) ────────────────────────────────────────────

export interface RiskSummaryFull {
  total: number;
  failed: number;
  atRisk: number;
  captured: number;
  totalAtRiskAmount: number;
  recoverableCount: number;
  byRiskLevel: Record<string, { count: number; amount: number } | number>;
}

export function getFullRiskSummary(): Promise<RiskSummaryFull> {
  return request<RiskSummaryFull>('/risk/summary');
}

// ─── Audit Trail ──────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id: string;
  transactionId: string;
  eventType: string;
  summary: string;
  detail: Record<string, unknown>;
  actor: string;
  createdAt: string;
  transaction?: {
    id: string; amount: number; status: string;
    failureCode?: string; merchantId: string; customerEmail: string;
  };
}

export interface AuditFilters {
  page?: number; limit?: number;
  txnId?: string; eventType?: string;
  search?: string; since?: string; until?: string;
}

export function getAuditLogs(filters: AuditFilters = {}): Promise<{
  data: AuditLogEntry[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const p = new URLSearchParams();
  if (filters.page)      p.set('page',      String(filters.page));
  if (filters.limit)     p.set('limit',     String(filters.limit));
  if (filters.txnId)     p.set('txnId',     filters.txnId);
  if (filters.eventType) p.set('eventType', filters.eventType);
  if (filters.search)    p.set('search',    filters.search);
  if (filters.since)     p.set('since',     filters.since);
  if (filters.until)     p.set('until',     filters.until);
  return request(`/audit?${p}`);
}

export function getAuditTimeline(txnId: string): Promise<{
  transaction: { id: string; amount: number; status: string; failureCode?: string };
  logs: AuditLogEntry[];
  count: number;
}> {
  return request(`/audit/${txnId}`);
}

// ─── Review Queue ─────────────────────────────────────────────────────────────

export interface ReviewRecord {
  id: string;
  transactionId: string;
  action: string;
  outcome: string;
  outcomeReason?: string;
  executedAt: string;
  transaction: {
    id: string; amount: number; status: string;
    failureCode?: string; merchantId: string; customerEmail: string;
  } | null;
  risk: { riskLevel: string; riskScore: number; amountAtRisk: number } | null;
  agentDecision: {
    diagnosis: string; recommendedAction: string; confidence: number;
    guardrailDecision: string; guardrailReason: string;
    guardrailChecks: Array<{ rule: string; passed: boolean; detail: string }>;
  } | null;
}

export function getReviewQueue(page = 1, limit = 50): Promise<{
  data: ReviewRecord[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  return request(`/review?page=${page}&limit=${limit}`);
}

export function approveReview(txnId: string): Promise<{
  transactionId: string; action: string; outcome: string;
  amountRecovered: number; outcomeReason: string; auditRecords: number;
}> {
  return request(`/review/${txnId}/approve`, { method: 'POST',
    body: JSON.stringify({ approvedBy: 'human:reviewer' }) });
}

export function rejectReview(txnId: string, reason = 'Manually rejected'): Promise<{
  transactionId: string; outcome: string; reason: string;
}> {
  return request(`/review/${txnId}/reject`, { method: 'POST',
    body: JSON.stringify({ rejectedBy: 'human:reviewer', reason }) });
}

export function stopReview(txnId: string, reason = 'Manually stopped'): Promise<{
  transactionId: string; outcome: string; reason: string;
}> {
  return request(`/review/${txnId}/stop`, { method: 'POST',
    body: JSON.stringify({ stoppedBy: 'human:reviewer', reason }) });
}

// ─── Baseline Comparison ──────────────────────────────────────────────────────

export interface BaselineArm {
  actionsCount: number;
  recoveredCount: number;
  recoveredAmount: number;
  recoveryRate: number;
  label: string;
}

export interface EscalatedArm {
  count: number;
  totalAmount: number;
  hypotheticalRecoveredCount: number;
  hypotheticalRecoveredAmount: number;
  label: string;
}

export interface SafetyComparison {
  baselineRiskyActions: number;
  baselineRiskyAmount: number;
  preventedRiskyActions: number;
  preventedRiskyAmount: number;
  byRule: Record<string, number>;
  note: string;
}

export interface StrategyEffectivenessRow {
  failureCode: string | null;
  action: string;
  outcome: string;
  count: number;
  totalRecovered: number;
}

export interface BaselineComparisonResult {
  population: {
    totalTransactions: number;
    atRiskCount: number;
    atRiskAmount: number;
  };
  baseline: BaselineArm;
  reviveai: BaselineArm | null;
  escalated: EscalatedArm | null;
  safety: SafetyComparison;
  strategyEffectiveness: {
    data: StrategyEffectivenessRow[];
    caveat: string;
  } | null;
}

export function getBaselineComparison(): Promise<BaselineComparisonResult> {
  return request<BaselineComparisonResult>('/comparison/baseline');
}
