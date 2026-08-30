/**
 * Transactions page — Day 2 + Day 3 additions.
 * Day 2: real API list + detail with risk signals + diagnosis.
 * Day 3: full-loop button + AI-vs-guardrail decision view.
 */
import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  AlertTriangle, CheckCircle, XCircle, Clock, ChevronRight,
  RefreshCw, ArrowLeft, Cpu, ShieldCheck, Zap, Bot, Wrench, Play
} from 'lucide-react';
import {
  getTransactions, getTransaction, analyzeTransaction, processTransaction,
  type Transaction, type TransactionListResponse, type AnalysisResult, type ProcessResult,
} from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return '₹' + n.toLocaleString('en-IN');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

const STATUS_STYLES: Record<string, string> = {
  FAILED:   'bg-red-500/15 text-red-400 border border-red-500/30',
  CAPTURED: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  PENDING:  'bg-yellow-500/15 text-yellow-400 border border-yellow-500/30',
  AT_RISK:  'bg-orange-500/15 text-orange-400 border border-orange-500/30',
  REFUNDED: 'bg-slate-500/15 text-slate-400 border border-slate-500/30',
};

const RISK_STYLES: Record<string, string> = {
  LOW:      'text-emerald-400',
  MEDIUM:   'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-400',
};

const SEVERITY_DOT: Record<string, string> = {
  LOW:      'bg-emerald-400',
  MEDIUM:   'bg-yellow-400',
  HIGH:     'bg-orange-400',
  CRITICAL: 'bg-red-400',
};

// ─── Transaction List ─────────────────────────────────────────────────────────

function TransactionList() {
  const navigate = useNavigate();
  const [data, setData] = useState<TransactionListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getTransactions({
        page, limit: 25, status: statusFilter || undefined, search: search || undefined
      });
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, search]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-4 fade-in">
      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search ID, email, code…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          className="flex-1 min-w-48 px-3 py-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-200 text-sm placeholder-slate-500 focus:outline-none focus:border-indigo-500"
        />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-200 text-sm focus:outline-none focus:border-indigo-500"
        >
          <option value="">All statuses</option>
          <option value="FAILED">Failed</option>
          <option value="CAPTURED">Captured</option>
          <option value="PENDING">Pending</option>
        </select>
        <button
          onClick={load}
          className="px-3 py-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200 text-sm flex items-center gap-2"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl bg-[#111827] border border-[#2a3a52] overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_auto_auto_auto] text-xs text-slate-500 px-4 py-2.5 border-b border-[#2a3a52] font-medium uppercase tracking-wide">
          <span>Transaction</span>
          <span className="w-28 text-center">Amount</span>
          <span className="w-24 text-center">Status</span>
          <span className="w-24 text-center">Risk</span>
          <span className="w-8"></span>
        </div>

        {loading ? (
          Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto_auto] px-4 py-3 border-b border-[#1a2235] animate-pulse">
              <div className="h-4 bg-slate-700/40 rounded w-48"></div>
              <div className="h-4 bg-slate-700/40 rounded w-20 ml-auto"></div>
              <div className="h-4 bg-slate-700/40 rounded w-16 mx-auto"></div>
              <div className="h-4 bg-slate-700/40 rounded w-16 mx-auto"></div>
              <div></div>
            </div>
          ))
        ) : data?.data.map((txn) => (
          <div
            key={txn.id}
            onClick={() => navigate(`/transactions/${txn.id}`)}
            className="grid grid-cols-[1fr_auto_auto_auto_auto] px-4 py-3 border-b border-[#1a2235] hover:bg-white/[0.03] cursor-pointer transition-colors items-center"
          >
            <div>
              <p className="text-sm text-slate-200 font-mono">{txn.id}</p>
              <p className="text-xs text-slate-500 mt-0.5">{txn.customerEmail} · {fmtDate(txn.createdAt)}</p>
            </div>
            <div className="w-28 text-right text-sm font-semibold text-slate-200">
              {fmtINR(txn.amount)}
            </div>
            <div className="w-24 flex justify-center">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[txn.status] ?? ''}`}>
                {txn.status}
              </span>
            </div>
            <div className="w-24 flex justify-center">
              {txn.riskAssessment ? (
                <span className={`text-xs font-semibold ${RISK_STYLES[txn.riskAssessment.riskLevel]}`}>
                  {txn.riskAssessment.riskLevel}
                </span>
              ) : (
                <span className="text-xs text-slate-600">—</span>
              )}
            </div>
            <div className="w-8 flex justify-end">
              <ChevronRight size={14} className="text-slate-600" />
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {data && (
        <div className="flex items-center justify-between text-sm text-slate-400">
          <span>{data.pagination.total.toLocaleString()} transactions</span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] disabled:opacity-40 hover:text-slate-200 transition-colors"
            >
              Prev
            </button>
            <span className="px-3 py-1.5 text-slate-300 text-xs">
              Page {page} / {data.pagination.totalPages}
            </span>
            <button
              disabled={page >= data.pagination.totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] disabled:opacity-40 hover:text-slate-200 transition-colors"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Transaction Detail ───────────────────────────────────────────────────────

function TransactionDetail({ id }: { id: string }) {
  const navigate = useNavigate();
  const [txn, setTxn] = useState<Transaction | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [loadingTxn, setLoadingTxn] = useState(true);
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const [loadingProcess, setLoadingProcess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoadingTxn(true);
    getTransaction(id)
      .then(setTxn)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoadingTxn(false));
  }, [id]);

  const runAnalysis = async () => {
    setLoadingAnalysis(true);
    setError(null);
    try {
      const res = await analyzeTransaction(id);
      setAnalysis(res);
      const updated = await getTransaction(id);
      setTxn(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingAnalysis(false);
    }
  };

  const runFullLoop = async () => {
    setLoadingProcess(true);
    setError(null);
    try {
      const res = await processTransaction(id);
      setProcessResult(res);
      const updated = await getTransaction(id);
      setTxn(updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingProcess(false);
    }
  };

  if (loadingTxn) {
    return (
      <div className="space-y-4 animate-pulse">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-[#111827]"></div>
        ))}
      </div>
    );
  }

  if (!txn) return <div className="text-red-400">{error ?? 'Transaction not found'}</div>;

  const pipeline = analysis?.pipeline;

  return (
    <div className="space-y-5 fade-in">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/transactions')}
          className="p-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200"
        >
          <ArrowLeft size={16} />
        </button>
        <div>
          <h2 className="text-base font-semibold text-slate-100 font-mono">{txn.id}</h2>
          <p className="text-xs text-slate-500">{txn.customerEmail} · {fmtDate(txn.createdAt)}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_STYLES[txn.status] ?? ''}`}>
            {txn.status}
          </span>
          <span className="text-lg font-bold text-slate-100">{fmtINR(txn.amount)}</span>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* Transaction basics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          ['Merchant', txn.merchantId.replace('merchant_', '')],
          ['Customer', txn.customerId],
          ['Failure Code', txn.failureCode ?? '—'],
          ['Retries', String(txn.retryCount)],
          ['Prior Successes', String(txn.priorSuccessCount)],
          ['Prior Failures', String(txn.priorFailureCount)],
          ['Returning?', txn.isReturningCustomer ? 'Yes' : 'No'],
          ['Opted Out?', txn.optedOutOfContact ? 'Yes ⚠' : 'No'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg bg-[#111827] border border-[#2a3a52] px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-sm text-slate-200 font-medium mt-0.5 truncate">{value}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      {txn.status === 'FAILED' && (
        <div className="flex flex-wrap gap-3">
          {!analysis && !processResult && (
            <button
              onClick={runAnalysis}
              disabled={loadingAnalysis || loadingProcess}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-[#1a2235] border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 text-sm font-medium transition-colors disabled:opacity-60"
            >
              {loadingAnalysis ? (
                <><RefreshCw size={14} className="animate-spin" /> Analyzing…</>
              ) : (
                <><Cpu size={14} /> Diagnose Only</>  
              )}
            </button>
          )}
          {!processResult && (
            <button
              onClick={runFullLoop}
              disabled={loadingAnalysis || loadingProcess}
              className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
            >
              {loadingProcess ? (
                <><RefreshCw size={14} className="animate-spin" /> Running full loop…</>
              ) : (
                <><Play size={14} /> Run Full Recovery Loop</>
              )}
            </button>
          )}
        </div>
      )}

      {/* Pipeline output */}
      {pipeline && (
        <div className="space-y-4">
          {/* ── Risk ── */}
          <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
            <div className="flex items-center gap-2 mb-4">
              <AlertTriangle size={16} className="text-orange-400" />
              <h3 className="text-sm font-semibold text-slate-200">Risk Assessment</h3>
              <span className={`ml-auto text-sm font-bold ${RISK_STYLES[pipeline.risk.riskLevel]}`}>
                {pipeline.risk.riskLevel} · {pipeline.risk.riskScore}/100
              </span>
            </div>
            <div className="space-y-2">
              {pipeline.risk.signals.map((s, i) => (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <div className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${SEVERITY_DOT[s.severity] ?? 'bg-slate-400'}`} />
                  <div>
                    <span className="text-slate-400 text-xs font-medium">{s.type.replace(/_/g, ' ')}</span>
                    <p className="text-slate-300">{s.description}</p>
                  </div>
                  <span className="ml-auto text-xs text-slate-500 flex-shrink-0">
                    {s.points > 0 ? `+${s.points}` : s.points}pts
                  </span>
                </div>
              ))}
              {!pipeline.risk.isActionable && (
                <div className="mt-2 text-xs text-orange-400 bg-orange-500/10 rounded-lg px-3 py-2">
                  ⚠ {pipeline.risk.blockerReason}
                </div>
              )}
            </div>
          </div>

          {/* ── AI Diagnosis ── */}
          <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
            <div className="flex items-center gap-2 mb-4">
              {pipeline.diagnosis.source === 'AI' ? (
                <Bot size={16} className="text-indigo-400" />
              ) : (
                <Wrench size={16} className="text-slate-400" />
              )}
              <h3 className="text-sm font-semibold text-slate-200">
                Diagnosis
                <span className={`ml-2 text-xs font-normal px-2 py-0.5 rounded-full ${
                  pipeline.diagnosis.source === 'AI'
                    ? 'bg-indigo-500/15 text-indigo-400'
                    : 'bg-slate-500/15 text-slate-400'
                }`}>
                  {pipeline.diagnosis.source}
                </span>
              </h3>
              <span className="ml-auto text-xs text-slate-400">
                {(pipeline.diagnosis.confidence * 100).toFixed(0)}% confidence
              </span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Root cause</span>
                <span className="text-slate-200 font-medium">{pipeline.diagnosis.rootCause.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Recoverability</span>
                <span className={`font-medium ${
                  pipeline.diagnosis.recoverability === 'HIGH' ? 'text-emerald-400'
                  : pipeline.diagnosis.recoverability === 'MEDIUM' ? 'text-yellow-400'
                  : 'text-red-400'
                }`}>{pipeline.diagnosis.recoverability}</span>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-[#1a2235] text-slate-300 text-xs leading-relaxed">
                {pipeline.diagnosis.reasoning}
              </div>
            </div>
          </div>

          {/* ── Strategy ── */}
          <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={16} className="text-yellow-400" />
              <h3 className="text-sm font-semibold text-slate-200">Recovery Strategy</h3>
              {pipeline.strategy.allowed ? (
                <CheckCircle size={14} className="ml-auto text-emerald-400" />
              ) : (
                <XCircle size={14} className="ml-auto text-red-400" />
              )}
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Recommended action</span>
                <span className="text-slate-200 font-semibold">{pipeline.strategy.strategy.replace(/_/g, ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Priority</span>
                <span className={`font-medium ${
                  pipeline.strategy.priority === 'URGENT' ? 'text-red-400'
                  : pipeline.strategy.priority === 'HIGH' ? 'text-orange-400'
                  : pipeline.strategy.priority === 'MEDIUM' ? 'text-yellow-400'
                  : 'text-slate-400'
                }`}>{pipeline.strategy.priority}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Est. recovery</span>
                <span className="text-emerald-400 font-semibold">{fmtINR(pipeline.strategy.estimatedRecoveryAmount)}</span>
              </div>
              <div className="mt-3 p-3 rounded-lg bg-[#1a2235] text-slate-300 text-xs leading-relaxed">
                {pipeline.strategy.reason}
              </div>
              {!pipeline.strategy.allowed && (
                <div className="p-3 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs">
                  ⚠ Blocked: {pipeline.strategy.blockerReason}
                </div>
              )}
              {!processResult && (
                <div className="mt-2 p-3 rounded-lg bg-slate-500/10 border border-slate-500/20 text-slate-400 text-xs">
                  <ShieldCheck size={12} className="inline mr-1.5" />
                  Click “Run Full Recovery Loop” to run guardrail checks and execute
                </div>
              )}
            </div>
          </div>

          {/* ── Guardrail + Execution (processResult) ── */}
          {processResult && (() => {
            const g = processResult.pipeline.guardrail;
            const ex = processResult.pipeline.execution;
            const DECISION_COLORS: Record<string, string> = {
              APPROVED: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
              ESCALATED: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
              BLOCKED:   'text-red-400 bg-red-500/10 border-red-500/20',
              NO_ACTION: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
            };
            const OUTCOME_COLORS: Record<string, string> = {
              SUCCEEDED: 'text-emerald-400',
              FAILED:    'text-red-400',
              ESCALATED: 'text-yellow-400',
              STOPPED:   'text-slate-400',
              NO_ACTION: 'text-slate-400',
            };
            return (
              <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck size={16} className="text-violet-400" />
                  <h3 className="text-sm font-semibold text-slate-200">Guardrail Decision</h3>
                  <span className={`ml-auto px-2.5 py-0.5 rounded-full text-xs font-semibold border ${
                    DECISION_COLORS[g.decision] ?? 'text-slate-400 bg-slate-500/10 border-slate-500/20'
                  }`}>
                    {g.decision}
                  </span>
                </div>

                {/* Flow diagram */}
                <div className="mb-4 flex flex-col gap-1 text-xs text-slate-400">
                  <div className="flex items-center gap-2">
                    <Bot size={12} className="text-indigo-400" />
                    <span>AI recommends: <span className="text-slate-200 font-medium">{processResult.pipeline.diagnosis.recommendedAction.replace(/_/g,' ')}</span></span>
                    <span className="ml-1 text-indigo-400">({(processResult.pipeline.diagnosis.confidence*100).toFixed(0)}% conf)</span>
                  </div>
                  <div className="pl-3 border-l border-[#2a3a52] ml-1.5 py-1">↓</div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={12} className="text-violet-400" />
                    <span className="font-medium text-slate-300">{g.checks.length} guardrail rules checked</span>
                  </div>
                  <div className="pl-3 border-l border-[#2a3a52] ml-1.5 py-1">↓</div>
                  <div className="flex items-center gap-2">
                    <Play size={12} className="text-emerald-400" />
                    <span>Final decision: <span className={`font-semibold ${
                      DECISION_COLORS[g.decision]?.split(' ')[0] ?? 'text-slate-300'
                    }`}>{g.decision}</span></span>
                    {g.allowed && <span className="text-slate-500">→ executed</span>}
                  </div>
                </div>

                {/* Guardrail checks table */}
                <div className="space-y-1.5 mb-4">
                  {g.checks.map((c, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      {c.passed
                        ? <CheckCircle size={12} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                        : <XCircle size={12} className="text-red-400 mt-0.5 flex-shrink-0" />}
                      <span className="text-slate-500 w-36 flex-shrink-0 font-mono">{c.rule}</span>
                      <span className={c.passed ? 'text-slate-400' : 'text-red-300'}>{c.detail}</span>
                    </div>
                  ))}
                </div>

                {/* Execution outcome */}
                <div className="border-t border-[#2a3a52] pt-4">
                  <p className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Execution Outcome</p>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Action</span>
                    <span className="text-slate-200 font-medium">{ex.action.replace(/_/g,' ')}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm mt-1">
                    <span className="text-slate-400">Status</span>
                    <span className={`font-semibold ${
                      OUTCOME_COLORS[ex.status] ?? 'text-slate-400'
                    }`}>{ex.status}</span>
                  </div>
                  {ex.amountRecovered > 0 && (
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-slate-400">Recovered</span>
                      <span className="text-emerald-400 font-bold">{fmtINR(ex.amountRecovered)}</span>
                    </div>
                  )}
                  <div className="mt-3 p-3 rounded-lg bg-[#1a2235] text-slate-300 text-xs leading-relaxed">
                    {ex.outcomeReason}
                  </div>
                  <div className="mt-2 text-xs text-slate-600 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-600 inline-block" />
                    Simulated — demo mode
                  </div>
                </div>
              </div>
            );
          })()}

          {/* ── Audit log ── */}
          {txn.auditLogs && txn.auditLogs.length > 0 && (
            <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
              <div className="flex items-center gap-2 mb-4">
                <Clock size={16} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-200">Audit Timeline</h3>
                <span className="ml-auto text-xs text-slate-500">{txn.auditLogs.length} events</span>
              </div>
              <div className="space-y-3">
                {txn.auditLogs.map((log, i) => (
                  <div key={log.id} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div className="w-2 h-2 rounded-full bg-indigo-500 mt-1.5 flex-shrink-0" />
                      {i < txn.auditLogs!.length - 1 && (
                        <div className="w-px flex-1 bg-[#2a3a52] mt-1" />
                      )}
                    </div>
                    <div className="pb-3">
                      <p className="text-xs text-slate-500 font-medium">{log.eventType.replace(/_/g, ' ')} · {fmtDate(log.createdAt)}</p>
                      <p className="text-sm text-slate-300 mt-0.5">{log.summary}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page router ──────────────────────────────────────────────────────────────

export function TransactionsPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();

  if (id) return <TransactionDetail id={id} />;
  return <TransactionList key={location.search} />;
}
