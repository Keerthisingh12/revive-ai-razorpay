/**
 * Simulation Page — Run Batch Recovery
 * Day 4: staged progress animation + full results screen with funnel.
 */
import { useState, useEffect } from 'react';
import {
  Play, RefreshCw, CheckCircle, Zap, ShieldCheck, TrendingUp,
  Clock, BarChart2, AlertTriangle, ChevronRight
} from 'lucide-react';
import {
  runSimulation, getLatestSimulation,
  type SimulationRun, type SimulationRunResult,
  getBaselineComparison, type BaselineComparisonResult,
} from '../api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtINR(n: number) {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)}Cr`;
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)}L`;
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}K`;
  return '₹' + n.toLocaleString('en-IN');
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

// ─── Staged progress steps ─────────────────────────────────────────────────────

const STAGES = [
  { id: 'risk',      label: 'Detecting revenue risk across 2,000 transactions',    icon: AlertTriangle,  durationMs: 800  },
  { id: 'diagnose',  label: 'Running deterministic failure diagnosis',              icon: Zap,            durationMs: 700  },
  { id: 'guardrail', label: 'Applying guardrail rules (amount, retries, confidence)',icon: ShieldCheck,    durationMs: 600  },
  { id: 'execute',   label: 'Executing approved recovery actions',                  icon: Play,           durationMs: 500  },
  { id: 'results',   label: 'Calculating recovery metrics and funnel',              icon: BarChart2,      durationMs: 400  },
];

// ─── Recovery Funnel component ─────────────────────────────────────────────────

function RecoveryFunnel({ data, atRiskAmount, recoveredAmount }: {
  data: { label: string; value: number; amount?: number }[];
  atRiskAmount: number;
  recoveredAmount: number;
}) {
  const max = data[0]?.value || 1;
  const COLORS = [
    'from-red-500/40 to-red-600/20 border-red-500/30',
    'from-orange-500/40 to-orange-600/20 border-orange-500/30',
    'from-yellow-500/40 to-yellow-600/20 border-yellow-500/30',
    'from-blue-500/40 to-blue-600/20 border-blue-500/30',
    'from-emerald-500/40 to-emerald-600/20 border-emerald-500/30',
  ];

  return (
    <div className="space-y-2">
      {data.map((step, i) => {
        const pct = (step.value / max) * 100;
        return (
          <div key={step.label}>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-400">{step.label}</span>
              <div className="flex items-center gap-3">
                {step.amount != null && (
                  <span className="text-slate-500">{fmtINR(Math.round(step.amount))}</span>
                )}
                <span className="text-slate-200 font-semibold w-14 text-right">
                  {step.value.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="h-8 w-full rounded-lg bg-[#0a0d14] overflow-hidden">
              <div
                className={`h-full rounded-lg bg-gradient-to-r ${COLORS[i] ?? COLORS[4]} border transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
            {i < data.length - 1 && (
              <div className="flex justify-start pl-4 py-0.5">
                <ChevronRight size={12} className="text-slate-600 rotate-90" />
              </div>
            )}
          </div>
        );
      })}

      {/* Summary bar */}
      <div className="mt-4 pt-4 border-t border-[#2a3a52] grid grid-cols-2 gap-4">
        <div className="text-center">
          <p className="text-xs text-slate-500">Total at risk</p>
          <p className="text-lg font-bold text-red-400">{fmtINR(Math.round(atRiskAmount))}</p>
        </div>
        <div className="text-center">
          <p className="text-xs text-slate-500">Recovered</p>
          <p className="text-lg font-bold text-emerald-400">{fmtINR(Math.round(recoveredAmount))}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color: string;
}) {
  return (
    <div className="rounded-xl bg-[#111827] border border-[#2a3a52] p-5">
      <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Baseline Comparison Panel (self-contained) ──────────────────────────────
// Uses its own useState/useEffect — does NOT read or mutate SimulationPage state.

function BaselineComparisonPanel() {
  const [data, setData] = useState<BaselineComparisonResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getBaselineComparison()
      .then(setData)
      .catch(() => setError('Could not load comparison — run a simulation first.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-6 animate-pulse">
        <div className="h-4 bg-[#1a2235] rounded w-48 mb-4" />
        <div className="h-24 bg-[#1a2235] rounded" />
      </div>
    );
  }

  if (error || !data) {
    return null;
  }

  // ReviveAI column may be null if no simulation run exists yet
  if (!data.reviveai) {
    return null;
  }

  const b = data.baseline;
  const r = data.reviveai;
  const s = data.safety;
  const addl = data.additionalRevenueRecovered;

  return (
    <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-6 space-y-5">
      {/* Header */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200">Baseline vs ReviveAI</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Naive "retry everything once" vs guardrailed pipeline — same 2,000-transaction dataset.
        </p>
      </div>

      {/* Comparison table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#2a3a52]">
              <th className="text-left text-xs font-medium text-slate-500 pb-2">Metric</th>
              <th className="text-right text-xs font-medium text-slate-500 pb-2 pr-4">Baseline</th>
              <th className="text-right text-xs font-medium text-indigo-400 pb-2">ReviveAI</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1a2235]">
            <tr>
              <td className="py-2 text-slate-400 text-xs">Recovered (₹)</td>
              <td className="py-2 text-right pr-4 text-slate-300 font-medium">{fmtINR(b.recoveredAmount)}</td>
              <td className="py-2 text-right text-indigo-300 font-medium">{fmtINR(r.recoveredAmount)}</td>
            </tr>
            <tr>
              <td className="py-2 text-slate-400 text-xs">Recovery rate</td>
              <td className="py-2 text-right pr-4 text-slate-300 font-medium">{b.recoveryRate}%</td>
              <td className="py-2 text-right text-indigo-300 font-medium">{r.recoveryRate}%</td>
            </tr>
            <tr>
              <td className="py-2 text-slate-400 text-xs">Actions taken</td>
              <td className="py-2 text-right pr-4 text-slate-300 font-medium">{b.actionsCount.toLocaleString()}</td>
              <td className="py-2 text-right text-indigo-300 font-medium">{r.actionsCount.toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Additional revenue note */}
      {addl !== null && (
        <p className="text-xs text-slate-400">
          <span className="font-semibold text-slate-200">→</span>{' '}
          {addl >= 0
            ? <>{fmtINR(addl)} additional revenue recovered by ReviveAI over baseline.</>
            : <>ReviveAI recovered {fmtINR(Math.abs(addl))} less than the naive baseline in raw ₹ — its advantage is <span className="text-yellow-400 font-semibold">safety</span>, not volume (see below).</>}
        </p>
      )}

      {/* Safety section */}
      <div className="border-t border-[#2a3a52] pt-4 space-y-3">
        <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Safety</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-[#0a0d14] rounded-lg p-3">
            <p className="text-xs text-slate-500">Baseline risky actions</p>
            <p className="text-xl font-bold text-orange-400 mt-0.5">{s.baselineRiskyActions.toLocaleString()}</p>
            <p className="text-xs text-slate-600 mt-0.5">no safety checks applied</p>
          </div>
          <div className="bg-[#0a0d14] rounded-lg p-3">
            <p className="text-xs text-slate-500">ReviveAI prevented</p>
            <p className="text-xl font-bold text-emerald-400 mt-0.5">{s.preventedTransactionCount.toLocaleString()} transactions</p>
            <p className="text-xs text-slate-600 mt-0.5">blocked by guardrail engine</p>
          </div>
        </div>

        {/* byRule breakdown */}
        {Object.keys(s.byRule).length > 0 && (
          <div className="space-y-1.5">
            {Object.entries(s.byRule)
              .sort(([, a], [, b]) => b - a)
              .map(([rule, count]) => (
                <div key={rule} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500 font-mono">{rule}</span>
                  <span className="text-slate-300 font-semibold tabular-nums">{count}</span>
                </div>
              ))}
          </div>
        )}

        <p className="text-xs text-slate-600 italic">
          Each prevented transaction is blocked by exactly one rule in this system, so these numbers add up to the total above.
        </p>
      </div>

      {/* Strategy effectiveness table */}
      {data.strategyEffectiveness && (
        <div className="border-t border-[#2a3a52] pt-4 space-y-3">
          <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wide">Strategy Effectiveness</h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[#1a2235]">
                  {['Failure Code', 'Action', 'Outcome', 'Count'].map(h => (
                    <th key={h} className="text-left text-slate-500 pb-1.5 pr-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#0a0d14]">
                {data.strategyEffectiveness.data.slice(0, 12).map((row, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3 text-slate-400 font-mono">{row.failureCode ?? '—'}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{row.action}</td>
                    <td className="py-1.5 pr-3">
                      <span className={`px-1.5 py-0.5 rounded text-xs ${
                        row.outcome === 'RECOVERED' ? 'bg-emerald-500/15 text-emerald-400' :
                        row.outcome === 'ESCALATED' ? 'bg-yellow-500/15 text-yellow-400' :
                        row.outcome === 'STOPPED'   ? 'bg-slate-500/15 text-slate-400' :
                        'bg-red-500/15 text-red-400'
                      }`}>{row.outcome}</span>
                    </td>
                    <td className="py-1.5 tabular-nums text-slate-200 font-medium">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600 italic leading-relaxed">
            {data.strategyEffectiveness.caveat}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Simulation Page ──────────────────────────────────────────────────────────

export function SimulationPage() {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [currentStage, setCurrentStage] = useState(-1);
  const [completedStages, setCompletedStages] = useState<Set<number>>(new Set());
  const [result, setResult] = useState<SimulationRun | null>(null);
  const [prevRun, setPrevRun] = useState<SimulationRun | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load latest run on mount
  useEffect(() => {
    getLatestSimulation()
      .then(run => {
        setPrevRun(run);
        setResult(run);
        setPhase('done');
      })
      .catch(() => {/* no prior run */});
  }, []);

  const startRun = async () => {
    setPhase('running');
    setCurrentStage(0);
    setCompletedStages(new Set());
    setError(null);

    // Animate stages while API call runs in background
    const apiPromise = runSimulation();

    // Step through UI stages with delays
    for (let i = 0; i < STAGES.length; i++) {
      setCurrentStage(i);
      await new Promise(r => setTimeout(r, STAGES[i].durationMs));
      setCompletedStages(prev => new Set([...prev, i]));
    }

    // Await actual result
    try {
      const res = await apiPromise;
      setResult(res);
      setPhase('done');
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  };

  const reset = () => {
    setPhase('idle');
    setCurrentStage(-1);
    setCompletedStages(new Set());
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6 fade-in">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Batch Recovery Simulation</h2>
          <p className="text-sm text-slate-400 mt-0.5">
            Runs the full recovery pipeline across all 2,000 seeded transactions
          </p>
        </div>
        {phase === 'idle' && (
          <button
            onClick={startRun}
            id="run-simulation-btn"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-sm transition-all hover:scale-105 shadow-lg shadow-indigo-500/20"
          >
            <Play size={16} />
            Run Batch Recovery
          </button>
        )}
        {phase === 'done' && (
          <button
            onClick={startRun}
            id="run-again-btn"
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1a2235] border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 font-medium text-sm transition-colors"
          >
            <RefreshCw size={14} />
            Run Again
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Running — staged progress */}
      {phase === 'running' && (
        <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <RefreshCw size={20} className="text-indigo-400 animate-spin" />
            </div>
            <div>
              <p className="text-base font-semibold text-slate-100">Running batch recovery…</p>
              <p className="text-xs text-slate-500">Processing 2,000 transactions through the full pipeline</p>
            </div>
          </div>

          <div className="space-y-4">
            {STAGES.map((stage, i) => {
              const Icon = stage.icon;
              const done = completedStages.has(i);
              const active = currentStage === i && !done;
              return (
                <div key={stage.id} className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-300 ${
                  done   ? 'bg-emerald-500/5 border-emerald-500/20' :
                  active ? 'bg-indigo-500/10 border-indigo-500/30' :
                           'bg-[#0a0d14] border-[#1a2235] opacity-40'
                }`}>
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    done ? 'bg-emerald-500/20' : active ? 'bg-indigo-500/20' : 'bg-[#1a2235]'
                  }`}>
                    {done
                      ? <CheckCircle size={16} className="text-emerald-400" />
                      : <Icon size={16} className={active ? 'text-indigo-400 animate-pulse' : 'text-slate-600'} />}
                  </div>
                  <span className={`text-sm font-medium ${
                    done ? 'text-emerald-400' : active ? 'text-slate-200' : 'text-slate-600'
                  }`}>{stage.label}</span>
                  {active && (
                    <div className="ml-auto flex gap-1">
                      {[0,1,2].map(j => (
                        <div key={j} className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                          style={{ animationDelay: `${j * 150}ms` }} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {phase === 'done' && result && (() => {
        const a = result.aggregates;
        return (
          <div className="space-y-6 fade-in">
            {/* Run metadata */}
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <CheckCircle size={14} className="text-emerald-400" />
              <span>Completed {fmtDate(result.completedAt)}</span>
              <span>·</span>
              <Clock size={12} />
              <span>{result.durationSeconds}s</span>
              <span>·</span>
              <span>Diagnosis: {result.meta?.diagnosisMode ?? 'deterministic'}</span>
              <span>·</span>
              <span>Seed: reviveai-demo-seed-1</span>
            </div>

            {/* Key metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <MetricCard
                label="Revenue at Risk"
                value={fmtINR(a.atRiskAmount)}
                sub={`${a.atRiskCount} failed transactions`}
                color="text-red-400"
              />
              <MetricCard
                label="Revenue Recovered"
                value={fmtINR(a.recoveredAmount)}
                sub={`${a.recoveredCount} successful`}
                color="text-emerald-400"
              />
              <MetricCard
                label="Recovery Rate"
                value={`${a.recoveryRate}%`}
                sub="of at-risk transactions"
                color="text-indigo-400"
              />
              <MetricCard
                label="Actions Executed"
                value={a.executedCount.toLocaleString()}
                sub={`${a.escalatedCount} escalated, ${a.stoppedCount} stopped`}
                color="text-slate-100"
              />
            </div>

            {/* Recovery Funnel */}
            <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
              <div className="flex items-center gap-2 mb-5">
                <TrendingUp size={16} className="text-indigo-400" />
                <h3 className="text-sm font-semibold text-slate-200">Recovery Funnel</h3>
                <span className="ml-auto text-xs text-slate-500">
                  {((a.recoveredAmount / a.atRiskAmount) * 100).toFixed(1)}% of revenue at risk recovered
                </span>
              </div>
              <RecoveryFunnel
                data={result.funnelData as { label: string; value: number; amount?: number }[]}
                atRiskAmount={a.atRiskAmount}
                recoveredAmount={a.recoveredAmount}
              />
            </div>

            {/* Breakdown table */}
            <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-6">
              <h3 className="text-sm font-semibold text-slate-200 mb-4">Guardrail Outcomes</h3>
              <div className="space-y-3">
                {[
                  { label: 'Auto-approved & executed',  value: a.approvedCount,  pct: a.approvedCount / a.atRiskCount,  color: 'bg-indigo-500' },
                  { label: 'Escalated to human review', value: a.escalatedCount, pct: a.escalatedCount / a.atRiskCount, color: 'bg-yellow-500' },
                  { label: 'Stopped / blocked',         value: a.stoppedCount,   pct: a.stoppedCount / a.atRiskCount,   color: 'bg-slate-600' },
                ].map(row => (
                  <div key={row.label}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-400">{row.label}</span>
                      <span className="text-slate-200 font-medium">
                        {row.value.toLocaleString()} ({(row.pct * 100).toFixed(1)}%)
                      </span>
                    </div>
                    <div className="h-2 w-full bg-[#0a0d14] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${row.color} transition-all duration-700`}
                        style={{ width: `${row.pct * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Baseline vs ReviveAI comparison */}
            <BaselineComparisonPanel />

            {/* Reproducible by design */}
            <div className="p-4 rounded-xl bg-[#1a2235] border border-[#2a3a52] text-xs text-slate-400 flex items-start gap-3">
              <RefreshCw size={14} className="text-indigo-400 mt-0.5 flex-shrink-0" />
              <span>
                <strong className="text-slate-300">Reproducible by design.</strong> The batch engine uses a fixed dataset
                ordering (seed 42) and deterministic fallback diagnosis. Clicking "Run Again" will produce identical numbers,
                which can be demonstrated live during the pitch.
              </span>
            </div>
          </div>
        );
      })()}

      {/* Idle — no prior run */}
      {phase === 'idle' && !result && (
        <div className="rounded-2xl bg-[#111827] border border-[#2a3a52] p-16 flex flex-col items-center gap-5">
          <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
            <Play size={28} className="text-indigo-400" />
          </div>
          <div className="text-center">
            <h3 className="text-lg font-semibold text-slate-100">Ready to run</h3>
            <p className="text-sm text-slate-400 mt-1 max-w-md">
              Click "Run Batch Recovery" to process all 2,000 transactions through the
              risk → diagnosis → guardrail → execute pipeline and see real computed results.
            </p>
          </div>
          <button
            onClick={startRun}
            className="flex items-center gap-2 px-6 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold transition-all hover:scale-105 shadow-lg shadow-indigo-500/20"
          >
            <Play size={16} />
            Run Batch Recovery
          </button>
        </div>
      )}
    </div>
  );
}
