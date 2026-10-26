import { useCallback, useEffect, useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'
import DashboardError from '../components/DashboardError'
import DashboardSkeleton from '../components/DashboardSkeleton'
import KpiCard from '../components/KpiCard'
import RiskHistogramChart from '../components/RiskHistogramChart'
import ModelCard from '../components/ModelCard'
import TimeSeriesChart from '../components/TimeSeriesChart'
import TransactionTable from '../components/TransactionTable'
import { useAuth } from '../context/AuthContext'

const numberFormatter = new Intl.NumberFormat()
const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

export default function DashboardPage() {
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [histogram, setHistogram] = useState([])
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [transactionError, setTransactionError] = useState('')
  const [actionError, setActionError] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const [period, setPeriod] = useState('24h')
  const [activeAction, setActiveAction] = useState('')

  const loadDashboard = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [statsResponse, histogramResponse, transactionsResponse] = await Promise.all([
        apiClient.get('/api/transactions/stats'),
        apiClient.get('/api/transactions/score-histogram'),
        apiClient.get('/api/transactions', { params: { page: 1, limit: 20 } }),
      ])

      setStats(statsResponse.data)
      setHistogram(histogramResponse.data.bins)
      setTransactions(transactionsResponse.data.items)
      setTransactionError('')
    } catch (requestError) {
      setError(
        getApiErrorMessage(requestError, 'Please check the API connection and try again.'),
      )
    } finally {
      setLoading(false)
    }
  }, [])

  const refreshTransactions = useCallback(async () => {
    try {
      const { data } = await apiClient.get('/api/transactions', {
        params: { page: 1, limit: 20 },
      })
      setTransactions(data.items)
      setTransactionError('')
    } catch (requestError) {
      setTransactionError(
        getApiErrorMessage(requestError, 'Could not refresh the transaction list.'),
      )
    }
  }, [])

  useEffect(() => {
    void loadDashboard()
  }, [loadDashboard])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshTransactions()
    }, 5000)

    return () => window.clearInterval(intervalId)
  }, [refreshTransactions])

  async function simulateTransactions(count, mode, actionName) {
    setActionError('')
    setActiveAction(actionName)

    try {
      await apiClient.post('/api/transactions/simulate', { count, mode })
      await loadDashboard()
    } catch (requestError) {
      setActionError(
        getApiErrorMessage(requestError, 'Could not simulate transactions. Please try again.'),
      )
    } finally {
      setActiveAction('')
    }
  }

  async function startCheckout() {
    setActionError('')
    setActionNotice('')
    setActiveAction('checkout')

    try {
      const { data } = await apiClient.post('/api/payments/checkout-session', {
        amount: 1,
        currency: 'usd',
        mode: 'normal',
      })

      if (isMockMode) {
        setActionNotice('Demo checkout complete. No payment was processed.')
        setActiveAction('')
        return
      }

      if (typeof data.url !== 'string' || !data.url) {
        throw new Error('The checkout service did not return a redirect URL.')
      }

      window.location.assign(data.url)
    } catch (requestError) {
      setActionError(
        getApiErrorMessage(requestError, 'Could not start the test checkout. Please try again.'),
      )
      setActiveAction('')
    }
  }

  if (loading) return <DashboardSkeleton />
  if (error) return <DashboardError message={error} onRetry={loadDashboard} />

  const series = period === '24h' ? stats.series24h : stats.series30d
  const fraudRate = (Number(stats.fraudRate || 0) * 100).toFixed(1) + '%'
  const averageRisk = (Number(stats.avgProbability || 0) * 100).toFixed(1) + '%'
  const isBusy = Boolean(activeAction)

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <p className="text-sm font-semibold text-emerald-700">Overview</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
            {user?.name ? 'Hello, ' + user.name : 'Dashboard'}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Monitor payment activity, review risk, and keep an eye on scoring health.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            className="rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => simulateTransactions(10, 'random', 'simulate')}
            type="button"
          >
            {activeAction === 'simulate' ? 'Simulating...' : 'Simulate 10 transactions'}
          </button>
          <button
            className="rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-800 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={() => simulateTransactions(5, 'fraud', 'fraud')}
            type="button"
          >
            {activeAction === 'fraud' ? 'Creating burst...' : 'Simulate fraud burst'}
          </button>
          <button
            className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isBusy}
            onClick={startCheckout}
            type="button"
          >
            {activeAction === 'checkout'
              ? isMockMode
                ? 'Preparing demo checkout...'
                : 'Starting checkout...'
              : isMockMode
                ? 'Try demo checkout'
                : 'Pay with Stripe (test)'}
          </button>
        </div>
      </section>

      {actionError && (
        <p
          aria-live="polite"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {actionNotice && (
        <p
          aria-live="polite"
          className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
          role="status"
        >
          {actionNotice}
        </p>
      )}

      <section aria-label="Transaction key performance indicators" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          accent="emerald"
          detail="All payment events"
          label="Total transactions"
          value={numberFormatter.format(stats.total)}
        />
        <KpiCard
          accent="rose"
          detail="Flagged for review"
          label="Flagged"
          value={numberFormatter.format(stats.flagged)}
        />
        <KpiCard
          accent="amber"
          detail="Flagged share of all transactions"
          label="Fraud rate"
          value={fraudRate}
        />
        <KpiCard
          accent="slate"
          detail="Mean scored probability"
          label="Average risk score"
          value={averageRisk}
        />
      </section>

      <section aria-label="Risk charts" className="grid gap-4 lg:grid-cols-2">
        <TimeSeriesChart
          data={Array.isArray(series) ? series : []}
          onPeriodChange={setPeriod}
          period={period}
        />
        <RiskHistogramChart bins={Array.isArray(histogram) ? histogram : []} />
      </section>

      <ModelCard />

      <section className="space-y-2">
        <TransactionTable
          error={transactionError}
          items={Array.isArray(transactions) ? transactions : []}
          onRetry={refreshTransactions}
        />
        {isMockMode ? (
          <p className="px-1 text-xs text-slate-500">
            Demo checkout only. No payment is processed.
          </p>
        ) : (
          <p className="px-1 text-xs text-slate-500">
            Stripe test card: <span className="font-semibold text-slate-700">4242 4242 4242 4242</span>
          </p>
        )}
      </section>
    </div>
  )
}
