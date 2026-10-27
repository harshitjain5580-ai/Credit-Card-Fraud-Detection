# Fraud model service

This service trains a supervised transaction classifier and a separate unsupervised anomaly baseline, then serves predictions from the selected supervised model with per-transaction TreeSHAP explanations.

## Train from the public dataset

The original dataset is intentionally not committed because it is about 150 MB. Put the supplied `creditcard.csv` at `ml-service/data/creditcard.csv`, or run `python -m training.fetch_dataset` from this folder to fetch and verify the matching public ULB/OpenML copy. The CSV is ignored by Git.

From `ml-service/`, run:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m training.run_pipeline
```

For notebooks and the existing test suite, install the optional development tools with `python -m pip install -r requirements-dev.txt`.

The pipeline validates the 284,807-row dataset, makes stratified train/validation/test splits before fitting transforms, compares balanced logistic regression and XGBoost with and without training-only SMOTE, selects by validation PR-AUC, selects a decision threshold on validation data, and reports final metrics once on the held-out test split. It also evaluates Isolation Forest using genuine training rows only, calculates global permutation importance, and creates a small labeled replay set from held-out test rows for the dashboard simulator.

## Model artifacts

`artifacts/model.joblib`, `threshold.json`, and `metrics.json` are the live supervised model and its decision settings. The comparison CSV, precision-recall chart, confusion matrix, and feature-importance chart document the model selection. `isolation_forest_metrics.json` is a research baseline; its anomaly scores are not calibrated fraud probabilities and are not used by the API's production prediction path.

Latest held-out results from the supplied dataset:

| Model | Threshold | Precision | Recall | F1 | ROC-AUC | PR-AUC |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| XGBoost (selected on validation PR-AUC) | 0.0795 | 0.8300 | 0.8384 | 0.8342 | 0.9700 | 0.8652 |
| Isolation Forest (unsupervised baseline) | 0.1648* | 0.2099 | 0.1717 | 0.1889 | 0.9551 | 0.1126 |

`*` The Isolation Forest precision target could not be met on validation, so its threshold maximizes validation F1 instead. The XGBoost test confusion matrix is `[[56846, 17], [16, 83]]` (rows: actual genuine/fraud; columns: predicted genuine/fraud). Its threshold was selected on validation to meet a minimum precision of 0.80; the test split was kept separate. These results describe a randomized holdout of a historical dataset, not current real-world performance.

The FastAPI app exposes `/health`, `/predict`, `/predict/batch`, `/explain`, and `/model-info`. The dashboard's batch analyzer accepts up to 100 CSV rows and does not persist them. The `/explain` route returns the five strongest TreeSHAP contributions for XGBoost, or exact coefficient contributions for logistic regression, in log-odds. Since V1–V28 are anonymized PCA components, an explanation describes model behavior, not a human-readable cause or proof of fraud.

## Data limits

The ULB/Kaggle dataset contains anonymized transactions from two days in 2013, with 492 fraud rows among 284,807 total rows. It is useful for a reproducible demonstration, but it is not representative of current card traffic or a production merchant's data. Mock dashboard mode does not call this service.
