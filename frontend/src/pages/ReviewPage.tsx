/**
 * Human Review Queue — list of ESCALATED transactions with Approve / Reject / Stop actions.
 * Each action calls the real backend executor and writes audit records.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  CheckCircle, XCircle, StopCircle, AlertTriangle,
  ShieldCheck, RefreshCw, Clock
} from 'lucide-react';
import {
  getReviewQueue, approveReview, rejectReview, stopReview,
  type ReviewRecord
} from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return '₹' + n.toLocaleString('en-IN');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

const RISK_COLOR: Record<string, string> = {
  LOW:      'text-slate-400',
  MEDIUM:   'text-yellow-400',
  HIGH:     'text-orange-400',
  CRITICAL: 'text-red-400',
};

// ─── Row component ────────────────────────────────────────────────────────────

function ReviewRow({
  record,
  onAction,
}: {
  record: ReviewRecord;
  onAction: (txnId: string, action: 'approve' | 'reject' | 'stop') => Promise<void>;
}) {
  const [busy, setBusy] = useState<'approve' | 'reject' | 'stop' | null>(null);
  const [done, setDone] = useState<{ action: string; outcome: string; amountRecovered?: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handle = async (action: 'approve' | 'reject' | 'stop') => {
    setBusy(action);
    setError(null);
    try {
      await onAction(record.transactionId, action);
      setDone({ action, outcome: action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'STOPPED' });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (done) {
    const DONE_STYLES: Record<string, string> = {
      approve: 'bg-emerald-500/10 border-emerald-500/20',
      reject:  'bg-red-500/10 border-red-500/20',
      stop:    'bg-slate-500/10 border-slate-500/20',
    };
    const DONE_TEXT: Record<string, string> = {
      approve: 'text-emerald-400',
      reject:  'text-red-400',
      stop:    'text-slate-400',
    };
    return (
      <div className={`rounded-xl border p-4 flex items-center gap-3 ${DONE_STYLES[done.action]}`}>
        <CheckCircle size={16} className={DONE_TEXT[done.action]} />
        <span className={`text-sm font-medium ${DONE_TEXT[done.action]}`}>
          {done.outcome} — {record.transactionId.slice(0, 24)}
        </span>
        <span className="text-xs text-slate-500 ml-auto">{fmtDate(record.executedAt)}</span>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
      {/* Top row */}
      <div className="flex items-start gap-4 mb-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-slate-300">{record.transactionId}</span>
            <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
              ESCALATED
            </span>
          </div>
          {record.transaction && (
            <div className="flex items-center gap-3 mt-1 text-sm">
              <span className="font-bold text-slate-100">{fmtINR(record.transaction.amount)}</span>
              <span className="text-slate-500">{record.transaction.failureCode ?? '—'}</span>
              <span className="text-slate-500 truncate">{record.transaction.customerEmail}</span>
            </div>
          )}
        </div>
        {record.risk && (
          <div className="text-right flex-shrink-0">
            <p className={`text-sm font-bold ${RISK_COLOR[record.risk.riskLevel] ?? 'text-slate-400'}`}>
              {record.risk.riskLevel}
            </p>
            <p className="text-xs text-slate-500">{record.risk.riskScore}/100</p>
          </div>
        )}
      </div>

      {/* AI decision + guardrail reason */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        {record.agentDecision ? (
          <div className="bg-[#0a0d14] rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1 font-medium">AI Recommendation</p>
            <p className="text-sm text-slate-200 font-medium">
              {record.agentDecision.recommendedAction.replace(/_/g, ' ')}
            </p>
            <p className="text-xs text-indigo-400 mt-0.5">
              {(record.agentDecision.confidence * 100).toFixed(0)}% confidence
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">{record.agentDecision.diagnosis}</p>
          </div>
        ) : (
          <div className="bg-[#0a0d14] rounded-lg p-3">
            <p className="text-xs text-slate-500 mb-1 font-medium">AI Recommendation</p>
            <p className="text-sm text-slate-500 italic">Not available — processed via batch run</p>
          </div>
        )}

        <div className="bg-[#0a0d14] rounded-lg p-3">
          <p className="text-xs text-slate-500 mb-1 font-medium flex items-center gap-1">
            <ShieldCheck size={11} /> Guardrail reason
          </p>
          <p className="text-sm text-yellow-400 font-medium">
            {record.agentDecision?.guardrailReason ?? record.outcomeReason ?? 'ESCALATED by policy'}
          </p>
          {record.agentDecision?.guardrailChecks && (
            <div className="mt-2 space-y-1">
              {(record.agentDecision.guardrailChecks as Array<{ rule: string; passed: boolean; detail: string }>)
                .filter(c => !c.passed)
                .map((c, i) => (
                  <div key={i} className="text-xs text-red-400 flex items-center gap-1.5">
                    <XCircle size={10} />
                    <span>{c.rule}: {c.detail}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-xs">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 flex-wrap">
        <button
          id={`approve-${record.transactionId}`}
          onClick={() => handle('approve')}
          disabled={!!busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          {busy === 'approve'
            ? <RefreshCw size={13} className="animate-spin" />
            : <CheckCircle size={13} />}
          Approve
        </button>
        <button
          id={`reject-${record.transactionId}`}
          onClick={() => handle('reject')}
          disabled={!!busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600/80 hover:bg-red-600 text-white text-sm font-medium transition-colors disabled:opacity-60"
        >
          {busy === 'reject'
            ? <RefreshCw size={13} className="animate-spin" />
            : <XCircle size={13} />}
          Reject
        </button>
        <button
          id={`stop-${record.transactionId}`}
          onClick={() => handle('stop')}
          disabled={!!busy}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-300 hover:text-slate-100 text-sm font-medium transition-colors disabled:opacity-60"
        >
          {busy === 'stop'
            ? <RefreshCw size={13} className="animate-spin" />
            : <StopCircle size={13} />}
          Stop
        </button>
        <span className="ml-auto text-xs text-slate-600 self-center">
          Escalated {fmtDate(record.executedAt)}
        </span>
      </div>
    </div>
  );
}

// ─── ReviewPage ───────────────────────────────────────────────────────────────

export function ReviewPage() {
  const [records, setRecords] = useState<ReviewRecord[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const load = useCallback((p: number) => {
    setLoading(true);
    getReviewQueue(p, 20)
      .then(res => {
        setRecords(res.data);
        setPagination({ page: res.pagination.page, totalPages: res.pagination.totalPages, total: res.pagination.total });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(page); }, [page]); // eslint-disable-line

  const handleAction = async (txnId: string, action: 'approve' | 'reject' | 'stop') => {
    if (action === 'approve') await approveReview(txnId);
    else if (action === 'reject') await rejectReview(txnId);
    else await stopReview(txnId);
    // Don't reload — the row self-updates to "done" state
    // Refresh total count after a moment
    setTimeout(() => load(page), 500);
  };

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Human Review Queue</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {pagination.total} escalated transactions awaiting review
          </p>
        </div>
        <button
          onClick={() => load(page)}
          className="p-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Context note */}
      <div className="p-4 rounded-xl bg-[#111827] border border-yellow-500/20 flex items-start gap-3">
        <AlertTriangle size={15} className="text-yellow-400 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-slate-400 leading-relaxed">
          These transactions were escalated by the guardrail engine — amount ≥ ₹5,000, confidence below threshold,
          or other policy trigger. Every action here writes a real audit record.{' '}
          <strong className="text-slate-300">Approve</strong> runs the recovery executor.{' '}
          <strong className="text-slate-300">Reject</strong> or <strong className="text-slate-300">Stop</strong> records
          the decision with no recovery action taken.
        </p>
      </div>

      {/* Records */}
      {loading ? (
        <div className="space-y-3 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-44 rounded-xl bg-[#111827]" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-16 flex flex-col items-center gap-3">
          <Clock size={28} className="text-slate-600" />
          <p className="text-slate-400">No escalated transactions on this page.</p>
          <p className="text-xs text-slate-600">Run a simulation to generate escalated cases for review.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {records.map(r => (
            <ReviewRow key={r.id} record={r} onAction={handleAction} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-sm disabled:opacity-40 hover:text-slate-200 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {pagination.page} / {pagination.totalPages} · {pagination.total} total
          </span>
          <button
            disabled={page >= pagination.totalPages}
            onClick={() => setPage(p => p + 1)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-sm disabled:opacity-40 hover:text-slate-200 transition-colors"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
