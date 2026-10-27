import hmac
import logging
import os
from contextlib import asynccontextmanager
from time import perf_counter
from typing import Annotated

import numpy as np
import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import Field

from app.model_loader import load_model_artifacts
from app.schemas import (
    ExplanationResponse,
    FeatureImpact,
    ModelInfoResponse,
    PredictionResponse,
    TransactionFeatures,
)


logger = logging.getLogger("fraud_detection_api")
FEATURE_COLUMNS = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]
MAX_BATCH_SIZE = 100


@asynccontextmanager
async def lifespan(application: FastAPI):
    model, threshold, metrics, model_version, threshold_settings = load_model_artifacts()
    application.state.model = model
    application.state.threshold = threshold
    application.state.metrics = metrics
    application.state.model_version = model_version
    application.state.threshold_settings = threshold_settings
    logger.info("Loaded fraud model version %s", model_version)
    yield


app = FastAPI(title="Fraud Detection ML Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("CLIENT_URL", "http://localhost:5173")],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-API-Key"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    started = perf_counter()
    try:
        response = await call_next(request)
    except Exception as error:
        logger.error(
            "Request failed: %s %s (%s)",
            request.method,
            request.url.path,
            type(error).__name__,
        )
        raise
    logger.info(
        "%s %s returned %s in %.2f ms",
        request.method,
        request.url.path,
        response.status_code,
        (perf_counter() - started) * 1000,
    )
    return response


def verify_api_key(
    api_key: Annotated[str | None, Header(alias="X-API-Key")] = None,
) -> None:
    expected_key = os.getenv("ML_API_KEY")
    if expected_key is not None and (
        api_key is None or not hmac.compare_digest(api_key, expected_key)
    ):
        raise HTTPException(status_code=401, detail="Invalid or missing API key.")


def make_prediction(
    features: TransactionFeatures,
    request: Request,
) -> PredictionResponse:
    row = pd.DataFrame(
        [[getattr(features, column) for column in FEATURE_COLUMNS]],
        columns=FEATURE_COLUMNS,
    )
    probability = float(request.app.state.model.predict_proba(row)[0, 1])
    threshold = request.app.state.threshold
    if probability >= threshold:
        risk_label = "HIGH"
    elif probability >= threshold / 2:
        risk_label = "MEDIUM"
    else:
        risk_label = "LOW"
    return PredictionResponse(
        fraud_probability=probability,
        risk_label=risk_label,
        is_fraud=probability >= threshold,
        threshold=threshold,
        model_version=request.app.state.model_version,
    )


def make_explanation(
    features: TransactionFeatures,
    request: Request,
) -> ExplanationResponse:
    """Return TreeSHAP impacts for XGBoost or exact coefficient impacts for logistic regression."""
    model = request.app.state.model
    steps = getattr(model, "named_steps", {})
    classifier = steps.get("classifier")
    preprocessor = steps.get("preprocessing")
    if classifier is None or preprocessor is None:
        raise HTTPException(
            status_code=501,
            detail="This model does not support local feature explanations.",
        )

    row = pd.DataFrame(
        [[getattr(features, column) for column in FEATURE_COLUMNS]],
        columns=FEATURE_COLUMNS,
    )
    transformed = preprocessor.transform(row)
    feature_names = list(preprocessor.get_feature_names_out())
    if hasattr(classifier, "get_booster"):
        from xgboost import DMatrix

        contributions = classifier.get_booster().predict(
            DMatrix(transformed), pred_contribs=True
        )[0]
        baseline_log_odds = float(contributions[-1])
        feature_impacts = contributions[:-1]
        explanation_method = "tree_shap"
    elif hasattr(classifier, "coef_") and hasattr(classifier, "intercept_"):
        # For logistic regression, coefficient * transformed input is the exact
        # feature contribution to the fraud-class log-odds.
        feature_impacts = np.asarray(transformed)[0] * classifier.coef_[0]
        baseline_log_odds = float(classifier.intercept_[0])
        explanation_method = "linear_coefficients"
    else:
        raise HTTPException(
            status_code=501,
            detail="This model does not support local feature explanations.",
        )

    if len(feature_impacts) != len(feature_names):
        raise HTTPException(
            status_code=503,
            detail="The model could not produce a complete explanation.",
        )

    impacts = [
        FeatureImpact(
            feature=name,
            value=float(getattr(features, name)),
            impact=float(impact),
            direction="increases_risk" if impact >= 0 else "decreases_risk",
        )
        for name, impact in zip(feature_names, feature_impacts, strict=True)
    ]
    top_factors = sorted(impacts, key=lambda item: abs(item.impact), reverse=True)[:5]
    prediction = make_prediction(features, request)
    return ExplanationResponse(
        fraud_probability=prediction.fraud_probability,
        threshold=prediction.threshold,
        model_version=prediction.model_version,
        method=explanation_method,
        baseline_log_odds=baseline_log_odds,
        top_factors=top_factors,
    )


@app.get("/health")
async def health(request: Request) -> dict[str, str | bool]:
    return {
        "status": "model_loaded",
        "model_loaded": hasattr(request.app.state, "model"),
        "model_version": getattr(request.app.state, "model_version", ""),
    }


@app.get(
    "/model-info",
    response_model=ModelInfoResponse,
    dependencies=[Depends(verify_api_key)],
)
async def model_info(request: Request) -> ModelInfoResponse:
    metrics = request.app.state.metrics
    threshold_settings = request.app.state.threshold_settings
    return ModelInfoResponse(
        model_version=request.app.state.model_version,
        threshold=request.app.state.threshold,
        min_precision=threshold_settings["min_precision"],
        trained_at=metrics["trained_at"],
        metrics={
            name: metrics[name]
            for name in (
                "precision",
                "recall",
                "f1",
                "roc_auc",
                "pr_auc",
                "confusion_matrix",
            )
        },
    )


@app.post(
    "/predict",
    response_model=PredictionResponse,
    dependencies=[Depends(verify_api_key)],
)
async def predict(
    features: TransactionFeatures,
    request: Request,
) -> PredictionResponse:
    return make_prediction(features, request)


@app.post(
    "/explain",
    response_model=ExplanationResponse,
    dependencies=[Depends(verify_api_key)],
)
async def explain(
    features: TransactionFeatures,
    request: Request,
) -> ExplanationResponse:
    return make_explanation(features, request)


@app.post(
    "/predict/batch",
    response_model=list[PredictionResponse],
    dependencies=[Depends(verify_api_key)],
)
async def predict_batch(
    transactions: Annotated[
        list[TransactionFeatures],
        Field(min_length=1, max_length=MAX_BATCH_SIZE),
    ],
    request: Request,
) -> list[PredictionResponse]:
    return [make_prediction(transaction, request) for transaction in transactions]
