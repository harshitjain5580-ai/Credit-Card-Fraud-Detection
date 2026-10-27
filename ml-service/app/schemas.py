from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class TransactionFeatures(BaseModel):
    model_config = ConfigDict(extra="forbid")

    Time: float = Field(allow_inf_nan=False)
    V1: float = Field(allow_inf_nan=False)
    V2: float = Field(allow_inf_nan=False)
    V3: float = Field(allow_inf_nan=False)
    V4: float = Field(allow_inf_nan=False)
    V5: float = Field(allow_inf_nan=False)
    V6: float = Field(allow_inf_nan=False)
    V7: float = Field(allow_inf_nan=False)
    V8: float = Field(allow_inf_nan=False)
    V9: float = Field(allow_inf_nan=False)
    V10: float = Field(allow_inf_nan=False)
    V11: float = Field(allow_inf_nan=False)
    V12: float = Field(allow_inf_nan=False)
    V13: float = Field(allow_inf_nan=False)
    V14: float = Field(allow_inf_nan=False)
    V15: float = Field(allow_inf_nan=False)
    V16: float = Field(allow_inf_nan=False)
    V17: float = Field(allow_inf_nan=False)
    V18: float = Field(allow_inf_nan=False)
    V19: float = Field(allow_inf_nan=False)
    V20: float = Field(allow_inf_nan=False)
    V21: float = Field(allow_inf_nan=False)
    V22: float = Field(allow_inf_nan=False)
    V23: float = Field(allow_inf_nan=False)
    V24: float = Field(allow_inf_nan=False)
    V25: float = Field(allow_inf_nan=False)
    V26: float = Field(allow_inf_nan=False)
    V27: float = Field(allow_inf_nan=False)
    V28: float = Field(allow_inf_nan=False)
    Amount: float = Field(ge=0, allow_inf_nan=False)


class PredictionResponse(BaseModel):
    fraud_probability: float = Field(ge=0, le=1)
    risk_label: Literal["LOW", "MEDIUM", "HIGH"]
    is_fraud: bool
    threshold: float = Field(ge=0, le=1)
    model_version: str


class ModelMetrics(BaseModel):
    precision: float
    recall: float
    f1: float
    roc_auc: float
    pr_auc: float
    confusion_matrix: list[list[int]]


class ModelInfoResponse(BaseModel):
    model_version: str
    threshold: float = Field(ge=0, le=1)
    min_precision: float = Field(ge=0, le=1)
    trained_at: str
    metrics: ModelMetrics


class FeatureImpact(BaseModel):
    feature: str
    value: float
    impact: float
    direction: Literal["increases_risk", "decreases_risk"]


class ExplanationResponse(BaseModel):
    fraud_probability: float = Field(ge=0, le=1)
    threshold: float = Field(ge=0, le=1)
    model_version: str
    method: Literal["tree_shap", "linear_coefficients"]
    baseline_log_odds: float
    top_factors: list[FeatureImpact]
