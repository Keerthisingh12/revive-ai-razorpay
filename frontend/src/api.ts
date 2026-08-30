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
  byRiskLevel: Record<string, number>;
}

export function getFullRiskSummary(): Promise<RiskSummaryFull> {
  return request<RiskSummaryFull>('/risk/summary');
}
