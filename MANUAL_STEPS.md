# Manual Setup and Deployment Checklist

This checklist covers actions that require a person to use hosting accounts, supply secrets, or coordinate with the team. Never put real secrets in source control or share them in chat.

## Current deployment status (checked 2026-10-27)

- Render has one active service: the static demo at `credit-card-fraud-detection-demo.onrender.com`, currently sourced from `Chiraag-Aggarwal/Credit-Card-Fraud-Detection` on `main` (live commit `5e39464`).
- The updated code is in `harshitjain5580-ai/Credit-Card-Fraud-Detection`. The Render source picker currently lists only the Chiraag repository, so connect the updated repository before enabling automatic deployment from it.
- The active Render workspace has no deployed API or ML service yet. The static demo therefore remains in mock mode; real login, storage, scoring, and payment are not live.

## Before deployment

- [ ] Choose hosting providers for the ML service and backend, and create the required accounts.
- [ ] Create a MongoDB Atlas database and allow the backend host to connect to it.
- [ ] Rotate the MongoDB database-user password shown in the earlier setup screenshot, then update the connection string in the API host secrets.
- [ ] Prepare the production environment values listed below. Store them in each hosting provider's secret/environment-variable settings, not in committed files.
- [ ] Coordinate with the frontend developer so they can configure the backend URL in the deployed client.

## Deploy in this order

1. [ ] Deploy `/ml-service` as a Python web service; wait for `/health` to report `model_loaded` and record its public base URL.
2. [ ] Deploy `/server` as a Python web service. Set root directory to `server`, build command to `pip install -r requirements.txt`, and start command to `uvicorn app.main:app --host 0.0.0.0 --port $PORT`. Set `ML_SERVICE_URL` to the ML service URL from step 1.
3. [ ] Send the deployed backend URL to the frontend developer.
4. [ ] Deploy `/client` with `VITE_API_URL` set to the backend URL and `VITE_USE_MOCK=false`.
5. [ ] Set the backend's `CLIENT_URL` to the deployed client URL, then redeploy/restart the backend.
6. [ ] In Razorpay's test-mode dashboard, create a webhook endpoint pointing to `<backend URL>/api/webhooks/razorpay` and subscribe to `payment.captured`.
7. [ ] Copy the webhook secret you set into `RAZORPAY_WEBHOOK_SECRET`, then redeploy/restart the backend.

## Backend environment variables

Set these in the backend host's environment settings:

- `PORT` — port supplied by the hosting provider.
- `MONGODB_URI` — MongoDB Atlas connection string.
- `JWT_SECRET` — a long, randomly generated secret.
- `CLIENT_URL` — exact deployed client origin.
- `ML_SERVICE_URL` — deployed ML service base URL.
- `ML_API_KEY` — key shared with the ML service configuration.
- `ML_TIMEOUT_MS` — request timeout in milliseconds; keep it configurable because free hosts may take 30+ seconds to wake after idle.
- `RAZORPAY_KEY_ID` — Razorpay test-mode key ID (starts with `rzp_test_`).
- `RAZORPAY_KEY_SECRET` — matching test-mode secret.
- `RAZORPAY_WEBHOOK_SECRET` — secret set for the Razorpay webhook.
- `ALLOW_LIVE_PAYMENTS=false` — keep real payments disabled for this demo.
- `MONGODB_DATABASE` — optional database name when it is not included in `MONGODB_URI`.

Use Python 3.12 for both `/ml-service` and `/server`. Do not upload or commit `data/creditcard.csv` or `data/processed`.

## Razorpay test checkout

- [ ] In Razorpay Dashboard, switch to Test Mode and create test API keys.
- [ ] Store the test key ID and secret in the API's environment variables only.
- [ ] In Razorpay Test Mode → Webhooks, add `<backend URL>/api/webhooks/razorpay` and subscribe to `payment.captured`.
- [ ] Put the webhook secret configured in Razorpay into `RAZORPAY_WEBHOOK_SECRET` on the API.
- [ ] Complete a Razorpay test-mode payment. Test mode simulates payments and does not move real money.

## End-to-end verification

- [ ] Open the deployed client and register/login with a test merchant.
- [ ] Confirm the dashboard loads data from the real backend (not mock data).
- [ ] Simulate transactions and confirm they appear in the dashboard.
- [ ] Confirm flagged transactions appear in the review view and can be marked as fraud or legitimate.
- [ ] Complete a Razorpay test-mode checkout and confirm one transaction is recorded for the payment.
- [ ] Confirm the unread alert count updates for unreviewed flagged transactions.
- [ ] Check backend and ML health endpoints after deployment.
- [ ] Verify that no real secrets, `.env` files, or prohibited dataset files were committed.

## Team handoff

- [x] Improve the mobile navbar layout and show a wait message for API rate limits. The backend now exposes its `Retry-After` header to the client.
- [ ] Verify the navbar on a small-screen browser and confirm the rate-limit wait time against the deployed API.
- [ ] Provide refreshed screenshots/demo materials if the team still needs them.
- [ ] Team: complete the knowledge swap and confirm who owns each remaining deployment and demo task.
