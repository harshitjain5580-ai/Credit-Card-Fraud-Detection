"""Run the complete reproducible fraud-model training and evaluation workflow."""

from training.create_replay_samples import create_replay_samples
from training.evaluate_isolation_forest import (
    evaluate_isolation_forest,
    load_splits as load_anomaly_splits,
)
from training.explain import explain_model
from training.fetch_dataset import fetch_dataset
from training.finalize_model import finalize_model, load_splits as load_final_splits
from training.prepare_data import prepare_data
from training.train_compare import compare_models, load_splits


MODEL_LETTERS = {
    "A. Balanced Logistic Regression": "A",
    "B. SMOTE + Logistic Regression": "B",
    "C. XGBoost": "C",
    "D. SMOTE + XGBoost": "D",
}


def run_pipeline() -> None:
    """Verify data, compare supervised models, select on validation, then test once."""
    dataset = fetch_dataset()
    fraud_count = int(dataset["Class"].sum())
    print(
        f"\nDataset: {len(dataset):,} rows, {fraud_count:,} fraud "
        f"({fraud_count / len(dataset):.3%})"
    )

    prepare_data()
    x_train, y_train, x_validation, y_validation = load_splits()
    comparison = compare_models(x_train, y_train, x_validation, y_validation)
    best = comparison.loc[comparison["pr_auc"].idxmax()]
    model_name = MODEL_LETTERS[str(best["model"])]
    print(f"\nSelected by validation PR-AUC: {best['model']} ({best['pr_auc']:.4f})")

    # The finalizer chooses the threshold on validation and touches the test split once.
    finalize_model(*load_final_splits(), model_name=model_name)

    train, validation, test = load_anomaly_splits()
    evaluate_isolation_forest(train, validation, test)
    explain_model()
    create_replay_samples()
    print("\nTraining pipeline complete. Artifacts are in ml-service/artifacts/.")


if __name__ == "__main__":
    run_pipeline()
