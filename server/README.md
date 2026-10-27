# Fraud Dashboard API (Python)

This is the active backend. The former Express implementation is kept under `legacy-express/` for reference; deploy and run the FastAPI app in this directory.

## Run locally

Use Python 3.12. Copy `.env.example` to `.env` and add your MongoDB URI, a JWT secret of at least 32 characters, the client URL, and the ML service URL. Payment is optional until you add Razorpay **test-mode** keys.

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload --port 5000
```

The API checks MongoDB at startup. Open `/health` to see if it is ready. API shapes and routes are documented in `../docs/API_CONTRACT.md`.

## Razorpay test payments

Add `RAZORPAY_KEY_ID` (test key ID), `RAZORPAY_KEY_SECRET`, and `RAZORPAY_WEBHOOK_SECRET` to this API's environment only. Configure a Razorpay **test-mode** webhook for `POST /api/webhooks/razorpay` and the `payment.captured` event. Keep `ALLOW_LIVE_PAYMENTS=false`; test mode does not move money. Never put a key secret in the React client or Git.
