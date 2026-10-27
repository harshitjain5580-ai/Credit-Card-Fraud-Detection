import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import apiClient, { getApiErrorMessage } from '../api/client'

const CHECKOUT_SCRIPT = 'https://checkout.razorpay.com/v1/checkout.js'

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) {
      resolve(true)
      return
    }
    const existing = document.querySelector(`script[src="${CHECKOUT_SCRIPT}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve(true), { once: true })
      existing.addEventListener('error', () => resolve(false), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = CHECKOUT_SCRIPT
    script.onload = () => resolve(true)
    script.onerror = () => resolve(false)
    document.body.appendChild(script)
  })
}

export default function CheckoutPage() {
  const [params] = useSearchParams()
  const [scriptReady, setScriptReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [paid, setPaid] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const orderId = params.get('order_id')
  const keyId = params.get('key_id')
  const amount = Number(params.get('amount'))
  const currency = params.get('currency') || 'INR'
  const sessionToken = params.get('session_token')
  const validSession = Boolean(orderId && keyId && sessionToken && Number.isFinite(amount) && amount > 0)

  useEffect(() => {
    let mounted = true
    loadRazorpayScript().then((ready) => {
      if (mounted) {
        setScriptReady(ready)
        setIsLoading(false)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  async function openCheckout() {
    setBusy(true)
    setError('')
    const checkout = new window.Razorpay({
      key: keyId,
      order_id: orderId,
      amount,
      currency,
      name: 'Fraud Detection Demo',
      description: 'Razorpay test payment',
      theme: { color: '#047857' },
      handler: async (response) => {
        try {
          await apiClient.post('/api/payments/verify', {
            sessionToken,
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
          })
          setPaid(true)
        } catch (verificationError) {
          setError(getApiErrorMessage(verificationError, 'We could not confirm this payment. Please check the dashboard before retrying.'))
        } finally {
          setBusy(false)
        }
      },
      modal: {
        ondismiss: () => setBusy(false),
      },
    })
    checkout.on('payment.failed', (event) => {
      setError(event.error?.description || 'The test payment did not complete. You can try again.')
      setBusy(false)
    })
    checkout.open()
  }

  let formattedAmount
  try {
    formattedAmount = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100)
  } catch {
    formattedAmount = `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <section className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-7 shadow-sm sm:p-9">
        <p className="text-sm font-semibold text-emerald-700">Razorpay test checkout</p>
        <h1 className="mt-2 text-2xl font-bold text-slate-950">
          {paid ? 'Test payment confirmed' : 'Complete demo payment'}
        </h1>
        {paid ? (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">Razorpay confirmed the test payment. The backend has sent the transaction to the fraud model.</p>
            <Link className="mt-6 inline-flex rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white" to="/">Return to dashboard</Link>
          </>
        ) : (
          <>
            <p className="mt-3 text-sm leading-6 text-slate-600">Amount: <strong className="text-slate-900">{formattedAmount}</strong>. Test mode simulates payment and does not move real money.</p>
            {!validSession && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">This checkout link is incomplete or expired. Return to the dashboard and start again.</p>}
            {isLoading && <p className="mt-5 text-sm text-slate-500">Loading Razorpay checkout…</p>}
            {!isLoading && !scriptReady && <p className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Razorpay checkout could not load. Check your internet connection and refresh this page.</p>}
            {error && <p className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800" role="alert">{error}</p>}
            <button className="mt-6 w-full rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" disabled={!validSession || !scriptReady || busy} onClick={openCheckout} type="button">
              {busy ? 'Waiting for payment…' : 'Continue to secure test checkout'}
            </button>
            <Link className="mt-4 block text-center text-sm font-medium text-slate-600 underline" to="/">Cancel and return</Link>
          </>
        )}
      </section>
    </main>
  )
}
