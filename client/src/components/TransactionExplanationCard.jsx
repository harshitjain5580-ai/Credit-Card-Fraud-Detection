function formatProbability(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value)
}

export default function TransactionExplanationCard({ explanation }) {
  const isMock = explanation.modelVersion.toLowerCase().startsWith('mock')

  return (
    <section
      aria-labelledby="explanation-title"
      className="rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-indigo-700">Explainable AI</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950" id="explanation-title">
            Why the model gave this score
          </h2>
        </div>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-800">
          {explanation.modelVersion}
        </span>
      </div>

      <p className="mt-3 text-sm text-slate-700">
        Fraud score: <strong>{formatProbability(explanation.fraudProbability)}</strong>
        {' · '}review threshold: <strong>{formatProbability(explanation.threshold)}</strong>
      </p>

      {isMock ? (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Demo example only. Mock mode does not run the trained fraud model.
        </p>
      ) : (
        <p className="mt-3 text-xs leading-5 text-slate-500">
          {explanation.method === 'tree_shap'
            ? 'TreeSHAP shows which model inputs pushed this score up or down. '
            : 'The logistic-regression coefficients show how each model input changed the score. '}
          The V features are anonymized dataset components; these signals are not proof of fraud.
        </p>
      )}

      <ul className="mt-4 divide-y divide-slate-100">
        {explanation.topFactors.map((factor) => {
          const raisesRisk = factor.direction === 'increases_risk'
          return (
            <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={factor.feature}>
              <div>
                <p className="text-sm font-semibold text-slate-900">{factor.feature}</p>
                <p className="text-xs text-slate-500">Input value: {Number(factor.value).toFixed(3)}</p>
              </div>
              <span
                className={
                  'rounded-full px-2.5 py-1 text-xs font-semibold ' +
                  (raisesRisk ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')
                }
              >
                {raisesRisk ? 'Raises risk' : 'Lowers risk'} ·{' '}
                {factor.impact > 0 ? '+' : ''}{Number(factor.impact).toFixed(2)} log-odds
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
