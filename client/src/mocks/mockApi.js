import { AxiosError } from 'axios'
import { createMockTransaction, mockTransactions } from './mockData'

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const users = new Map()
const transactions = [...mockTransactions]
let transactionSequence = mockTransactions.length
const predictionFeatureNames = [
  'Time',
  ...Array.from({ length: 28 }, (_, index) => 'V' + (index + 1)),
  'Amount',
]

const statusText = {
  200: 'OK',
  201: 'Created',
  400: 'Bad Request',
  401: 'Unauthorized',
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
}

function makeResponse(config, status, data) {
  return {
    data,
    status,
    statusText: statusText[status] || 'Error',
    headers: { 'content-type': 'application/json' },
    config,
    request: null,
  }
}

function rejectRequest(config, status, message, code) {
  const response = makeResponse(config, status, {
    error: { message, code },
  })
  throw new AxiosError(
    message,
    status >= 500 ? 'ERR_BAD_RESPONSE' : 'ERR_BAD_REQUEST',
    config,
    null,
    response,
  )
}

function readBody(config) {
  if (!config.data) return {}
  if (typeof config.data !== 'string') return config.data

  try {
    return JSON.parse(config.data)
  } catch {
    return {}
  }
}

function getPath(config) {
  const url = new URL(config.url || '/', config.baseURL || 'http://mock.local')
  return {
    pathname: url.pathname.replace(/\/+$/, '') || '/',
    params: new URLSearchParams(url.search),
  }
}

function getParams(config, searchParams) {
  const params = new URLSearchParams(searchParams)
  const configParams = config.params

  if (configParams instanceof URLSearchParams) {
    for (const [key, value] of configParams.entries()) params.set(key, value)
  } else if (configParams && typeof configParams === 'object') {
    for (const [key, value] of Object.entries(configParams)) {
      if (value !== undefined && value !== null) params.set(key, String(value))
    }
  }

  return params
}

function getHeader(config, name) {
  return (
    config.headers?.get?.(name) ||
    config.headers?.[name] ||
    config.headers?.[name.toLowerCase()] ||
    ''
  )
}

function makeUser(email, name) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const existingUser = users.get(normalizedEmail)
  if (existingUser) return existingUser

  const defaultName = normalizedEmail.split('@')[0] || 'Merchant'
  const user = {
    id: 'mock-user-' + encodeURIComponent(normalizedEmail),
    name: String(name || defaultName).trim(),
    email: normalizedEmail,
    role: 'merchant',
  }
  users.set(normalizedEmail, user)
  return user
}

function tokenForUser(user) {
  return 'mock-token-' + encodeURIComponent(user.email)
}

function userFromToken(config) {
  const authorization = String(getHeader(config, 'Authorization'))
  if (!authorization.startsWith('Bearer ')) return null

  const token = authorization.slice('Bearer '.length)
  if (!token.startsWith('mock-token-')) return null

  try {
    const email = decodeURIComponent(token.slice('mock-token-'.length))
    if (!email) return null
    return makeUser(email)
  } catch {
    return null
  }
}

function requireUser(config) {
  const user = userFromToken(config)
  if (!user) rejectRequest(config, 401, 'Please sign in to continue.', 'UNAUTHORIZED')
  return user
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim())
}

function createSessionResponse(config, user, status = 200) {
  return makeResponse(config, status, {
    token: tokenForUser(user),
    user,
  })
}

function parseDateBound(value, endOfDay = false) {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return NaN

  if (endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parsed + DAY_MS - 1
  }
  return parsed
}

function listTransactions(config, params) {
  const page = Number(params.get('page') || 1)
  const limit = Number(params.get('limit') || 20)

  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(limit) || limit < 1) {
    rejectRequest(config, 422, 'Page and limit must be positive integers.', 'INVALID_INPUT')
  }

  const riskLabel = params.get('riskLabel')
  const allowedRiskLabels = ['LOW', 'MEDIUM', 'HIGH', 'UNSCORED']
  if (riskLabel && !allowedRiskLabels.includes(riskLabel)) {
    rejectRequest(config, 422, 'The risk label is not valid.', 'INVALID_INPUT')
  }

  const from = parseDateBound(params.get('from'))
  const to = parseDateBound(params.get('to'), true)
  if (Number.isNaN(from) || Number.isNaN(to)) {
    rejectRequest(config, 422, 'The date filter is not valid.', 'INVALID_INPUT')
  }

  const flagged = params.get('flagged') === 'true'
  const filtered = transactions
    .filter((transaction) => {
      if (riskLabel && transaction.riskLabel !== riskLabel) return false
      if (flagged && !transaction.isFlagged) return false
      const createdAt = Date.parse(transaction.createdAt)
      if (from !== null && createdAt < from) return false
      if (to !== null && createdAt > to) return false
      return true
    })
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))

  const offset = (page - 1) * limit
  return makeResponse(config, 200, {
    items: filtered.slice(offset, offset + limit).map((item) => ({ ...item })),
    page,
    limit,
    total: filtered.length,
  })
}

function buildSeries(hours) {
  const now = Date.now()

  if (hours) {
    const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS
    return Array.from({ length: 24 }, (_, index) => {
      const start = currentHour - (23 - index) * HOUR_MS
      const end = start + HOUR_MS
      const inBucket = transactions.filter((item) => {
        const createdAt = Date.parse(item.createdAt)
        return createdAt >= start && createdAt < end
      })
      return {
        t: new Date(start).toISOString(),
        total: inBucket.length,
        flagged: inBucket.filter((item) => item.isFlagged).length,
      }
    })
  }

  const currentDay = new Date(now)
  const currentDayStart = Date.UTC(
    currentDay.getUTCFullYear(),
    currentDay.getUTCMonth(),
    currentDay.getUTCDate(),
  )
  return Array.from({ length: 30 }, (_, index) => {
    const start = currentDayStart - (29 - index) * DAY_MS
    const end = start + DAY_MS
    const inBucket = transactions.filter((item) => {
      const createdAt = Date.parse(item.createdAt)
      return createdAt >= start && createdAt < end
    })
    return {
      t: new Date(start).toISOString(),
      total: inBucket.length,
      flagged: inBucket.filter((item) => item.isFlagged).length,
    }
  })
}

function buildStats(config) {
  const byRisk = { LOW: 0, MEDIUM: 0, HIGH: 0, UNSCORED: 0 }
  for (const transaction of transactions) byRisk[transaction.riskLabel] += 1

  const scored = transactions.filter((item) => item.fraudProbability !== null)
  const probabilityTotal = scored.reduce((sum, item) => sum + item.fraudProbability, 0)

  return makeResponse(config, 200, {
    total: transactions.length,
    flagged: transactions.filter((item) => item.isFlagged).length,
    fraudRate: transactions.length
      ? transactions.filter((item) => item.isFlagged).length / transactions.length
      : 0,
    avgProbability: scored.length ? probabilityTotal / scored.length : 0,
    byRisk,
    series24h: buildSeries(true),
    series30d: buildSeries(false),
  })
}

function buildHistogram(config) {
  const probabilities = transactions
    .map((item) => item.fraudProbability)
    .filter((probability) => probability !== null)

  const bins = Array.from({ length: 10 }, (_, index) => {
    const from = index / 10
    const to = (index + 1) / 10
    const count = probabilities.filter(
      (probability) => probability >= from && (probability < to || (index === 9 && probability <= to)),
    ).length
    return { from, to, count }
  })

  return makeResponse(config, 200, { bins })
}

function simulateTransactions(config, body) {
  const count = Number(body.count)
  const mode = body.mode

  if (!Number.isInteger(count) || count < 1 || count > 50) {
    rejectRequest(config, 422, 'Count must be between 1 and 50.', 'INVALID_INPUT')
  }
  if (!['random', 'fraud'].includes(mode)) {
    rejectRequest(config, 422, 'Mode must be random or fraud.', 'INVALID_INPUT')
  }

  const items = Array.from({ length: count }, (_, index) => {
    transactionSequence += 1
    const selector = (transactionSequence * 37 + index * 11) % 100
    const riskLabel =
      mode === 'fraud' ? 'HIGH' : selector < 8 ? 'HIGH' : selector < 18 ? 'MEDIUM' : 'LOW'
    const transaction = createMockTransaction({
      id: 'txn-sim-' + Date.now() + '-' + transactionSequence,
      createdAt: new Date().toISOString(),
      riskLabel,
      source: 'simulated',
    })
    transactions.unshift(transaction)
    return { ...transaction }
  })

  return makeResponse(config, 200, { created: items.length, items })
}

function updateReview(config, id, body) {
  if (!['confirmed_fraud', 'legit'].includes(body.decision)) {
    rejectRequest(config, 422, 'Decision must be confirmed_fraud or legit.', 'INVALID_INPUT')
  }

  const transaction = transactions.find((item) => item.id === decodeURIComponent(id))
  if (!transaction) rejectRequest(config, 404, 'Transaction was not found.', 'NOT_FOUND')

  transaction.reviewDecision = body.decision
  transaction.isFlagged = body.decision === 'confirmed_fraud'
  return makeResponse(config, 200, { ...transaction })
}

function explainMockTransaction(config, id) {
  const transaction = transactions.find((item) => item.id === decodeURIComponent(id))
  if (!transaction) rejectRequest(config, 404, 'Transaction was not found.', 'NOT_FOUND')
  if (transaction.scoringStatus !== 'scored') {
    rejectRequest(config, 409, 'This transaction has no model score to explain.', 'NOT_SCORED')
  }

  const mockImpact = transaction.riskLabel === 'HIGH' ? 2.1 : -0.8
  return makeResponse(config, 200, {
    transactionId: transaction.id,
    fraudProbability: transaction.fraudProbability,
    threshold: 0.5,
    modelVersion: 'mock-v1-placeholder',
    method: 'tree_shap',
    baselineLogOdds: -2.4,
    topFactors: [
      {
        feature: 'V14',
        value: Number(((transaction.displayAmount % 4) - 2).toFixed(3)),
        impact: mockImpact,
        direction: mockImpact >= 0 ? 'increases_risk' : 'decreases_risk',
      },
      {
        feature: 'Amount',
        value: transaction.displayAmount,
        impact: 0.32,
        direction: 'increases_risk',
      },
    ],
  })
}

function scoreMockBatch(config, body) {
  if (
    !Array.isArray(body.transactions) ||
    body.transactions.length < 1 ||
    body.transactions.length > 100
  ) {
    rejectRequest(config, 422, 'Provide between 1 and 100 transactions.', 'INVALID_INPUT')
  }

  const items = body.transactions.map((transaction, index) => {
    if (
      !transaction ||
      Object.keys(transaction).length !== predictionFeatureNames.length ||
      predictionFeatureNames.some((name) => !Number.isFinite(transaction[name])) ||
      transaction.Amount < 0
    ) {
      rejectRequest(config, 422, 'Each row must contain valid model features.', 'INVALID_INPUT')
    }

    const signal =
      Math.abs(transaction.V14) * 0.55 +
      Math.abs(transaction.V10) * 0.3 +
      Math.abs(transaction.V12) * 0.25 +
      Math.log1p(transaction.Amount) * 0.08 -
      2.4
    const fraudProbability = Number((1 / (1 + Math.exp(-signal))).toFixed(6))
    const threshold = 0.5
    const riskLabel = fraudProbability >= threshold ? 'HIGH' : fraudProbability >= 0.25 ? 'MEDIUM' : 'LOW'
    return {
      index,
      fraudProbability,
      riskLabel,
      isFlagged: fraudProbability >= threshold,
      threshold,
      modelVersion: 'mock-v1-placeholder',
    }
  })

  return makeResponse(config, 200, { count: items.length, items })
}

function checkoutSession(config, body) {
  const amount = Number(body.amount)
  const currency = String(body.currency || '').toLowerCase()
  const mode = body.mode

  if (!Number.isFinite(amount) || amount < 1 || currency !== 'usd' || !['normal', 'fraud-demo'].includes(mode)) {
    rejectRequest(config, 422, 'Checkout details are not valid.', 'INVALID_INPUT')
  }

  return makeResponse(config, 200, { url: '/' })
}

function modelInfo(config) {
  return makeResponse(config, 200, {
    model_version: 'mock-v1-placeholder',
    threshold: 0.5,
    min_precision: 0.9,
    trained_at: '2026-01-01T00:00:00.000Z',
    metrics: {
      precision: 0.91,
      recall: 0.84,
      f1: 0.87,
      roc_auc: 0.96,
      pr_auc: 0.73,
      confusion_matrix: [
        [980, 20],
        [8, 42],
      ],
    },
  })
}

export default async function mockApiAdapter(config) {
  try {
    const { pathname, params: searchParams } = getPath(config)
    const params = getParams(config, searchParams)
    const method = String(config.method || 'get').toLowerCase()
    const body = readBody(config)

    if (method === 'get' && (pathname === '/health' || pathname === '/api/health')) {
      return makeResponse(config, 200, { status: 'ok' })
    }

    if (method === 'post' && pathname === '/api/auth/register') {
      const name = String(body.name || '').trim()
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!name || !validateEmail(email) || password.length < 8) {
        rejectRequest(
          config,
          422,
          'Enter a name, a valid email, and a password with at least 8 characters.',
          'INVALID_INPUT',
        )
      }
      if (users.has(email)) {
        rejectRequest(config, 409, 'An account with this email already exists.', 'EMAIL_EXISTS')
      }

      const user = makeUser(email, name)
      return createSessionResponse(config, user, 201)
    }

    if (method === 'post' && pathname === '/api/auth/login') {
      const email = String(body.email || '').trim().toLowerCase()
      const password = String(body.password || '')

      if (!validateEmail(email) || password.length < 8) {
        rejectRequest(
          config,
          422,
          'Enter a valid email and a password with at least 8 characters.',
          'INVALID_INPUT',
        )
      }

      const user = makeUser(email)
      return createSessionResponse(config, user)
    }

    if (method === 'get' && pathname === '/api/auth/me') {
      const user = requireUser(config)
      return makeResponse(config, 200, { user })
    }

    if (method === 'post' && pathname === '/api/predictions/batch') {
      requireUser(config)
      return scoreMockBatch(config, body)
    }

    if (method === 'get' && pathname === '/api/transactions') {
      requireUser(config)
      return listTransactions(config, params)
    }

    const explanationMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/explanation$/)
    if (method === 'get' && explanationMatch) {
      requireUser(config)
      return explainMockTransaction(config, explanationMatch[1])
    }

    if (method === 'get' && pathname === '/api/transactions/stats') {
      requireUser(config)
      return buildStats(config)
    }

    if (method === 'get' && pathname === '/api/transactions/score-histogram') {
      requireUser(config)
      return buildHistogram(config)
    }

    if (method === 'post' && pathname === '/api/transactions/simulate') {
      requireUser(config)
      return simulateTransactions(config, body)
    }

    const reviewMatch = pathname.match(/^\/api\/transactions\/([^/]+)\/review$/)
    if (method === 'patch' && reviewMatch) {
      requireUser(config)
      return updateReview(config, reviewMatch[1], body)
    }

    if (method === 'post' && pathname === '/api/payments/checkout-session') {
      requireUser(config)
      return checkoutSession(config, body)
    }

    if (method === 'get' && pathname === '/api/model-info') {
      requireUser(config)
      return modelInfo(config)
    }

    if (method === 'get' && pathname === '/api/alerts/unread-count') {
      requireUser(config)
      const count = transactions.filter((item) => item.isFlagged && !item.reviewDecision).length
      return makeResponse(config, 200, { count })
    }

    rejectRequest(config, 404, 'The mock API endpoint was not found.', 'NOT_FOUND')
  } catch (error) {
    if (error instanceof AxiosError) throw error
    const response = makeResponse(config, 500, {
      error: { message: 'The mock API could not handle this request.', code: 'MOCK_ERROR' },
    })
    throw new AxiosError('The mock API could not handle this request.', 'ERR_BAD_RESPONSE', config, null, response)
  }
}
