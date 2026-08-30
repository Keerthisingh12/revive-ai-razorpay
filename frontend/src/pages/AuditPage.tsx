/**
 * Audit Trail Page — filterable, paginated view of all AuditLog records.
 * Every row traces back to a real pipeline event (Day 3 or Day 4).
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, Search, Filter, ChevronRight, RefreshCw, ExternalLink } from 'lucide-react';
import { getAuditLogs, type AuditLogEntry, type AuditFilters } from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  return '₹' + n.toLocaleString('en-IN');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

const EVENT_STYLES: Record<string, string> = {
  RISK_DETECTED:     'bg-orange-500/15 text-orange-400 border-orange-500/30',
  AI_DIAGNOSIS:      'bg-indigo-500/15 text-indigo-400 border-indigo-500/30',
  AI_RECOMMENDATION: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  GUARDRAIL_CHECK:   'bg-violet-500/15 text-violet-400 border-violet-500/30',
  ACTION_EXECUTED:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  OUTCOME_RECORDED:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  HUMAN_APPROVED:    'bg-green-500/15 text-green-400 border-green-500/30',
  HUMAN_REJECTED:    'bg-red-500/15 text-red-400 border-red-500/30',
  HUMAN_STOPPED:     'bg-slate-500/15 text-slate-400 border-slate-500/30',
};

const EVENT_TYPES = [
  '', 'RISK_DETECTED', 'AI_DIAGNOSIS', 'AI_RECOMMENDATION',
  'GUARDRAIL_CHECK', 'ACTION_EXECUTED', 'OUTCOME_RECORDED',
  'HUMAN_APPROVED', 'HUMAN_REJECTED', 'HUMAN_STOPPED',
];

// ─── AuditPage ────────────────────────────────────────────────────────────────

export function AuditPage() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<AuditFilters>({ limit: 50, page: 1 });
  const [search, setSearch] = useState('');
  const [txnFilter, setTxnFilter] = useState('');
  const [eventFilter, setEventFilter] = useState('');

  const load = useCallback((f: AuditFilters) => {
    setLoading(true);
    getAuditLogs(f)
      .then(res => {
        setLogs(res.data);
        setPagination({ page: res.pagination.page, totalPages: res.pagination.totalPages, total: res.pagination.total });
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(filters); }, []);  // eslint-disable-line

  const applyFilters = () => {
    const f: AuditFilters = { limit: 50, page: 1 };
    if (search)      f.search    = search;
    if (txnFilter)   f.txnId     = txnFilter;
    if (eventFilter) f.eventType = eventFilter;
    setFilters(f);
    load(f);
  };

  const changePage = (p: number) => {
    const f = { ...filters, page: p };
    setFilters(f);
    load(f);
  };

  const clearFilters = () => {
    setSearch(''); setTxnFilter(''); setEventFilter('');
    const f = { limit: 50, page: 1 };
    setFilters(f); load(f);
  };

  return (
    <div className="space-y-5 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Audit Trail</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {pagination.total.toLocaleString()} pipeline events — every row from a real execution
          </p>
        </div>
        <button onClick={() => load(filters)} className="p-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Filters */}
      <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-4">
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              id="audit-search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && applyFilters()}
              placeholder="Search summaries…"
              className="w-full pl-8 pr-3 py-2 bg-[#0a0d14] border border-[#2a3a52] rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
            />
          </div>
          <input
            id="audit-txn-filter"
            value={txnFilter}
            onChange={e => setTxnFilter(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            placeholder="Transaction ID…"
            className="w-48 px-3 py-2 bg-[#0a0d14] border border-[#2a3a52] rounded-lg text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500/50"
          />
          <select
            id="audit-event-filter"
            value={eventFilter}
            onChange={e => setEventFilter(e.target.value)}
            className="px-3 py-2 bg-[#0a0d14] border border-[#2a3a52] rounded-lg text-sm text-slate-200 focus:outline-none focus:border-indigo-500/50"
          >
            <option value="">All event types</option>
            {EVENT_TYPES.filter(Boolean).map(t => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <button
            id="audit-apply-btn"
            onClick={applyFilters}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
          >
            <Filter size={13} /> Apply
          </button>
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200 text-sm transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Log list */}
      {loading ? (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-[#111827]" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-12 text-center">
          <Clock size={28} className="text-slate-600 mx-auto mb-3" />
          <p className="text-slate-400">No audit records match the current filters.</p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#111827] border border-[#2a3a52] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#2a3a52]">
                {['Timestamp', 'Event', 'Transaction', 'Summary', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wide">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a2235]">
              {logs.map(log => (
                <tr key={log.id} className="hover:bg-[#1a2235] transition-colors">
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {fmtDate(log.createdAt)}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${EVENT_STYLES[log.eventType] ?? 'bg-slate-500/15 text-slate-400 border-slate-500/30'}`}>
                      {log.eventType.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs text-slate-300">{log.transactionId.slice(0, 20)}…</div>
                    {log.transaction && (
                      <div className="text-xs text-slate-500 mt-0.5">
                        {fmtINR(log.transaction.amount)} · {log.transaction.failureCode ?? '—'}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-300 max-w-xs">
                    <span className="line-clamp-2">{log.summary}</span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/transactions/${log.transactionId}`)}
                      className="p-1.5 rounded-lg hover:bg-[#2a3a52] text-slate-500 hover:text-slate-300 transition-colors"
                      title="View transaction"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={pagination.page <= 1}
            onClick={() => changePage(pagination.page - 1)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-sm disabled:opacity-40 hover:text-slate-200 transition-colors"
          >
            Prev
          </button>
          <span className="text-xs text-slate-400">
            Page {pagination.page} / {pagination.totalPages} · {pagination.total.toLocaleString()} total
          </span>
          <button
            disabled={pagination.page >= pagination.totalPages}
            onClick={() => changePage(pagination.page + 1)}
            className="px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-sm disabled:opacity-40 hover:text-slate-200 transition-colors flex items-center gap-1"
          >
            Next <ChevronRight size={13} />
          </button>
        </div>
      )}
    </div>
  );
}
