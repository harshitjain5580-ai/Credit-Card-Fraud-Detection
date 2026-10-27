import { useState } from 'react'
import apiClient, { getApiErrorMessage } from '../api/client'

const FEATURE_COLUMNS = ['Time', ...Array.from({ length: 28 }, (_, index) => 'V' + (index + 1)), 'Amount']
const MAX_ROWS = 100
const SAMPLE_BYTES = 1024 * 1024

const riskClasses = {
  LOW: 'bg-emerald-100 text-emerald-800',
  MEDIUM: 'bg-amber-100 text-amber-900',
  HIGH: 'bg-rose-100 text-rose-800',
}

function parseCsvLine(line) {
  const values = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (quoted && character === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      values.push(value.trim())
      value = ''
    } else {
      value += character
    }
  }

  if (quoted) throw new Error('A CSV row has an unmatched quote.')
  values.push(value.trim())
  return values
}

async function readFeatureRows(file) {
  if (!file) throw new Error('Choose a CSV file first.')

  // Read a small prefix only: the demo scores at most 100 rows, even for a large dataset.
  const text = await file.slice(0, SAMPLE_BYTES).text()
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) throw new Error('The CSV needs a header row and at least one transaction.')

  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ''))
  if (new Set(header).size !== header.length) throw new Error('The CSV has duplicate column names.')
  const missing = FEATURE_COLUMNS.filter((name) => !header.includes(name))
  if (missing.length) throw new Error('Missing model columns: ' + missing.join(', '))

  const rows = lines.slice(1, MAX_ROWS + 1)
  const transactions = rows.map((line, rowIndex) => {
    const values = parseCsvLine(line)
    if (values.length !== header.length) {
      throw new Error('CSV row ' + (rowIndex + 2) + ' does not match the header.')
    }

    const transaction = Object.fromEntries(
      FEATURE_COLUMNS.map((name) => {
        const rawValue = values[header.indexOf(name)]
        if (rawValue === '') {
          throw new Error('CSV row ' + (rowIndex + 2) + ' is missing ' + name + '.')
        }
        const value = Number(rawValue)
        if (!Number.isFinite(value)) {
          throw new Error('CSV row ' + (rowIndex + 2) + ' has an invalid ' + name + ' value.')
        }
        return [name, value]
      }),
    )
    if (transaction.Amount < 0) {
      throw new Error('CSV row ' + (rowIndex + 2) + ' has a negative Amount.')
    }
    return transaction
  })

  return transactions
}

function formatProbability(value) {
  return new Intl.NumberFormat(undefined, {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value)
}

export default function BatchAnalyzerPage() {
  const [file, setFile] = useState(null)
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [modelVersion, setModelVersion] = useState('')
  const isMockMode = import.meta.env.VITE_USE_MOCK === 'true'

  async function analyze(event) {
    event.preventDefault()
    setError('')
    setItems([])
    setLoading(true)
    try {
      const transactions = await readFeatureRows(file)
      const { data } = await apiClient.post('/api/predictions/batch', { transactions })
      setItems(data.items)
      setModelVersion(data.items[0]?.modelVersion || '')
    } catch (requestError) {
      setError(
        requestError?.response
          ? getApiErrorMessage(requestError, 'Could not score these transactions.')
          : requestError.message || 'Could not read this CSV file.',
      )
    } finally {
      setLoading(false)
    }
  }

  const flaggedCount = items.filter((item) => item.isFlagged).length

  return (
    <div className="space-y-7">
      <section>
        <p className="text-sm font-semibold text-indigo-700">Model workspace</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">Batch AI analysis</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          Score up to 100 transaction rows with the trained fraud model. Results are temporary and
          are not added to your transaction history.
        </p>
      </section>

      <form className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" onSubmit={analyze}>
        <label className="block text-sm font-semibold text-slate-800" htmlFor="batch-csv">
          Transaction CSV
        </label>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Include Time, V1–V28, and Amount columns. A Class label column is allowed but ignored.
          Only the first 100 rows are read and sent for scoring.
        </p>
        <input
          accept=".csv,text/csv"
          className="mt-4 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700"
          id="batch-csv"
          onChange={(event) => {
            setFile(event.target.files?.[0] || null)
            setItems([])
            setError('')
          }}
          type="file"
        />
        {file && <p className="mt-2 text-xs text-slate-500">Selected: {file.name}</p>}
        {isMockMode && (
          <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900" role="status">
            Mock mode is on, so these sample scores are illustrative and do not come from the trained model.
          </p>
        )}
        {error && (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
            {error}
          </p>
        )}
        <button
          className="mt-5 rounded-xl bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800 disabled:cursor-wait disabled:opacity-60"
          disabled={loading || !file}
          type="submit"
        >
          {loading ? 'Scoring transactions...' : 'Analyze CSV sample'}
        </button>
      </form>

      {items.length > 0 && (
        <section className="space-y-4" aria-labelledby="batch-results-title">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-indigo-700">Model results</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950" id="batch-results-title">
                {items.length} transactions scored
              </h2>
            </div>
            <p className="text-sm text-slate-600">
              {flaggedCount} flagged · {modelVersion}
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-[680px] w-full border-collapse text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold">CSV row</th>
                    <th className="px-5 py-3 font-semibold">Fraud probability</th>
                    <th className="px-5 py-3 font-semibold">Risk</th>
                    <th className="px-5 py-3 font-semibold">Decision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => (
                    <tr className="hover:bg-slate-50/70" key={item.index}>
                      <td className="px-5 py-3 text-slate-600">{item.index + 2}</td>
                      <td className="px-5 py-3 font-semibold text-slate-900">
                        {formatProbability(item.fraudProbability)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={'rounded-full px-2.5 py-1 text-xs font-semibold ' + riskClasses[item.riskLabel]}>
                          {item.riskLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-slate-600">
                        {item.isFlagged ? 'Review as potential fraud' : 'Below model threshold'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
