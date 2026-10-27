const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

function seedFromId(id) {
  const digits = String(id).match(/\d+/g)?.join('') || '1'
  return Number(digits) || 1
}

export function createMockTransaction({
  id,
  createdAt = new Date().toISOString(),
  riskLabel = 'LOW',
  source = 'simulated',
}) {
  const seed = seedFromId(id)
  const fraudProbability =
    riskLabel === 'UNSCORED'
      ? null
      : riskLabel === 'HIGH'
        ? Number((0.8 + (seed % 19) / 100).toFixed(2))
        : riskLabel === 'MEDIUM'
          ? Number((0.42 + (seed % 28) / 100).toFixed(2))
          : Number((0.01 + (seed % 33) / 100).toFixed(2))

  return {
    id: String(id),
    createdAt: new Date(createdAt).toISOString(),
    displayAmount: Number((8 + (seed % 25000) / 100).toFixed(2)),
    currency: 'usd',
    source,
    fraudProbability,
    riskLabel,
    isFlagged: riskLabel === 'HIGH' || riskLabel === 'UNSCORED',
    scoringStatus: riskLabel === 'UNSCORED' ? 'pending_review' : 'scored',
    modelVersion: 'mock-v1',
    reviewDecision: null,
    stripePaymentIntentId: null,
    razorpayPaymentId:
      source === 'razorpay' ? 'pay_mock_' + String(id).replace(/[^a-zA-Z0-9]/g, '') : null,
  }
}

const generatedAt = Date.now()

export const mockTransactions = Array.from({ length: 80 }, (_, index) => {
  let riskLabel = 'LOW'
  if (index < 7) riskLabel = 'HIGH'
  else if (index < 15) riskLabel = 'MEDIUM'
  else if (index >= 78) riskLabel = 'UNSCORED'

  const daysAgo = ((79 - index) / 79) * 29
  const hoursAgo = (index * 7) % 24
  const createdAt = new Date(generatedAt - daysAgo * DAY_MS - hoursAgo * HOUR_MS)

  return createMockTransaction({
    id: 'txn-mock-' + String(index + 1).padStart(4, '0'),
    createdAt,
    riskLabel,
    source: index % 2 === 0 ? 'razorpay' : 'simulated',
  })
})
