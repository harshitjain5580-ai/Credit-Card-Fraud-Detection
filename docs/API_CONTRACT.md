# API Contract

This document defines the request and response shapes used by the Fraud Detection Payment Dashboard. JSON values shown below are illustrative; field names and types define the contract.

## Base URL and conventions

- Configure the API base URL with `VITE_API_URL`.
- Local base URL: `http://localhost:5000`.
- Every endpoint path below starts with `/api`.
- Requests and responses use JSON.
- Protected endpoints require `Authorization: Bearer <token>`. The token is returned by registration or login.
- Errors use this shape: `{ "error": { "message": "...", "code": "..." } }`.
- `401` means unauthenticated, `422` means invalid input, and `429` means rate limited.
- The Python API rate-limits general API traffic to 600 requests per 15 minutes per client address; login/registration and simulation each allow 10 requests per 15 minutes.
- Responses use `id`, not `_id`, and never include the 30 model input features.

## Transaction

| Field | Type / values |
| --- | --- |
| `id` | string |
| `createdAt` | ISO date-time string |
| `displayAmount` | number in major currency units, such as `49.99` |
| `currency` | lowercase currency code, such as `inr` or `usd` |
| `source` | `razorpay`, `simulated`, or `stripe` for historical records |
| `fraudProbability` | number from `0` to `1`, or `null` when unscored |
| `riskLabel` | `LOW`, `MEDIUM`, `HIGH`, or `UNSCORED` |
| `isFlagged` | boolean |
| `scoringStatus` | `scored` or `pending_review` |
| `modelVersion` | string, such as `xgb-v1` |
| `reviewDecision` | `null`, `confirmed_fraud`, or `legit` |
| `stripePaymentIntentId` | string or `null` |
| `razorpayPaymentId` | string or `null` |

## Endpoints

### Authentication

#### `POST /api/auth/register` - public

Request:

```json
{
  "name": "Avery Merchant",
  "email": "avery@example.com",
  "password": "at-least-8-characters"
}
```

`password` must be at least 8 characters. Response status is `201`.

```json
{
  "token": "<jwt>",
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

#### `POST /api/auth/login` - public

Request:

```json
{
  "email": "avery@example.com",
  "password": "password"
}
```

Response:

```json
{
  "token": "<jwt>",
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

#### `GET /api/auth/me` - token required

Response:

```json
{
  "user": {
    "id": "user-id",
    "name": "Avery Merchant",
    "email": "avery@example.com",
    "role": "<role>"
  }
}
```

### Transactions

#### `POST /api/predictions/batch` - token required

Scores 1–100 transactions without saving them. Each item must contain exactly `Time`, `V1` through `V28`, and `Amount`, matching the ML model input; all values must be finite and `Amount` must be non-negative. The optional dataset label `Class` must not be sent.

Request:

```json
{
  "transactions": [
    { "Time": 0, "V1": 0, "V2": 0, "V3": 0, "V4": 0, "V5": 0, "V6": 0, "V7": 0, "V8": 0, "V9": 0, "V10": 0, "V11": 0, "V12": 0, "V13": 0, "V14": 0, "V15": 0, "V16": 0, "V17": 0, "V18": 0, "V19": 0, "V20": 0, "V21": 0, "V22": 0, "V23": 0, "V24": 0, "V25": 0, "V26": 0, "V27": 0, "V28": 0, "Amount": 49.99 }
  ]
}
```

Response:

```json
{
  "count": 1,
  "items": [
    {
      "index": 0,
      "fraudProbability": 0.12,
      "riskLabel": "HIGH",
      "isFlagged": true,
      "threshold": 0.0795,
      "modelVersion": "xgboost-v1"
    }
  ]
}
```

`index` is zero-based in the submitted list. The result contains no input features, and predictions are not persisted.

#### `GET /api/transactions` - token required

Query parameters:

- `page` (default `1`)
- `limit` (default `20`)
- `riskLabel`
- `flagged` (`true` to show flagged transactions)
- `from` and `to` (ISO dates)

Results are newest first.

```json
{
  "items": [
    {
      "id": "transaction-id",
      "createdAt": "2026-10-25T12:30:00.000Z",
      "displayAmount": 49.99,
      "currency": "usd",
      "source": "razorpay",
      "fraudProbability": 0.12,
      "riskLabel": "LOW",
      "isFlagged": false,
      "scoringStatus": "scored",
      "modelVersion": "xgb-v1",
      "reviewDecision": null,
      "stripePaymentIntentId": null,
      "razorpayPaymentId": "pay_example"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

#### `GET /api/transactions/stats` - token required

```json
{
  "total": 100,
  "flagged": 8,
  "fraudRate": 0.08,
  "avgProbability": 0.12,
  "byRisk": {
    "LOW": 80,
    "MEDIUM": 12,
    "HIGH": 8,
    "UNSCORED": 0
  },
  "series24h": [
    { "t": "2026-10-25T12:00:00.000Z", "total": 4, "flagged": 1 }
  ],
  "series30d": [
    { "t": "2026-10-25T00:00:00.000Z", "total": 12, "flagged": 2 }
  ]
}
```

`fraudRate` and `avgProbability` are numbers from `0` to `1`. `series24h` is hourly and `series30d` is daily; `t` is an ISO date-time string.

#### `GET /api/transactions/score-histogram` - token required

Returns 10 score bins spanning `0.0` to `1.0`.

```json
{
  "bins": [
    { "from": 0.0, "to": 0.1, "count": 12 }
  ]
}
```

#### `POST /api/transactions/simulate` - token required

Request `count` is from `1` to `50`; `mode` is `random` or `fraud`.

```json
{
  "count": 1,
  "mode": "random"
}
```

Response:

```json
{
  "created": 1,
  "items": [
    {
      "id": "transaction-id",
      "createdAt": "2026-10-25T12:30:00.000Z",
      "displayAmount": 49.99,
      "currency": "usd",
      "source": "simulated",
      "fraudProbability": 0.12,
      "riskLabel": "LOW",
      "isFlagged": false,
      "scoringStatus": "scored",
      "modelVersion": "xgb-v1",
      "reviewDecision": null,
      "stripePaymentIntentId": null,
      "razorpayPaymentId": null
    }
  ]
}
```

#### `PATCH /api/transactions/:id/review` - token required

Request `decision` is `confirmed_fraud` or `legit`.

```json
{
  "decision": "confirmed_fraud"
}
```

Response is the updated `Transaction` object.

#### `GET /api/transactions/:id/explanation` - token required

Returns the top five feature impacts for a scored transaction owned by the authenticated merchant. The response does not expose the transaction's full model input. XGBoost uses TreeSHAP; logistic regression uses exact coefficient contributions. `impact` is in log-odds: positive increases the model's fraud score and negative lowers it. A transaction without a completed model score returns `409`.

```json
{
  "transactionId": "transaction-id",
  "fraudProbability": 0.91,
  "threshold": 0.0795,
  "modelVersion": "xgboost-v1",
  "method": "tree_shap",
  "baselineLogOdds": -4.2,
  "topFactors": [
    {
      "feature": "V14",
      "value": -2.5,
      "impact": 3.1,
      "direction": "increases_risk"
    }
  ]
}
```

Each `topFactors` item has `feature` (string), `value` (number), `impact` (number), and `direction` (`increases_risk` or `decreases_risk`). These are model explanations, not proof that a transaction is fraudulent.

### Payments

#### `POST /api/payments/checkout-session` - token required

Request `amount` is at least `1`, `currency` is `inr`, and `mode` is `normal` or `fraud-demo`. The active payment integration uses Razorpay test-mode orders. The returned URL opens the dashboard's Razorpay Checkout screen; it is not a Stripe URL.

```json
{
  "amount": 1,
  "currency": "inr",
  "mode": "normal"
}
```

Response (the browser navigates to `url`):

```json
{
  "url": "https://dashboard.example.com/checkout?order_id=...&key_id=...&amount=100&currency=INR&session_token=..."
}
```

The API creates a Razorpay Order server-side and stores its merchant, amount, currency, and demo mode. `key_id` is the public Razorpay key ID; `session_token` is a short-lived signed checkout token. Keep the Razorpay secret only on the API server. The API accepts only captured payments after verifying both the Razorpay checkout signature and payment status.

For this demo, checkout does not supply the anonymized PCA model inputs, so a replay row from the training dataset supplies those features. The recorded amount and provider IDs come from the captured test payment; the resulting fraud score is a demonstration, not a risk judgment about a real cardholder.

#### `POST /api/payments/verify` - signed checkout session

Razorpay Checkout sends the following fields to the client handler. The backend verifies the signed session, payment signature, order ownership, amount, currency, and captured status before recording and scoring a transaction.

Request:

```json
{
  "sessionToken": "<short-lived-checkout-token>",
  "razorpay_payment_id": "pay_example",
  "razorpay_order_id": "order_example",
  "razorpay_signature": "<razorpay-signature>"
}
```

Response:

```json
{
  "transaction": {
    "id": "transaction-id",
    "createdAt": "2026-10-25T12:30:00.000Z",
    "displayAmount": 1,
    "currency": "inr",
    "source": "razorpay",
    "fraudProbability": 0.12,
    "riskLabel": "LOW",
    "isFlagged": false,
    "scoringStatus": "scored",
    "modelVersion": "xgboost-v1",
    "reviewDecision": null,
    "stripePaymentIntentId": null,
    "razorpayPaymentId": "pay_example"
  }
}
```

#### `POST /api/webhooks/razorpay` - Razorpay webhook

Configure the test-mode Razorpay webhook to send `payment.captured` events to this path. The API validates `X-Razorpay-Signature` against the raw request body and is idempotent by Razorpay payment ID. Webhooks are the reliable background path; checkout also verifies captured state immediately for the user-facing result.

### Model information and alerts

#### `GET /api/model-info` - token required

```json
{
  "model_version": "xgb-v1",
  "threshold": 0.5,
  "min_precision": 0.9,
  "trained_at": "2026-10-25T12:30:00.000Z",
  "metrics": {
    "precision": 0.91,
    "recall": 0.84,
    "f1": 0.87,
    "roc_auc": 0.96,
    "pr_auc": 0.73,
    "confusion_matrix": [[980, 20], [8, 42]]
  }
}
```

#### `GET /api/alerts/unread-count` - token required

Returns the number of flagged transactions that have not been reviewed.

```json
{
  "count": 3
}
```
# API Contract (source of truth for frontend and backend)

- Base URL: VITE_API_URL (local: http://localhost:5000). Every path below starts with /api. JSON only.
- Protected routes need the header Authorization: Bearer <token> (token comes from login/register).
- Errors always look like {"error":{"message":"...","code":"..."}}. Status 401 = not logged in (UI goes to /login), 422 = bad input, 429 = too many requests.
- The API returns id (not _id) and never returns the 30 model features.

## Transaction object

- id: string
- createdAt: ISO date string
- displayAmount: number (major units, e.g. 49.99)
- currency: string, e.g. "usd"
- source: "razorpay" or "simulated" (old Stripe records may still be returned as "stripe")
- fraudProbability: number 0 to 1, or null when UNSCORED
- riskLabel: "LOW" | "MEDIUM" | "HIGH" | "UNSCORED"
- isFlagged: boolean
- scoringStatus: "scored" or "pending_review" (ML service was down)
- modelVersion: string, e.g. "xgb-v1"
- reviewDecision: null | "confirmed_fraud" | "legit"
- stripePaymentIntentId: string or null (legacy records)
- razorpayPaymentId: string or null

## Endpoints

### POST /auth/register [auth: public]

Request: `{name, email, password (min 8)}`

Response: `201 {token, user}` where user = `{id, name, email, role}`

### POST /auth/login [auth: public]

Request: `{email, password}`

Response: `{token, user}`

### GET /auth/me [auth: token]

Request:

Fraud Detection Dashboard  |  Module A (ML + Backend) Page 6  
PROMPT T0.1 - Write the API contract file

Response: `{user}`

### GET /transactions [auth: token]

Request: query: page (1), limit (20), riskLabel, flagged (true), from, to (ISO dates). Newest first.

Response: `{items: [Transaction], page, limit, total}`

### GET /transactions/stats [auth: token]

Request:

Response: `{total, flagged, fraudRate (0-1), avgProbability (0-1), byRisk: {LOW, MEDIUM, HIGH, UNSCORED}, series24h: [{t, total, flagged}], series30d: [{t, total, flagged}]} (t = ISO date; hourly for 24h, daily for 30d)`

### GET /transactions/score-histogram [auth: token]

Request:

Response: `{bins: [{from, to, count}]}` (10 bins from 0.0 to 1.0)

### POST /transactions/simulate [auth: token]

Request: `{count (1-50), mode: "random" | "fraud"}`

Response: `{created, items: [Transaction]}`

### PATCH /transactions/:id/review [auth: token]

Request: `{decision: "confirmed_fraud" | "legit"}`

Response: `Transaction (updated)`

### POST /predictions/batch [auth: token]

Request: `{transactions: [TransactionFeatures]}` (1–100 entries; each has `Time`, `V1`–`V28`, `Amount`)

Response: `{count, items: [{index, fraudProbability, riskLabel, isFlagged, threshold, modelVersion}]}`. Inputs are not saved and the output does not repeat model features.

### GET /transactions/:id/explanation [auth: token]

Returns merchant-scoped feature impacts for a scored transaction; pending-review transactions return 409. XGBoost uses TreeSHAP and logistic regression uses exact coefficients. Impacts are in log-odds, where positive increases and negative lowers the model score.

Response: `{transactionId, fraudProbability, threshold, modelVersion, method, baselineLogOdds, topFactors: [{feature, value, impact, direction: "increases_risk" | "decreases_risk"}]}` where `method` is `tree_shap` or `linear_coefficients`.

### POST /payments/checkout-session [auth: token]

Request: `{amount (>= 1), currency ("inr"), mode: "normal" | "fraud-demo"}`

Response: `{url}` (browser opens the app's Razorpay test checkout page)

### POST /payments/verify [auth: signed checkout token]

Request: `{sessionToken, razorpay_payment_id, razorpay_order_id, razorpay_signature}`

Response: `{transaction}` after the backend verifies the captured Razorpay payment.

### POST /webhooks/razorpay [auth: Razorpay HMAC signature]

Accepts Razorpay `payment.captured` events and stores them idempotently.

### GET /model-info [auth: token]

Request:

Response: `{model_version, threshold, min_precision, trained_at, metrics: {precision, recall, f1, roc_auc, pr_auc, confusion_matrix: [[tn, fp], [fn, tp]]}}`

### GET /alerts/unread-count [auth: token]

Request:

Response: `{count}` (flagged transactions not yet reviewed)

Rule: nobody changes this file silently. If a shape must change, update this file, commit, and message the other person
