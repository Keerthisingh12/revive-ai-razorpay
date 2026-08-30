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
