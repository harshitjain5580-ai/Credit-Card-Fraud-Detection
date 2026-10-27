import { useCallback, useEffect, useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'
import FlaggedFilterBar from '../components/FlaggedFilterBar'
import FlaggedTransactionsTable from '../components/FlaggedTransactionsTable'
import TransactionExplanationCard from '../components/TransactionExplanationCard'

const PAGE_SIZE = 20
const emptyFilters = { riskLabel: '', from: '', to: '' }

function LoadingRows() {
  return (
    <div aria-busy="true" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="h-5 w-48 animate-pulse rounded bg-slate-200" />
      {['one', 'two', 'three', 'four'].map((key) => (
        <div className="h-12 animate-pulse rounded bg-slate-100" key={key} />
      ))}
      <span className="sr-only" role="status">Loading flagged transactions</span>
    </div>
  )
}

export default function FlaggedTransactionsPage() {
  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [filters, setFilters] = useState(emptyFilters)
  const [appliedFilters, setAppliedFilters] = useState(emptyFilters)
  const [filterError, setFilterError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [reviewingId, setReviewingId] = useState('')
  const [explainingId, setExplainingId] = useState('')
  const [explanation, setExplanation] = useState(null)
  const [explanationError, setExplanationError] = useState('')

  const loadTransactions = useCallback(async () => {
    setLoading(true)
    setError('')

    const params = { page, limit: PAGE_SIZE, flagged: true }
    if (appliedFilters.riskLabel) params.riskLabel = appliedFilters.riskLabel
    if (appliedFilters.from) params.from = appliedFilters.from
    if (appliedFilters.to) params.to = appliedFilters.to

    try {
      const { data } = await apiClient.get('/api/transactions', { params })
      setItems(data.items)
      setTotal(data.total)
      setPage(data.page)
      setLimit(data.limit)
    } catch (requestError) {
      setError(getApiErrorMessage(requestError, 'Could not load flagged transactions.'))
    } finally {
      setLoading(false)
    }
  }, [appliedFilters, page])

  useEffect(() => {
    void loadTransactions()
  }, [loadTransactions])

  function updateFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }))
    setFilterError('')
  }

  function applyFilters(event) {
    event.preventDefault()
    if (filters.from && filters.to && filters.from > filters.to) {
      setFilterError('The end date must be on or after the start date.')
      return
    }

    setFilterError('')
    setAppliedFilters({ ...filters })
    setPage(1)
  }

  function clearFilters() {
    setFilters(emptyFilters)
    setAppliedFilters(emptyFilters)
    setFilterError('')
    setPage(1)
  }

  async function reviewTransaction(id, decision) {
    const current = items.find((transaction) => transaction.id === id)
    if (!current) return

    setActionError('')
    setReviewingId(id)
    setItems((existing) =>
      existing.map((transaction) =>
        transaction.id === id ? { ...transaction, reviewDecision: decision } : transaction,
      ),
    )

    try {
      const { data: updated } = await apiClient.patch(
        '/api/transactions/' + encodeURIComponent(id) + '/review',
        { decision },
      )

      if (updated.isFlagged === false) {
        setItems((existing) => existing.filter((transaction) => transaction.id !== id))
        setTotal((count) => Math.max(0, count - 1))
        if (items.length === 1 && page > 1) setPage((currentPage) => currentPage - 1)
      } else {
        setItems((existing) =>
          existing.map((transaction) => (transaction.id === id ? updated : transaction)),
        )
      }
    } catch (requestError) {
      setItems((existing) =>
        existing.map((transaction) => (transaction.id === id ? current : transaction)),
      )
      setActionError(getApiErrorMessage(requestError, 'Could not save this review decision.'))
    } finally {
      setReviewingId('')
    }
  }

  async function explainTransaction(id) {
    if (explanation?.transactionId === id) {
      setExplanation(null)
      setExplanationError('')
      return
    }

    setExplainingId(id)
    setExplanation(null)
    setExplanationError('')
    try {
      const { data } = await apiClient.get(
        '/api/transactions/' + encodeURIComponent(id) + '/explanation',
      )
      setExplanation(data)
    } catch (requestError) {
      setExplanationError(
        getApiErrorMessage(requestError, 'Could not load the model explanation.'),
      )
    } finally {
      setExplainingId('')
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / limit))
  const firstResult = total === 0 ? 0 : (page - 1) * limit + 1
  const lastResult = Math.min(page * limit, total)

  return (
    <div className="space-y-7">
      <section>
        <p className="text-sm font-semibold text-emerald-700">Review queue</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">
          Flagged transactions
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Review payments that need attention and record whether they are fraud or legitimate.
        </p>
      </section>

      <FlaggedFilterBar
        filters={filters}
        onApply={applyFilters}
        onChange={updateFilter}
        onClear={clearFilters}
      />

      {filterError && (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="alert">
          {filterError}
        </p>
      )}

      {actionError && (
        <p
          aria-live="polite"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
          role="alert"
        >
          {actionError}
        </p>
      )}

      {loading ? (
        <LoadingRows />
      ) : error ? (
        <section className="rounded-2xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm" role="alert">
          <h2 className="text-lg font-bold text-slate-950">Could not load flagged transactions</h2>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
          <button
            className="mt-5 rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            onClick={loadTransactions}
            type="button"
          >
            Retry
          </button>
        </section>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-500">
            <p>
              Showing {firstResult}-{lastResult} of {total}
            </p>
            <p>{limit} per page</p>
          </div>

          <FlaggedTransactionsTable
            items={items}
            onReview={reviewTransaction}
            onExplain={explainTransaction}
            reviewingId={reviewingId}
            explainingId={explainingId}
          />

          {explanationError && (
            <p
              aria-live="polite"
              className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              role="alert"
            >
              {explanationError}
            </p>
          )}
          {explanation && <TransactionExplanationCard explanation={explanation} />}

          <nav aria-label="Flagged transaction pages" className="flex items-center justify-between">
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page <= 1 || loading}
              onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
              type="button"
            >
              Previous
            </button>
            <span aria-live="polite" className="text-sm text-slate-600">
              Page {page} of {pageCount}
            </span>
            <button
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={page >= pageCount || loading}
              onClick={() => setPage((currentPage) => Math.min(pageCount, currentPage + 1))}
              type="button"
            >
              Next
            </button>
          </nav>
        </>
      )}
    </div>
  )
}
