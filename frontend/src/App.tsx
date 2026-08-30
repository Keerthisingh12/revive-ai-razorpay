import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { TransactionsPage } from './pages/TransactionsPage'
import {
  LayoutDashboard,
  CreditCard,
  Play,
  ClipboardList,
  Shield,
  Zap,
  Menu,
  X,
} from 'lucide-react'
import { useState } from 'react'

// ─── Page skeletons (will be replaced Day 2+) ───────────────────────────────

function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-96 gap-4">
      <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
        <Zap size={28} className="text-indigo-400" />
      </div>
      <h2 className="text-xl font-semibold text-slate-100">{title}</h2>
      <p className="text-slate-400 text-sm text-center max-w-sm">{description}</p>
      <span className="px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
        Building on Day {title === 'Dashboard' ? '4' : title === 'Transactions' ? '2' : title === 'Run Simulation' ? '4' : '5'}
      </span>
    </div>
  )
}

function DashboardPage() {
  return <ComingSoon title="Dashboard" description="Revenue at risk / recovered cards, charts, and live agent activity feed." />
}
// TransactionsPage is imported from pages/TransactionsPage.tsx
function SimulationPage() {
  return <ComingSoon title="Run Simulation" description="Staged batch recovery simulation — 2,000 transactions, real computed numbers." />
}
function ReviewPage() {
  return <ComingSoon title="Human Review Queue" description="Escalated cases with Approve / Reject / Stop actions." />
}
function SettingsPage() {
  return <ComingSoon title="Guardrail Settings" description="Read-only view of the deterministic guardrail thresholds." />
}

// ─── Navigation ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { path: '/',            label: 'Dashboard',     icon: LayoutDashboard },
  { path: '/transactions', label: 'Transactions', icon: CreditCard },
  { path: '/simulation',  label: 'Run Simulation', icon: Play },
  { path: '/review',      label: 'Human Review',  icon: ClipboardList },
  { path: '/settings',    label: 'Guardrails',    icon: Shield },
]

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <>
      {/* Overlay on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={[
          'fixed top-0 left-0 h-full w-60 z-30 flex flex-col',
          'bg-[#111827] border-r border-[#2a3a52]',
          'transition-transform duration-300',
          open ? 'translate-x-0' : '-translate-x-full',
          'lg:translate-x-0 lg:static lg:z-auto',
        ].join(' ')}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 h-16 border-b border-[#2a3a52] flex-shrink-0">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-100 leading-none">ReviveAI</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Payment Recovery</div>
          </div>
          <button
            className="ml-auto lg:hidden text-slate-400 hover:text-slate-200"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        {/* Demo mode badge */}
        <div className="px-4 py-3">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <div className="live-dot" />
            <span className="text-xs text-emerald-400 font-medium">Demo Mode Active</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-0.5">
          {NAV_ITEMS.map(({ path, label, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
                ].join(' ')
              }
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-[#2a3a52]">
          <p className="text-[11px] text-slate-600">Razorpay Buildathon 2025</p>
          <p className="text-[11px] text-slate-600">Track 3 · AI Revenue Recovery</p>
        </div>
      </aside>
    </>
  )
}

function Header({ onMenuClick }: { onMenuClick: () => void }) {
  const location = useLocation()
  const current = NAV_ITEMS.find(
    (n) => n.path === location.pathname || (n.path !== '/' && location.pathname.startsWith(n.path))
  )
  const Icon = current?.icon ?? LayoutDashboard

  return (
    <header className="h-16 flex items-center gap-4 px-6 border-b border-[#2a3a52] bg-[#111827] flex-shrink-0">
      <button
        className="lg:hidden text-slate-400 hover:text-slate-200"
        onClick={onMenuClick}
      >
        <Menu size={20} />
      </button>
      <div className="flex items-center gap-2">
        <Icon size={16} className="text-indigo-400" />
        <h1 className="text-sm font-semibold text-slate-100">{current?.label ?? 'Dashboard'}</h1>
      </div>
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-slate-500">Seed: 42</span>
        <span className="px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-medium">
          2,000 transactions
        </span>
      </div>
    </header>
  )
}

// ─── App Shell ───────────────────────────────────────────────────────────────

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0d14]">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        <main className="flex-1 overflow-y-auto p-6">
          <Routes>
            <Route path="/"             element={<DashboardPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/transactions/:id" element={<TransactionsPage />} />
            <Route path="/simulation"   element={<SimulationPage />} />
            <Route path="/review"       element={<ReviewPage />} />
            <Route path="/settings"     element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  )
}
