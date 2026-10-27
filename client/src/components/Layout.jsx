import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import AlertBell from './AlertBell'
import { useAuth } from '../context/AuthContext'

function navigationClass({ isActive }) {
  return isActive
    ? 'rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800'
    : 'rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900'
}

export default function Layout() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4 sm:px-8">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
              Payment risk console
            </p>
            <p className="mt-1 text-lg font-bold tracking-tight text-slate-950">
              Fraud Detection Dashboard
            </p>
          </div>

          <nav aria-label="Main navigation" className="flex w-full flex-wrap items-center gap-1 sm:w-auto">
            <NavLink className={navigationClass} end to="/">
              Dashboard
            </NavLink>
            <NavLink className={navigationClass} to="/flagged">
              Flagged transactions
            </NavLink>
            <NavLink className={navigationClass} to="/analyze">
              Batch AI analysis
            </NavLink>
            <AlertBell />

          </nav>

          <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-start">
            {isMockMode && (
              <span
                className="rounded-full border border-amber-200 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900"
                role="status"
              >
                Mock data
              </span>
            )}
            <span className="hidden text-sm text-slate-600 sm:block">
              {user?.name || user?.email}
            </span>
            <button
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={handleLogout}
              type="button"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
        <Outlet />
      </main>
    </div>
  )
}
