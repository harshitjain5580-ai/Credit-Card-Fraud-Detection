# Fraud Detection Payment Dashboard

A real-time fraud-scoring dashboard for online payments. The application sends payment features to a machine-learning service, stores the score with the transaction, and gives merchants tools to review flagged activity.

## How it works

1. A Stripe `payment_intent.succeeded` webhook reaches the Express backend.
2. The backend sends the transaction's model features to the FastAPI scoring service.
3. The ML service returns a fraud probability, risk label, and model version.
4. The backend saves the result in MongoDB and exposes merchant-scoped APIs to the dashboard.

Stripe does not provide the dataset's 30 anonymized PCA features. For Stripe test payments, the backend uses features from a replay sample while using the real payment's amount and Stripe IDs.

If the ML service is unavailable, the backend saves the transaction for manual review rather than failing the payment workflow.

## Project structure

| Directory | Purpose |
| --- | --- |
| `client/` | React dashboard built with Vite, React Router, Axios, and Recharts |
| `server/` | Express API, MongoDB persistence, authentication, Stripe integration, and alerts |
| `ml-service/` | FastAPI fraud scoring API and trained model artifacts |
| `docs/API_CONTRACT.md` | API paths and request/response contract |
| `MANUAL_STEPS.md` | Human steps for hosting, secrets, Stripe setup, and deployment verification |

## Prerequisites

- Node.js compatible with the Vite version in `client/package.json`.
- Python 3.11 for the ML service (see `ml-service/.python-version`).
- A MongoDB instance, local or MongoDB Atlas.
- Stripe test-mode credentials for checkout and webhook testing.

## Run locally

Run each service in a separate terminal. Start MongoDB first.

### 1. ML service

From the repository root:

```powershell
cd ml-service
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The service loads the trained model, threshold, and metrics from `ml-service/artifacts/` at startup. Check `http://127.0.0.1:8000/health`.

### 2. Backend

In a second terminal:

```powershell
cd server
npm ci
Copy-Item .env.example .env
```

Edit `server/.env` and provide the required `MONGODB_URI`, `JWT_SECRET` (at least 32 characters), `CLIENT_URL`, `ML_SERVICE_URL`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET`. For local development, use `CLIENT_URL=http://localhost:5173` and `ML_SERVICE_URL=http://localhost:8000`. `PORT` defaults to `5000`; `ML_TIMEOUT_MS` defaults to `5000`.

If you enable ML API-key protection, configure the same private `ML_API_KEY` value for the ML service process and the backend. Keep real credentials only in local environment files or the hosting provider's secret settings; do not commit `.env`.

Start the backend:

```powershell
npm run dev
```

Check `http://localhost:5000/health`.

### 3. Frontend

In a third terminal:

```powershell
cd client
npm ci
Copy-Item .env.example .env
npm run dev
```

The example config points the client to `http://localhost:5000` and disables mock data. Open the Vite URL printed in the terminal (normally `http://localhost:5173`).

### Local Stripe webhook testing

Install and authenticate the Stripe CLI, then forward events to the local webhook:

```text
stripe listen --forward-to localhost:5000/api/webhooks/stripe
```

Set the `whsec_...` value printed by the CLI as `STRIPE_WEBHOOK_SECRET` in the backend's local `.env`, then restart the backend. The CLI signing secret is different from a deployed Stripe endpoint's secret.

## Tests and checks

```powershell
# Backend tests
cd server
npm test

# ML service tests
cd ..\ml-service
python -m pytest

# Frontend production build
cd ..\client
npm run build
```

## Data and model notes

The ML model uses the Kaggle Credit Card Fraud dataset, whose fraud class is highly imbalanced. The project evaluates models with precision, recall, F1, ROC-AUC, PR-AUC, and the confusion matrix rather than relying on accuracy alone. Training/validation/test splitting and training-only resampling/scaling are required; the decision threshold is selected using validation data.

Keep `ml-service/artifacts/` model artifacts available to the ML service. Do not commit the raw `data/creditcard.csv` dataset or generated `data/processed` files.

## Deployment

Follow [`MANUAL_STEPS.md`](./MANUAL_STEPS.md) for deployment order, required environment variables, Stripe webhook setup, and the end-to-end checklist. The API contract is documented in [`docs/API_CONTRACT.md`](./docs/API_CONTRACT.md).
