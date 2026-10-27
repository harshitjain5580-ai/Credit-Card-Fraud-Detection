const riskClasses = {
  LOW: 'bg-emerald-100 text-emerald-800',
  MEDIUM: 'bg-amber-100 text-amber-900',
  HIGH: 'bg-rose-100 text-rose-800',
  UNSCORED: 'bg-slate-100 text-slate-700',
}

function formatTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatAmount(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: String(currency || 'usd').toUpperCase(),
    }).format(amount)
  } catch {
    return Number(amount || 0).toFixed(2) + ' ' + String(currency || 'usd').toUpperCase()
  }
}

function formatProbability(value) {
  if (value === null || value === undefined) return '—'
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value)
}

function formatSource(source) {
  if (source === 'razorpay') return 'Razorpay'
  if (source === 'stripe') return 'Stripe (legacy)'
  return 'Simulated'
}

export default function TransactionTable({ items, error, onRetry }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-slate-950">Latest transactions</h2>
          <p className="mt-1 text-xs text-slate-500">Newest 20 payments, refreshed every 5 seconds</p>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
          {items.length} shown
        </span>
      </div>

      {error && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-sm text-amber-900">{error}</p>
          <button
            className="text-sm font-semibold text-amber-900 underline underline-offset-2"
            onClick={onRetry}
            type="button"
          >
            Retry
          </button>
        </div>
      )}

      {items.length === 0 ? (
        <div className="px-5 py-14 text-center">
          <p className="text-sm font-semibold text-slate-900">
            No transactions yet - click Simulate
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Simulate payments to populate this table with risk scores.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-[900px] w-full border-collapse text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Time</th>
                <th className="px-5 py-3 font-semibold">Amount</th>
                <th className="px-5 py-3 font-semibold">Probability</th>
                <th className="px-5 py-3 font-semibold">Risk</th>
                <th className="px-5 py-3 font-semibold">Source</th>
                <th className="px-5 py-3 font-semibold">Scoring status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((transaction) => (
                <tr className="hover:bg-slate-50/70" key={transaction.id}>
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">
                    {formatTime(transaction.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 font-semibold text-slate-900">
                    {formatAmount(transaction.displayAmount, transaction.currency)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">
                    {formatProbability(transaction.fraudProbability)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5">
                    <span
                      className={
                        'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' +
                        (riskClasses[transaction.riskLabel] || riskClasses.UNSCORED)
                      }
                    >
                      {transaction.riskLabel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">
                    {formatSource(transaction.source)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-slate-600">
                    {transaction.scoringStatus === 'pending_review' ? 'Pending review' : 'Scored'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
