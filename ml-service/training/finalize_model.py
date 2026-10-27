"""Select a validation threshold, then evaluate and save one final model."""

from datetime import date, datetime, timezone
import json
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
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
    build_models,
)


MODEL_NAME = "C"  # Standalone default; run_pipeline selects by validation PR-AUC.
MIN_PRECISION = 0.80
MODEL_VERSION = {
    "A": "logistic-regression-v1",
    "B": "smote-logistic-regression-v1",
    "C": "xgboost-v1",
    "D": "smote-xgboost-v1",
}


def load_splits(
    data_dir: Path = DATA_DIR,
) -> tuple[pd.DataFrame, pd.Series, pd.DataFrame, pd.Series, pd.DataFrame, pd.Series]:
    """Load the saved splits needed for fitting, threshold selection, and one test."""
    splits = {
        name: pd.read_csv(data_dir / f"{filename}.csv")
        for name, filename in (
            ("train", "train"),
            ("validation", "val"),
            ("test", "test"),
        )
    }

    for name, split in splits.items():
        missing = [column for column in [*FEATURE_COLUMNS, LABEL_COLUMN] if column not in split]
        if missing:
            raise ValueError(f"{name} data is missing required columns: {', '.join(missing)}")
        if split.empty:
            raise ValueError(f"{name} data contains no rows.")
        if split[[*FEATURE_COLUMNS, LABEL_COLUMN]].isna().any().any():
            raise ValueError(f"{name} data contains missing feature values or labels.")
        if not set(split[LABEL_COLUMN].unique()).issubset({0, 1}):
            raise ValueError(f"{name} labels must be binary values 0 and 1.")
        if split[LABEL_COLUMN].nunique() != 2:
            raise ValueError(f"{name} data must contain both classes.")

    train = splits["train"]
    validation = splits["validation"]
    test = splits["test"]
    return (
        train[FEATURE_COLUMNS],
        train[LABEL_COLUMN].astype(int),
        validation[FEATURE_COLUMNS],
        validation[LABEL_COLUMN].astype(int),
        test[FEATURE_COLUMNS],
        test[LABEL_COLUMN].astype(int),
    )


def choose_threshold(
    y_validation: pd.Series,
    validation_probabilities: np.ndarray,
    min_precision: float,
) -> tuple[float, np.ndarray, np.ndarray, np.ndarray, int]:
    """Pick the lowest validation threshold satisfying the precision floor."""
    precision, recall, thresholds = precision_recall_curve(
        y_validation, validation_probabilities
    )
    eligible = np.flatnonzero(precision[:-1] >= min_precision)
    if len(eligible) == 0:
        raise ValueError(
            f"No validation threshold achieves the minimum precision "
            f"of {min_precision:.2f}."
        )
    selected_index = int(eligible[0])
    return (
        float(thresholds[selected_index]),
        precision,
        recall,
        thresholds,
        selected_index,
    )


def print_threshold_tradeoff(
    precision: np.ndarray,
    recall: np.ndarray,
    thresholds: np.ndarray,
    selected_index: int,
) -> None:
    """Print up to five validation operating points around the selected one."""
    start = max(0, selected_index - 2)
    end = min(len(thresholds), selected_index + 3)
    if end - start < 5:
        start = max(0, end - 5)
    end = min(len(thresholds), start + 5)

    print("\nValidation precision/recall around the selected threshold:")
    print(" threshold  precision  recall")
    for index in range(start, end):
        marker = "  <- selected" if index == selected_index else ""
        print(
            f"{thresholds[index]:10.6f}  "
            f"{precision[index]:9.4f}  {recall[index]:6.4f}{marker}"
        )


def save_confusion_matrix_plot(matrix: np.ndarray, output_path: Path) -> None:
    """Save a labeled heatmap of the final test confusion matrix."""
    figure, axis = plt.subplots(figsize=(6, 5))
    image = axis.imshow(matrix, cmap="Blues")
    figure.colorbar(image, ax=axis, label="Transaction count")
    axis.set(
        xticks=[0, 1],
        yticks=[0, 1],
        xticklabels=["Genuine", "Fraud"],
        yticklabels=["Genuine", "Fraud"],
        xlabel="Predicted class",
        ylabel="Actual class",
        title="Test confusion matrix",
    )
    for row in range(2):
        for column in range(2):
            axis.text(
                column,
                row,
                f"{matrix[row, column]:,}",
                ha="center",
                va="center",
                color="white" if matrix[row, column] > matrix.max() / 2 else "black",
            )
    figure.tight_layout()
    figure.savefig(output_path, dpi=150)
    plt.close(figure)


def finalize_model(
    x_train: pd.DataFrame,
    y_train: pd.Series,
    x_validation: pd.DataFrame,
    y_validation: pd.Series,
    x_test: pd.DataFrame,
    y_test: pd.Series,
    artifacts_dir: Path = ARTIFACTS_DIR,
    model_name: str = MODEL_NAME,
    min_precision: float = MIN_PRECISION,
) -> dict[str, object]:
    """Fit the chosen pipeline, select its threshold, and evaluate test data once."""
    if model_name not in MODEL_VERSION:
        raise ValueError("MODEL_NAME must be one of A, B, C, or D.")
    if not 0 < min_precision <= 1:
        raise ValueError("MIN_PRECISION must be greater than 0 and at most 1.")

    model = build_models(y_train)[
        {
            "A": "A. Balanced Logistic Regression",
            "B": "B. SMOTE + Logistic Regression",
            "C": "C. XGBoost",
            "D": "D. SMOTE + XGBoost",
        }[model_name]
    ]
    model.fit(x_train, y_train)

    validation_probabilities = model.predict_proba(x_validation)[:, 1]
    threshold, precision, recall, thresholds, selected_index = choose_threshold(
        y_validation, validation_probabilities, min_precision
    )
    print_threshold_tradeoff(precision, recall, thresholds, selected_index)

    # Test probabilities are computed once, after the model and threshold are fixed.
    test_probabilities = model.predict_proba(x_test)[:, 1]
    test_predictions = (test_probabilities >= threshold).astype(int)
    matrix = confusion_matrix(y_test, test_predictions, labels=[0, 1])
    metrics: dict[str, object] = {
        "model": model_name,
        "model_version": MODEL_VERSION[model_name],
        "threshold": threshold,
        "min_precision": min_precision,
        "precision": float(
            precision_score(y_test, test_predictions, zero_division=0)
        ),
        "recall": float(recall_score(y_test, test_predictions, zero_division=0)),
        "f1": float(f1_score(y_test, test_predictions, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, test_probabilities)),
        "pr_auc": float(average_precision_score(y_test, test_probabilities)),
        "confusion_matrix": matrix.tolist(),
        "split_sizes": {
            "train": int(len(y_train)),
            "validation": int(len(y_validation)),
            "test": int(len(y_test)),
        },
        "dataset": {
            "name": "ULB/Kaggle Credit Card Fraud Detection",
            "rows": int(len(y_train) + len(y_validation) + len(y_test)),
            "fraud_rows": int(y_train.sum() + y_validation.sum() + y_test.sum()),
            "fraud_rate": float(
                (y_train.sum() + y_validation.sum() + y_test.sum())
                / (len(y_train) + len(y_validation) + len(y_test))
            ),
        },
        "date": date.today().isoformat(),
        "trained_at": datetime.now(timezone.utc).isoformat(),
    }

    artifacts_dir.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, artifacts_dir / "model.joblib")
    (artifacts_dir / "threshold.json").write_text(
        json.dumps(
            {"threshold": threshold, "min_precision": min_precision},
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (artifacts_dir / "metrics.json").write_text(
        json.dumps(metrics, indent=2) + "\n",
        encoding="utf-8",
    )
    save_confusion_matrix_plot(matrix, artifacts_dir / "confusion_matrix.png")

    print("\nTest confusion matrix (rows=actual, columns=predicted):")
    print(matrix)
    print("\nTest metrics:")
    for name in ("precision", "recall", "f1", "roc_auc", "pr_auc"):
        print(f"{name}: {metrics[name]:.4f}")
    print(f"threshold: {threshold:.6f}")
    print(f"model_version: {metrics['model_version']}")
    print(f"date: {metrics['date']}")

    return metrics


def main() -> None:
    if MODEL_NAME not in MODEL_VERSION:
        raise ValueError("Set MODEL_NAME at the top of this file to A, B, C, or D.")
    splits = load_splits()
    sizes = {
        "train": len(splits[1]),
        "validation": len(splits[3]),
        "test": len(splits[5]),
    }
    print(f"Selected model: {MODEL_NAME} ({MODEL_VERSION[MODEL_NAME]})")
    print(f"Split sizes: {sizes}")
    finalize_model(*splits)


if __name__ == "__main__":
    main()
