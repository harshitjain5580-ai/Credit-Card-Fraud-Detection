"""Evaluate an unsupervised anomaly detector without touching the test labels."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.metrics import (
    average_precision_score,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
)

from training.train_compare import (
    ARTIFACTS_DIR,
    DATA_DIR,
    FEATURE_COLUMNS,
    LABEL_COLUMN,
    make_preprocessor,
)


MIN_PRECISION = 0.80
RANDOM_STATE = 42


def load_splits(data_dir: Path = DATA_DIR):
    """Load the same isolated train, validation, and test splits as XGBoost."""
    splits = {
        name: pd.read_csv(data_dir / f"{filename}.csv")
        for name, filename in (("train", "train"), ("validation", "val"), ("test", "test"))
    }
    for name, frame in splits.items():
        missing = [column for column in [*FEATURE_COLUMNS, LABEL_COLUMN] if column not in frame]
        if missing or frame.empty or frame[[*FEATURE_COLUMNS, LABEL_COLUMN]].isna().any().any():
            details = f" Missing columns: {', '.join(missing)}." if missing else ""
            raise ValueError(f"{name} split is empty, incomplete, or has missing values.{details}")
        if not set(frame[LABEL_COLUMN].unique()).issubset({0, 1}):
            raise ValueError(f"{name} split labels must be binary.")
    return splits["train"], splits["validation"], splits["test"]


def _select_threshold(labels: pd.Series, scores: np.ndarray) -> tuple[float, str]:
    precision, recall, thresholds = precision_recall_curve(labels, scores)
    eligible = np.flatnonzero(precision[:-1] >= MIN_PRECISION)
    if eligible.size:
        index = int(eligible[0])
        return float(thresholds[index]), "validation recall at the 0.80 precision floor"

    denominator = precision[:-1] + recall[:-1]
    f1_values = np.divide(
        2 * precision[:-1] * recall[:-1],
        denominator,
        out=np.zeros_like(denominator),
        where=denominator > 0,
    )
    index = int(np.argmax(f1_values))
    return float(thresholds[index]), "maximum validation F1 (precision floor unavailable)"


def evaluate_isolation_forest(
    train: pd.DataFrame,
    validation: pd.DataFrame,
    test: pd.DataFrame,
    artifacts_dir: Path = ARTIFACTS_DIR,
) -> dict[str, object]:
    """Fit only on genuine training transactions and evaluate once on held-out test."""
    normal_train = train.loc[train[LABEL_COLUMN] == 0, FEATURE_COLUMNS]
    if normal_train.empty:
        raise ValueError("Isolation Forest needs genuine transactions in training data.")

    preprocessor = make_preprocessor()
    normal_features = preprocessor.fit_transform(normal_train)
    model = IsolationForest(
        n_estimators=300,
        max_samples="auto",
        contamination="auto",
        random_state=RANDOM_STATE,
        n_jobs=1,
    )
    model.fit(normal_features)

    validation_scores = -model.decision_function(
        preprocessor.transform(validation[FEATURE_COLUMNS])
    )
    threshold, selection = _select_threshold(
        validation[LABEL_COLUMN].astype(int), validation_scores
    )
    test_scores = -model.decision_function(preprocessor.transform(test[FEATURE_COLUMNS]))
    test_labels = test[LABEL_COLUMN].astype(int)
    test_predictions = (test_scores >= threshold).astype(int)
    matrix = confusion_matrix(test_labels, test_predictions, labels=[0, 1])

    metrics: dict[str, object] = {
        "model": "IsolationForest (unsupervised anomaly baseline)",
        "model_version": "isolation-forest-baseline-v1",
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "trained_on_genuine_rows": int(len(normal_train)),
        "threshold": threshold,
        "threshold_selection": selection,
        "validation_min_precision": MIN_PRECISION,
        "precision": float(precision_score(test_labels, test_predictions, zero_division=0)),
        "recall": float(recall_score(test_labels, test_predictions, zero_division=0)),
        "f1": float(f1_score(test_labels, test_predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(test_labels, test_scores)),
        "pr_auc": float(average_precision_score(test_labels, test_scores)),
        "confusion_matrix": matrix.tolist(),
        "split_sizes": {
            "train": int(len(train)),
            "validation": int(len(validation)),
            "test": int(len(test)),
        },
        "note": "Anomaly scores are not calibrated fraud probabilities; the production API continues to use the supervised model.",
    }

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    (artifacts_dir / "isolation_forest_metrics.json").write_text(
        json.dumps(metrics, indent=2) + "\n", encoding="utf-8"
    )
    print("Isolation Forest held-out test metrics:")
    for name in ("precision", "recall", "f1", "roc_auc", "pr_auc"):
        print(f"{name}: {metrics[name]:.4f}")
    print(f"threshold: {threshold:.6f} ({selection})")
    print("Confusion matrix (rows=actual, columns=predicted):")
    print(matrix)
    return metrics


def main() -> None:
    train, validation, test = load_splits()
    evaluate_isolation_forest(train, validation, test)


if __name__ == "__main__":
    main()
