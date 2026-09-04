/**
 * Dashboard Page — populated from latest simulation run + live risk summary.
 * Displays metric cards, recovery funnel, analytical charts, activity feed, and guardrail policy.
 */
import { useState, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts';
import {
  TrendingUp, AlertTriangle, ShieldCheck, Zap, Play,
  RefreshCw, Activity, CheckCircle, Clock
} from 'lucide-react';
import {
  getLatestSimulation, getFullRiskSummary,
  type SimulationRun, type RiskSummaryFull
} from '../api';
import { useNavigate } from 'react-router-dom';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return '₹' + n.toLocaleString('en-IN');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

// ─── Top Metric Card ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon: Icon, border }: {
  label: string; value: string; sub: string; color: string;
  icon: React.ElementType; border: string;
}) {
  return (
    <div className={`rounded-2xl bg-[#111827] border ${border} p-5 flex items-start gap-4`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color.replace('text-','bg-').replace('400','500/10')}`}>
        <Icon size={18} className={color} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value}</p>
        <p className="text-xs text-slate-500 mt-0.5 truncate">{sub}</p>
      </div>
    </div>
  );
}

// ─── Recovery Funnel (compact) ─────────────────────────────────────────────────

function MiniVizFunnel({ data }: { data: { label: string; value: number; amount?: number }[] }) {
  const max = data[0]?.value || 1;
  const COLORS = ['#ef4444','#f97316','#eab308','#6366f1','#10b981'];
  return (
    <div className="space-y-2">
      {data.map((step, i) => (
        <div key={step.label} className="flex items-center gap-3">
          <div className="w-24 text-right text-xs text-slate-500 flex-shrink-0">{step.label}</div>
          <div className="flex-1 h-6 bg-[#0a0d14] rounded overflow-hidden">
            <div
              className="h-full rounded transition-all duration-700"
              style={{ width: `${(step.value / max) * 100}%`, backgroundColor: COLORS[i] + '60', borderRight: `2px solid ${COLORS[i]}` }}
            />
          </div>
          <div className="text-xs text-slate-300 w-16 text-right font-medium flex-shrink-0">
            {step.value.toLocaleString()}
          </div>
          {step.amount != null && (
            <div className="text-xs text-slate-500 w-20 text-right flex-shrink-0">
              {fmtINR(Math.round(step.amount))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Activity feed ────────────────────────────────────────────────────────────

interface FeedItem { label: string; value: string; color: string }

function buildFeed(run: SimulationRun): FeedItem[] {
  const a = run.aggregates;
  return [
    { label: 'Batch run completed',              value: fmtDate(run.completedAt),          color: 'bg-emerald-500' },
    { label: `${a.atRiskCount} at-risk detected`,value: fmtINR(a.atRiskAmount),            color: 'bg-red-500' },
    { label: `${a.approvedCount} actions approved`, value: 'guardrail passed',             color: 'bg-indigo-500' },
    { label: `${a.escalatedCount} escalated`,    value: 'human review needed',             color: 'bg-yellow-500' },
    { label: `${a.stoppedCount} blocked`,        value: 'retry cap / opt-out',             color: 'bg-slate-500' },
    { label: `${a.recoveredCount} recovered`,    value: fmtINR(a.recoveredAmount),         color: 'bg-emerald-500' },
    { label: `Recovery rate`,                    value: `${a.recoveryRate}%`,              color: 'bg-violet-500' },
  ];
}

// ─── Recharts custom tooltip ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a2235] border border-[#2a3a52] rounded-lg px-3 py-2 text-xs">
      <p className="text-slate-300 font-medium mb-1">{label}</p>
      {payload.map((p: { name: string; value: number; fill: string }, i: number) => (
        <p key={i} style={{ color: p.fill }}>{p.name}: {p.value.toLocaleString()}</p>
      ))}
    </div>
  );
}

// ─── Dashboard Page ───────────────────────────────────────────────────────────

export function DashboardPage() {
  const navigate = useNavigate();
  const [run, setRun] = useState<SimulationRun | null>(null);
  const [riskSummary, setRiskSummary] = useState<RiskSummaryFull | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getLatestSimulation().catch(() => null),
      getFullRiskSummary().catch(() => null),
    ]).then(([simRun, risk]) => {
      setRun(simRun);
      setRiskSummary(risk);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        {[1,2,3].map(i => <div key={i} className="h-32 rounded-2xl bg-[#111827]" />)}
      </div>
    );
  }

  // No simulation run yet
  if (!run) {
    return (
      <div className="flex flex-col items-center justify-center min-h-96 gap-5">
        <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
          <Play size={28} className="text-indigo-400" />
        </div>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-slate-100">No simulation data yet</h3>
          <p className="text-sm text-slate-400 mt-1">Run a batch simulation to populate the dashboard with real computed numbers.</p>
        </div>
        <button
          onClick={() => navigate('/simulation')}
          className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors"
        >
          Go to Simulation →
        </button>
      </div>
    );
  }

  const a = run.aggregates;

  // Risk level distribution for bar chart (from risk summary)
  const riskChartData = riskSummary?.byRiskLevel
    ? Object.entries(riskSummary.byRiskLevel).map(([level, val]) => ({
        level,
        count: typeof val === 'object' ? val.count : (val as number),
      }))
    : [];

  // Recovery by outcome for pie chart
  const outcomeData = [
    { name: 'Recovered',  value: a.recoveredCount,  fill: '#10b981' },
    { name: 'Escalated',  value: a.escalatedCount,  fill: '#eab308' },
    { name: 'Stopped',    value: a.stoppedCount,    fill: '#64748b' },
    { name: 'Exec Failed',value: a.executedCount - a.recoveredCount > 0 ? a.executedCount - a.recoveredCount : 0, fill: '#ef4444' },
  ].filter(d => d.value > 0);

  const RISK_COLORS: Record<string, string> = {
    LOW:      '#64748b',
    MEDIUM:   '#eab308',
    HIGH:     '#f97316',
    CRITICAL: '#ef4444',
  };

  const feed = buildFeed(run);

  return (
    <div className="space-y-6 fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Revenue Recovery Dashboard</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Populated from latest batch run · {fmtDate(run.completedAt)} · {run.durationSeconds}s
          </p>
        </div>
        <button
          onClick={() => navigate('/simulation')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#1a2235] border border-[#2a3a52] text-slate-400 hover:text-slate-200 text-xs transition-colors"
        >
          <RefreshCw size={12} /> Re-run simulation
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Revenue at Risk"
          value={fmtINR(a.atRiskAmount)}
          sub={`${a.atRiskCount.toLocaleString()} failed transactions`}
          color="text-red-400"
          icon={AlertTriangle}
          border="border-red-500/20"
        />
        <KpiCard
          label="Revenue Recovered"
          value={fmtINR(a.recoveredAmount)}
          sub={`${a.recoveredCount} successful recoveries`}
          color="text-emerald-400"
          icon={TrendingUp}
          border="border-emerald-500/20"
        />
        <KpiCard
          label="Recovery Rate"
          value={`${a.recoveryRate}%`}
          sub="of at-risk transactions"
          color="text-indigo-400"
          icon={Zap}
          border="border-indigo-500/20"
        />
        <KpiCard
          label="Actions Executed"
          value={a.executedCount.toLocaleString()}
          sub={`${a.escalatedCount} escalated · ${a.stoppedCount} stopped`}
          color="text-slate-100"
          icon={CheckCircle}
          border="border-[#2a3a52]"
        />
      </div>

      {/* Funnel + Outcome pie */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp size={16} className="text-indigo-400" />
            <h3 className="text-sm font-semibold text-slate-200">Recovery Funnel</h3>
          </div>
          <MiniVizFunnel data={run.funnelData as { label: string; value: number; amount?: number }[]} />
        </div>

        <div className="lg:col-span-2 rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-violet-400" />
            <h3 className="text-sm font-semibold text-slate-200">Outcome Distribution</h3>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={outcomeData}
                cx="50%"
                cy="50%"
                innerRadius={45}
                outerRadius={75}
                paddingAngle={3}
                dataKey="value"
              >
                {outcomeData.map((entry, i) => (
                  <Cell key={i} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                formatter={(value) => <span className="text-xs text-slate-400">{value}</span>}
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Risk distribution bar chart + Activity feed */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={16} className="text-orange-400" />
            <h3 className="text-sm font-semibold text-slate-200">Risk Level Distribution</h3>
            {riskSummary && (
              <span className="ml-auto text-xs text-slate-500">{riskSummary.total} total transactions</span>
            )}
          </div>
          {riskChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={riskChartData} barCategoryGap="30%">
                <XAxis dataKey="level" tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#64748b', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" name="Transactions" radius={[4,4,0,0]}>
                  {riskChartData.map((entry, i) => (
                    <Cell key={i} fill={RISK_COLORS[entry.level] ?? '#6366f1'} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
              Run simulation to populate chart
            </div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={16} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-200">Activity Feed</h3>
          </div>
          <div className="space-y-3">
            {feed.map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${item.color}`} />
                <div className="min-w-0">
                  <p className="text-xs text-slate-300 truncate">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Guardrail policy summary */}
      <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck size={16} className="text-violet-400" />
          <h3 className="text-sm font-semibold text-slate-200">Guardrail Policy (read-only)</h3>
          <span className="ml-auto text-xs text-slate-500 bg-[#1a2235] px-2 py-0.5 rounded-full border border-[#2a3a52]">
            Applied to this run
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              tier: 'Auto-execute',
              condition: 'Amount < ₹5,000 AND confidence > 70% AND retries < 2',
              action: 'Execute immediately, no human needed',
              color: 'border-emerald-500/20 bg-emerald-500/5',
              badge: 'bg-emerald-500/20 text-emerald-400',
            },
            {
              tier: 'Escalate',
              condition: 'Amount ₹5,000–₹25,000 OR confidence < 70%',
              action: 'Routed to human review queue',
              color: 'border-yellow-500/20 bg-yellow-500/5',
              badge: 'bg-yellow-500/20 text-yellow-400',
            },
            {
              tier: 'Manual only',
              condition: 'Amount > ₹25,000 (hard ceiling)',
              action: 'Never auto-executed, always requires human sign-off',
              color: 'border-red-500/20 bg-red-500/5',
              badge: 'bg-red-500/20 text-red-400',
            },
          ].map(tier => (
            <div key={tier.tier} className={`rounded-xl border ${tier.color} p-4`}>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${tier.badge}`}>
                {tier.tier}
              </span>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">{tier.condition}</p>
              <p className="text-xs text-slate-500 mt-2 italic">{tier.action}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-slate-600 mt-3 flex items-center gap-1.5">
          <Clock size={11} />
          Also enforced: max 2 retries per transaction · opt-out always blocks all contact
        </p>
      </div>
    </div>
  );
}
