"""FastAPI backend for the fraud dashboard; MongoDB is the system of record."""

from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
import logging
import math
import os
from pathlib import Path
import random
import threading
import time
from urllib.parse import urlencode
import uuid

import httpx
import jwt
from bson import ObjectId
from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pymongo import MongoClient, ReturnDocument
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv

from app.schemas import (
    BatchInput,
    CheckoutInput,
    LoginInput,
    PaymentVerification,
    RegisterInput,
    ReviewInput,
    SimulateInput,
    TransactionFeatures,
)
from app.security import current_user, hash_password, issue_token, jwt_secret, public_user, verify_password


load_dotenv(Path(__file__).resolve().parents[1] / ".env")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("fraud_dashboard_api")
RISK_LABELS = ("LOW", "MEDIUM", "HIGH", "UNSCORED")
API_ROOT = "https://api.razorpay.com/v1"
REPLAY_PATH = Path(__file__).resolve().parents[1] / "data" / "replay_samples.json"
with REPLAY_PATH.open(encoding="utf-8") as sample_file:
    REPLAY_SAMPLES = json.load(sample_file)
_rate_limit_lock = threading.Lock()
_rate_limit_windows: dict[tuple[str, str], tuple[float, int]] = {}


def fail(status: int, message: str, code: str) -> None:
    raise HTTPException(status_code=status, detail={"message": message, "code": code})


def mongo_id(value: str) -> ObjectId:
    if not ObjectId.is_valid(value):
        fail(422, "Transaction id is invalid.", "VALIDATION_ERROR")
    return ObjectId(value)


def serialize_transaction(item: dict) -> dict:
    return {
        "id": str(item.get("_id", item.get("id"))),
        "createdAt": item["createdAt"].astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
        "displayAmount": item["displayAmount"],
        "currency": item["currency"],
        "source": item["source"],
        "fraudProbability": item.get("fraudProbability"),
        "riskLabel": item.get("riskLabel", "UNSCORED"),
        "isFlagged": bool(item.get("isFlagged", False)),
        "scoringStatus": item.get("scoringStatus", "pending_review"),
        "modelVersion": item.get("modelVersion", ""),
        "reviewDecision": item.get("reviewDecision"),
        "stripePaymentIntentId": item.get("stripePaymentIntentId"),
        "razorpayPaymentId": item.get("razorpayPaymentId"),
    }


def utc_bucket(value: datetime, unit: str) -> datetime:
    value = value.astimezone(timezone.utc)
    if unit == "hour":
        return value.replace(minute=0, second=0, microsecond=0)
    return value.replace(hour=0, minute=0, second=0, microsecond=0)


def build_series(rows: list[dict], start: datetime, count: int, unit: str) -> list[dict]:
    lookup = {row["_id"].astimezone(timezone.utc): row for row in rows}
    result = []
    for offset in range(count):
        timestamp = start + (timedelta(hours=offset) if unit == "hour" else timedelta(days=offset))
        row = lookup.get(timestamp)
        result.append({
            "t": timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
            "total": row["total"] if row else 0,
            "flagged": row["flagged"] if row else 0,
        })
    return result


def ml_call(method: str, path: str, payload=None):
    base = os.getenv("ML_SERVICE_URL", "").rstrip("/")
    if not base:
        raise RuntimeError("ML_SERVICE_URL is not configured.")
    headers = {}
    if os.getenv("ML_API_KEY"):
        headers["X-API-Key"] = os.environ["ML_API_KEY"]
    timeout = float(os.getenv("ML_TIMEOUT_MS", "60000")) / 1000
    last_error = None
    for attempt in range(2):
        try:
            response = httpx.request(method, f"{base}{path}", json=payload, headers=headers, timeout=timeout)
            response.raise_for_status()
            return response.json()
        except (httpx.HTTPError, ValueError) as error:
            last_error = error
            if isinstance(error, httpx.HTTPStatusError) and error.response.status_code < 500:
                break
            if attempt:
                break
    raise RuntimeError("The ML service is unavailable.") from last_error


def score_transaction(features: dict) -> dict:
    result = ml_call("POST", "/predict", features)
    probability = result.get("fraud_probability")
    if (
        not isinstance(probability, (int, float))
        or not math.isfinite(probability)
        or not 0 <= probability <= 1
        or result.get("risk_label") not in {"LOW", "MEDIUM", "HIGH"}
        or not isinstance(result.get("is_fraud"), bool)
    ):
        raise RuntimeError("The ML service returned an invalid score.")
    return result


def pick_sample(fraud: bool | None = None) -> dict:
    pool = REPLAY_SAMPLES if fraud is None else [row for row in REPLAY_SAMPLES if row.get("Class") == int(fraud)]
    if not pool:
        raise RuntimeError("The training replay dataset has no matching rows.")
    return random.choice(pool)


def save_scored_transaction(request: Request, data: dict) -> dict:
    features = data["features"]
    common = {
        "features": features,
        "displayAmount": float(data["displayAmount"]),
        "currency": data["currency"].lower(),
        "source": data["source"],
        "merchantId": data["merchantId"],
        "groundTruthLabel": data.get("groundTruthLabel"),
        "createdAt": datetime.now(timezone.utc),
        "status": "captured" if data["source"] == "razorpay" else "simulated",
        **{
            key: data[key]
            for key in ("razorpayOrderId", "razorpayPaymentId", "razorpayEventId")
            if data.get(key) is not None
        },
    }
    try:
        prediction = score_transaction(features)
        record = {
            **common,
            "fraudProbability": float(prediction["fraud_probability"]),
            "riskLabel": prediction["risk_label"],
            "isFlagged": prediction["is_fraud"],
            "scoringStatus": "scored",
            "modelVersion": prediction.get("model_version", ""),
        }
    except Exception as error:
        logger.warning("ML scoring unavailable; sending transaction for manual review (%s).", type(error).__name__)
        record = {
            **common,
            "fraudProbability": None,
            "riskLabel": "UNSCORED",
            "isFlagged": True,
            "scoringStatus": "pending_review",
            "modelVersion": "",
        }
    try:
        result = request.app.state.db.transactions.insert_one(record)
        record["_id"] = result.inserted_id
    except DuplicateKeyError:
        record = request.app.state.db.transactions.find_one({"razorpayPaymentId": data.get("razorpayPaymentId")})
    if record and (record["riskLabel"] == "HIGH" or record["scoringStatus"] == "pending_review"):
        logger.warning("Fraud alert for merchant %s: transaction %s requires attention.", data["merchantId"], record["_id"])
    return record


def payment_signature_is_valid(order_id: str, payment_id: str, signature: str) -> bool:
    secret = os.getenv("RAZORPAY_KEY_SECRET", "")
    expected = hmac.new(secret.encode(), f"{order_id}|{payment_id}".encode(), hashlib.sha256).hexdigest()
    return bool(secret) and hmac.compare_digest(expected, signature)


def resolve_captured_payment(request: Request, payment: dict, event_id: str | None = None) -> dict | None:
    order_id = payment.get("order_id")
    payment_id = payment.get("id")
    if not order_id or not payment_id:
        return None
    existing = request.app.state.db.transactions.find_one({"razorpayPaymentId": payment_id})
    if existing:
        return existing
    checkout = request.app.state.db.payment_checkouts.find_one({"razorpayOrderId": order_id})
    if not checkout or payment.get("status") != "captured":
        return None
    amount = payment.get("amount")
    currency = str(payment.get("currency", "")).lower()
    if amount != checkout["amountPaise"] or currency != checkout["currency"]:
        logger.error("Razorpay payment amount or currency did not match its order.")
        return None
    sample = pick_sample(fraud=checkout["mode"] == "fraud-demo" if checkout["mode"] == "fraud-demo" else None)
    features = {key: float(value) for key, value in sample.items() if key != "Class"}
    return save_scored_transaction(request, {
        "features": features,
        "displayAmount": amount / 100,
        "currency": currency,
        "source": "razorpay",
        "merchantId": checkout["merchantId"],
        "groundTruthLabel": sample.get("Class"),
        "razorpayOrderId": order_id,
        "razorpayPaymentId": payment_id,
        "razorpayEventId": event_id,
    })


@asynccontextmanager
async def lifespan(application: FastAPI):
    uri = os.getenv("MONGODB_URI", "").strip()
    if not uri:
        raise RuntimeError("MONGODB_URI must be configured before starting the API.")
    jwt_secret()
    client = MongoClient(uri, serverSelectionTimeoutMS=10000, tz_aware=True)
    client.admin.command("ping")
    database_name = os.getenv("MONGODB_DATABASE")
    database = client[database_name] if database_name else client.get_default_database()
    if database is None:
        client.close()
        raise RuntimeError("MONGODB_URI must include a database name or set MONGODB_DATABASE.")
    application.state.mongo = client
    application.state.db = database
    database.users.create_index("email", unique=True)
    database.transactions.create_index([("merchantId", 1), ("createdAt", -1)])
    database.transactions.create_index("razorpayPaymentId", unique=True, sparse=True)
    database.payment_checkouts.create_index("razorpayOrderId", unique=True)
    database.payment_checkouts.create_index("expiresAt", expireAfterSeconds=0)
    logger.info("Python API connected to MongoDB database %s", database.name)
    yield
    client.close()


app = FastAPI(title="Fraud Detection API", version="2.0.0", lifespan=lifespan)
client_origin = os.getenv("CLIENT_URL", "http://localhost:5173").rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[client_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Razorpay-Signature"],
)


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_request: Request, error: RequestValidationError):
    return JSONResponse(status_code=422, content={"error": {"message": "Request validation failed.", "code": "VALIDATION_ERROR"}})


@app.exception_handler(HTTPException)
async def http_error_handler(_request: Request, error: HTTPException):
    detail = error.detail if isinstance(error.detail, dict) else {"message": str(error.detail), "code": "REQUEST_ERROR"}
    return JSONResponse(status_code=error.status_code, content={"error": detail}, headers=error.headers)


@app.exception_handler(Exception)
async def generic_error_handler(_request: Request, error: Exception):
    logger.exception("Unhandled API error (%s)", type(error).__name__)
    return JSONResponse(status_code=500, content={"error": {"message": "The server could not complete the request.", "code": "INTERNAL_ERROR"}})


@app.middleware("http")
async def security_headers(request: Request, call_next):
    if request.url.path.startswith("/api/") and request.method != "OPTIONS":
        now = time.monotonic()
        client_ip = request.client.host if request.client else "unknown"
        limits = [("api", 600, 15 * 60)]
        if request.url.path in {"/api/auth/login", "/api/auth/register"}:
            limits.append(("auth", 10, 15 * 60))
        if request.url.path == "/api/transactions/simulate":
            limits.append(("simulate", 10, 15 * 60))
        retry_after = None
        with _rate_limit_lock:
            for bucket, limit, window_seconds in limits:
                key = (client_ip, bucket)
                started, count = _rate_limit_windows.get(key, (now, 0))
                if now - started >= window_seconds:
                    started, count = now, 0
                if count >= limit:
                    retry_after = max(1, int(window_seconds - (now - started)))
                    break
                _rate_limit_windows[key] = (started, count + 1)
            if len(_rate_limit_windows) > 5000:
                expired_keys = [
                    key for key, state in _rate_limit_windows.items()
                    if now - state[0] >= 15 * 60
                ]
                for key in expired_keys:
                    _rate_limit_windows.pop(key, None)
        if retry_after is not None:
            headers = {"Retry-After": str(retry_after)}
            if request.headers.get("origin") == client_origin:
                headers["Access-Control-Allow-Origin"] = client_origin
                headers["Access-Control-Allow-Credentials"] = "true"
            response = JSONResponse(
                status_code=429,
                content={"error": {"message": "Too many requests. Please wait and try again.", "code": "RATE_LIMITED"}},
                headers=headers,
            )
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "same-origin"
            return response
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    return response


@app.get("/health")
def health(request: Request):
    database_ready = hasattr(request.app.state, "db")
    return {"status": "ok" if database_ready else "starting", "database": database_ready}


@app.post("/api/auth/register", status_code=201)
def register(body: RegisterInput, request: Request):
    user = {
        "name": body.name.strip(),
        "email": str(body.email).lower(),
        "passwordHash": hash_password(body.password),
        "role": "merchant",
        "createdAt": datetime.now(timezone.utc),
    }
    try:
        result = request.app.state.db.users.insert_one(user)
    except DuplicateKeyError:
        fail(409, "An account with this email already exists.", "EMAIL_EXISTS")
    user["_id"] = result.inserted_id
    return {"token": issue_token(str(result.inserted_id), user["role"]), "user": public_user(user)}


@app.post("/api/auth/login")
def login(body: LoginInput, request: Request):
    user = request.app.state.db.users.find_one({"email": str(body.email).lower()})
    if not user or not verify_password(body.password, user.get("passwordHash", "")):
        fail(401, "Email or password is incorrect.", "INVALID_CREDENTIALS")
    return {"token": issue_token(str(user["_id"]), user.get("role", "merchant")), "user": public_user(user)}


@app.get("/api/auth/me")
def me(user: dict = Depends(current_user)):
    return {"user": public_user(user)}


@app.post("/api/predictions/batch")
def batch_predictions(body: BatchInput, _user: dict = Depends(current_user)):
    try:
        results = ml_call("POST", "/predict/batch", [row.model_dump() for row in body.transactions])
        if not isinstance(results, list) or len(results) != len(body.transactions):
            raise RuntimeError("ML response did not match the submitted batch.")
        items = []
        for index, result in enumerate(results):
            probability = float(result["fraud_probability"])
            if not math.isfinite(probability) or not 0 <= probability <= 1:
                raise RuntimeError("ML service returned an invalid prediction.")
            items.append({
                "index": index,
                "fraudProbability": probability,
                "riskLabel": result["risk_label"],
                "isFlagged": bool(result["is_fraud"]),
                "threshold": float(result["threshold"]),
                "modelVersion": result["model_version"],
            })
        return {"count": len(items), "items": items}
    except Exception as error:
        logger.warning("Batch prediction failed (%s).", type(error).__name__)
        fail(503, "The fraud scoring service is unavailable.", "ML_UNAVAILABLE")


@app.get("/api/transactions")
def list_transactions(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    riskLabel: str | None = Query(None, pattern="^(LOW|MEDIUM|HIGH|UNSCORED)$"),
    flagged: bool | None = Query(None),
    from_date: str | None = Query(None, alias="from"),
    to_date: str | None = Query(None, alias="to"),
    user: dict = Depends(current_user),
):
    filters: dict = {"merchantId": user["_id"]}
    if riskLabel:
        filters["riskLabel"] = riskLabel
    if flagged is not None:
        filters["isFlagged"] = flagged
    created = {}
    for supplied, operator in ((from_date, "$gte"), (to_date, "$lte")):
        if supplied:
            try:
                parsed = datetime.fromisoformat(supplied.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                created[operator] = parsed.astimezone(timezone.utc)
            except ValueError:
                fail(422, "Date filters must be ISO date-time strings.", "VALIDATION_ERROR")
    if "$gte" in created and "$lte" in created and created["$gte"] > created["$lte"]:
        fail(422, "The from date must be before the to date.", "VALIDATION_ERROR")
    if created:
        filters["createdAt"] = created
    collection = request.app.state.db.transactions
    total = collection.count_documents(filters)
    documents = collection.find(filters).sort("createdAt", -1).skip((page - 1) * limit).limit(limit)
    return {"items": [serialize_transaction(item) for item in documents], "page": page, "limit": limit, "total": total}


@app.get("/api/transactions/stats")
def transaction_stats(request: Request, user: dict = Depends(current_user)):
    collection = request.app.state.db.transactions
    merchant = {"merchantId": user["_id"]}
    summary_rows = list(collection.aggregate([
        {"$match": merchant},
        {"$group": {
            "_id": None,
            "total": {"$sum": 1},
            "flagged": {"$sum": {"$cond": ["$isFlagged", 1, 0]}},
            "avgProbability": {"$avg": "$fraudProbability"},
            **{label: {"$sum": {"$cond": [{"$eq": ["$riskLabel", label]}, 1, 0]}} for label in RISK_LABELS},
        }},
    ]))
    summary = summary_rows[0] if summary_rows else {}
    now = datetime.now(timezone.utc)
    hourly_start = utc_bucket(now, "hour") - timedelta(hours=23)
    daily_start = utc_bucket(now, "day") - timedelta(days=29)
    def series(start: datetime, unit: str, count: int):
        rows = list(collection.aggregate([
            {"$match": {**merchant, "createdAt": {"$gte": start}}},
            {"$group": {
                "_id": {"$dateTrunc": {"date": "$createdAt", "unit": unit, "timezone": "UTC"}},
                "total": {"$sum": 1},
                "flagged": {"$sum": {"$cond": ["$isFlagged", 1, 0]}},
            }},
            {"$sort": {"_id": 1}},
        ]))
        return build_series(rows, start, count, unit)
    total = int(summary.get("total", 0))
    flagged_count = int(summary.get("flagged", 0))
    return {
        "total": total,
        "flagged": flagged_count,
        "fraudRate": flagged_count / total if total else 0,
        "avgProbability": summary.get("avgProbability") or 0,
        "byRisk": {label: int(summary.get(label, 0)) for label in RISK_LABELS},
        "series24h": series(hourly_start, "hour", 24),
        "series30d": series(daily_start, "day", 30),
    }


@app.get("/api/transactions/score-histogram")
def score_histogram(request: Request, user: dict = Depends(current_user)):
    counts = [0] * 10
    for probability in request.app.state.db.transactions.find(
        {"merchantId": user["_id"], "fraudProbability": {"$ne": None}},
        {"fraudProbability": 1},
    ):
        index = min(9, int(float(probability["fraudProbability"]) * 10))
        counts[index] += 1
    return {"bins": [{"from": index / 10, "to": (index + 1) / 10, "count": counts[index]} for index in range(10)]}


@app.post("/api/transactions/simulate", status_code=201)
def simulate(body: SimulateInput, request: Request, user: dict = Depends(current_user)):
    created = []
    for _ in range(body.count):
        sample = pick_sample(fraud=True if body.mode == "fraud" else None)
        features = {key: float(value) for key, value in sample.items() if key != "Class"}
        created.append(save_scored_transaction(request, {
            "features": features,
            "displayAmount": features["Amount"],
            "currency": "inr",
            "source": "simulated",
            "merchantId": user["_id"],
            "groundTruthLabel": sample.get("Class"),
        }))
    return {"created": len(created), "items": [serialize_transaction(item) for item in created]}


@app.patch("/api/transactions/{transaction_id}/review")
def review(transaction_id: str, body: ReviewInput, request: Request, user: dict = Depends(current_user)):
    updated = request.app.state.db.transactions.find_one_and_update(
        {"_id": mongo_id(transaction_id), "merchantId": user["_id"]},
        {"$set": {"reviewDecision": body.decision}},
        return_document=ReturnDocument.AFTER,
    )
    if not updated:
        fail(404, "Transaction was not found.", "NOT_FOUND")
    return serialize_transaction(updated)


@app.get("/api/transactions/{transaction_id}/explanation")
def explanation(transaction_id: str, request: Request, user: dict = Depends(current_user)):
    item = request.app.state.db.transactions.find_one({"_id": mongo_id(transaction_id), "merchantId": user["_id"]})
    if not item:
        fail(404, "Transaction was not found.", "NOT_FOUND")
    if item.get("scoringStatus") != "scored" or not item.get("features"):
        fail(409, "This transaction has no model score to explain.", "NOT_SCORED")
    try:
        result = ml_call("POST", "/explain", item["features"])
    except Exception:
        fail(503, "The fraud explanation service is unavailable.", "ML_UNAVAILABLE")
    return {
        "transactionId": str(item["_id"]),
        "fraudProbability": result["fraud_probability"],
        "threshold": result["threshold"],
        "modelVersion": result["model_version"],
        "method": result["method"],
        "baselineLogOdds": result["baseline_log_odds"],
        "topFactors": result["top_factors"],
    }


@app.get("/api/model-info")
def model_info(_user: dict = Depends(current_user)):
    try:
        return ml_call("GET", "/model-info")
    except Exception:
        fail(503, "The fraud scoring service is unavailable.", "ML_UNAVAILABLE")


@app.get("/api/alerts/unread-count")
def unread_count(request: Request, user: dict = Depends(current_user)):
    count = request.app.state.db.transactions.count_documents({
        "merchantId": user["_id"],
        "isFlagged": True,
        "reviewDecision": None,
    })
    return {"count": count}


@app.post("/api/payments/checkout-session")
def checkout_session(body: CheckoutInput, request: Request, user: dict = Depends(current_user)):
    key_id = os.getenv("RAZORPAY_KEY_ID", "").strip()
    key_secret = os.getenv("RAZORPAY_KEY_SECRET", "").strip()
    allow_live = os.getenv("ALLOW_LIVE_PAYMENTS", "false").lower() == "true"
    if not key_id or not key_secret:
        fail(503, "Razorpay test credentials are not configured.", "PAYMENTS_UNAVAILABLE")
    if not key_id.startswith("rzp_test_") and not allow_live:
        fail(503, "Live payment credentials are disabled for this demo.", "LIVE_PAYMENTS_DISABLED")
    if body.currency != "inr":
        fail(422, "This Razorpay demo checkout accepts INR only.", "VALIDATION_ERROR")
    amount_paise = round(body.amount * 100)
    if not math.isclose(body.amount * 100, amount_paise, rel_tol=0, abs_tol=1e-7):
        fail(422, "Amount must have no more than two decimal places.", "VALIDATION_ERROR")
    try:
        response = httpx.post(
            f"{API_ROOT}/orders",
            auth=(key_id, key_secret),
            json={
                "amount": amount_paise,
                "currency": "INR",
                "receipt": uuid.uuid4().hex[:40],
                "notes": {"merchantId": str(user["_id"]), "demoMode": body.mode},
            },
            timeout=15,
        )
        response.raise_for_status()
        order = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Razorpay order creation failed (%s).", type(error).__name__)
        fail(502, "Razorpay could not create a checkout order.", "PAYMENT_PROVIDER_ERROR")
    order_id = order.get("id")
    if not order_id:
        fail(502, "Razorpay returned an invalid order.", "PAYMENT_PROVIDER_ERROR")
    now = datetime.now(timezone.utc)
    session_expires = now + timedelta(minutes=20)
    request.app.state.db.payment_checkouts.insert_one({
        "razorpayOrderId": order_id,
        "merchantId": user["_id"],
        "amountPaise": amount_paise,
        "currency": "inr",
        "mode": body.mode,
        # Retain an order long enough for delayed provider webhook retries.
        "expiresAt": now + timedelta(days=90),
        "createdAt": now,
    })
    checkout_token = jwt.encode({
        "sub": str(user["_id"]),
        "type": "checkout",
        "order_id": order_id,
        "amount": amount_paise,
        "currency": "inr",
        "exp": session_expires,
    }, jwt_secret(), algorithm="HS256")
    query = urlencode({
        "order_id": order_id,
        "key_id": key_id,
        "amount": amount_paise,
        "currency": "INR",
        "session_token": checkout_token,
    })
    return {"url": f"{os.getenv('CLIENT_URL', 'http://localhost:5173').rstrip('/')}/checkout?{query}"}


@app.post("/api/payments/verify")
def verify_payment(body: PaymentVerification, request: Request):
    try:
        session = jwt.decode(body.sessionToken, jwt_secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        fail(401, "Checkout session is invalid or expired.", "INVALID_CHECKOUT_SESSION")
    order_id = body.razorpay_order_id
    if session.get("type") != "checkout" or session.get("order_id") != order_id:
        fail(401, "Payment does not match the checkout session.", "INVALID_CHECKOUT_SESSION")
    checkout = request.app.state.db.payment_checkouts.find_one({
        "razorpayOrderId": order_id,
        "merchantId": ObjectId(session["sub"]),
    })
    if not checkout or checkout["expiresAt"] < datetime.now(timezone.utc):
        fail(410, "Checkout session has expired. Start a new payment.", "CHECKOUT_EXPIRED")
    if session.get("amount") != checkout["amountPaise"] or session.get("currency") != checkout["currency"]:
        fail(401, "Checkout session does not match its stored order.", "INVALID_CHECKOUT_SESSION")
    if not payment_signature_is_valid(order_id, body.razorpay_payment_id, body.razorpay_signature):
        fail(400, "Razorpay payment signature is invalid.", "INVALID_PAYMENT_SIGNATURE")
    try:
        response = httpx.get(
            f"{API_ROOT}/payments/{body.razorpay_payment_id}",
            auth=(os.getenv("RAZORPAY_KEY_ID", ""), os.getenv("RAZORPAY_KEY_SECRET", "")),
            timeout=15,
        )
        response.raise_for_status()
        payment = response.json()
    except (httpx.HTTPError, ValueError) as error:
        logger.warning("Razorpay payment verification fetch failed (%s).", type(error).__name__)
        fail(502, "Could not confirm payment status with Razorpay.", "PAYMENT_PROVIDER_ERROR")
    if payment.get("order_id") != order_id:
        fail(400, "Razorpay payment does not belong to this order.", "INVALID_PAYMENT")
    if payment.get("status") != "captured":
        fail(409, "Razorpay has not marked this payment captured yet.", "PAYMENT_NOT_CAPTURED")
    saved = resolve_captured_payment(request, payment)
    if not saved:
        fail(409, "Captured payment details did not match the checkout order.", "PAYMENT_MISMATCH")
    return {"transaction": serialize_transaction(saved)}


@app.post("/api/webhooks/razorpay")
async def razorpay_webhook(request: Request, signature: str | None = Header(default=None, alias="X-Razorpay-Signature")):
    secret = os.getenv("RAZORPAY_WEBHOOK_SECRET", "")
    if not secret:
        fail(503, "Razorpay webhook secret is not configured.", "WEBHOOK_UNAVAILABLE")
    raw_body = await request.body()
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    if not signature or not hmac.compare_digest(expected, signature):
        fail(400, "Razorpay webhook signature is invalid.", "INVALID_WEBHOOK_SIGNATURE")
    try:
        event = json.loads(raw_body)
    except json.JSONDecodeError:
        fail(400, "Razorpay webhook body is invalid.", "INVALID_WEBHOOK")
    if event.get("event") != "payment.captured":
        return {"received": True}
    payment = event.get("payload", {}).get("payment", {}).get("entity", {})
    if not payment.get("id") or not payment.get("order_id"):
        fail(400, "Razorpay webhook payment payload is invalid.", "INVALID_WEBHOOK")
    event_id = request.headers.get("x-razorpay-event-id")
    existing = request.app.state.db.transactions.find_one({"razorpayPaymentId": payment["id"]})
    if existing:
        return {"received": True}
    try:
        resolve_captured_payment(request, payment, event_id)
    except DuplicateKeyError:
        return {"received": True}
    return {"received": True}


