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

function reviewLabel(decision) {
  return decision === 'confirmed_fraud' ? 'Confirmed fraud' : 'Marked legit'
}

export default function FlaggedTransactionsTable({
  items,
  reviewingId,
  explainingId,
  onReview,
  onExplain,
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
        <p className="text-sm font-semibold text-slate-900">No flagged transactions found</p>
        <p className="mt-2 text-sm text-slate-500">Try changing the filters or check back later.</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-[1180px] w-full border-collapse text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-5 py-3 font-semibold">Time</th>
              <th className="px-5 py-3 font-semibold">Amount</th>
              <th className="px-5 py-3 font-semibold">Probability</th>
              <th className="px-5 py-3 font-semibold">Risk</th>
              <th className="px-5 py-3 font-semibold">Source</th>
              <th className="px-5 py-3 font-semibold">Scoring status</th>
              <th className="px-5 py-3 font-semibold">Model insight</th>
              <th className="px-5 py-3 font-semibold">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((transaction) => {
              const isReviewing = reviewingId === transaction.id
              return (
                <tr className="align-top hover:bg-slate-50/70" key={transaction.id}>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                    {formatTime(transaction.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 font-semibold text-slate-900">
                    {formatAmount(transaction.displayAmount, transaction.currency)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                    {formatProbability(transaction.fraudProbability)}
                  </td>
                  <td className="whitespace-nowrap px-5 py-4">
                    <span
                      className={
                        'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ' +
                        (riskClasses[transaction.riskLabel] || riskClasses.UNSCORED)
                      }
                    >
                      {transaction.riskLabel}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-5 py-4 text-slate-600">
                    {transaction.source === 'razorpay'
                      ? 'Razorpay'
                      : transaction.source === 'stripe'
                        ? 'Stripe (legacy)'
                        : 'Simulated'}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-slate-700">
                      {transaction.scoringStatus === 'pending_review' ? 'Pending review' : 'Scored'}
                    </span>
                    {transaction.scoringStatus === 'pending_review' && (
                      <span className="mt-2 block max-w-56 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium leading-5 text-slate-700">
                        Model unavailable - needs manual review
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <button
                      className="whitespace-nowrap rounded-lg border border-indigo-200 px-3 py-2 text-xs font-semibold text-indigo-800 transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={transaction.scoringStatus !== 'scored' || Boolean(explainingId)}
                      onClick={() => onExplain(transaction.id)}
                      type="button"
                    >
                      {explainingId === transaction.id ? 'Explaining...' : 'Why this score?'}
                    </button>
                  </td>
                  <td className="px-5 py-4">
                    {transaction.reviewDecision ? (
                      <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {reviewLabel(transaction.reviewDecision)}
                      </span>
                    ) : (
                      <div className="flex min-w-44 flex-col gap-2">
                        <button
                          className="rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white transition hover:bg-rose-800 disabled:cursor-wait disabled:opacity-60"
                          disabled={Boolean(reviewingId)}
                          onClick={() => onReview(transaction.id, 'confirmed_fraud')}
                          type="button"
                        >
                          {isReviewing ? 'Saving...' : 'Confirm fraud'}
                        </button>
                        <button
                          className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
                          disabled={Boolean(reviewingId)}
                          onClick={() => onReview(transaction.id, 'legit')}
                          type="button"
                        >
                          {isReviewing ? 'Saving...' : 'Mark legit'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
