"""Fetch and verify the public ULB credit-card fraud dataset from OpenML."""

from __future__ import annotations

import hashlib
from pathlib import Path
from urllib.request import Request, urlopen

import pandas as pd
import numpy as np
from scipy.io import arff


SERVICE_DIR = Path(__file__).resolve().parents[1]
DATA_PATH = SERVICE_DIR / "data" / "creditcard.csv"
DATASET_URL = "https://openml.org/data/v1/download/1673544/creditcard.arff"
DATASET_MD5 = "178bcf9bb1f31a3dfe12d0e577884add"
EXPECTED_ROWS = 284_807
EXPECTED_FRAUDS = 492
FEATURE_COLUMNS = ["Time", *[f"V{i}" for i in range(1, 29)], "Amount"]
EXPECTED_COLUMNS = [*FEATURE_COLUMNS, "Class"]


def _validate_dataset(frame: pd.DataFrame) -> None:
    if list(frame.columns) != EXPECTED_COLUMNS:
        raise ValueError("Dataset columns must match the expected 30 features followed by Class.")
    missing = [column for column in EXPECTED_COLUMNS if column not in frame.columns]
    if missing:
        raise ValueError(f"Dataset is missing required columns: {', '.join(missing)}")
    if len(frame) != EXPECTED_ROWS:
        raise ValueError(f"Expected {EXPECTED_ROWS:,} rows, found {len(frame):,}.")
    if frame[EXPECTED_COLUMNS].isna().any().any():
        raise ValueError("Dataset contains missing feature values or labels.")
    numeric = frame[EXPECTED_COLUMNS].apply(pd.to_numeric, errors="raise")
    if not np.isfinite(numeric.to_numpy(dtype=float)).all():
        raise ValueError("Dataset contains infinite feature values or labels.")
    labels = set(numeric["Class"].unique())
    if labels != {0, 1}:
        raise ValueError("Class must contain only the labels 0 and 1.")
    fraud_count = int(numeric["Class"].sum())
    if fraud_count != EXPECTED_FRAUDS:
        raise ValueError(f"Expected {EXPECTED_FRAUDS} fraud rows, found {fraud_count}.")


def _convert_arff(source_path: Path, output_path: Path) -> pd.DataFrame:
    rows, _metadata = arff.loadarff(source_path)
    frame = pd.DataFrame(rows)
    for column in frame.select_dtypes(include=["object"]).columns:
        frame[column] = frame[column].map(
            lambda value: value.decode("utf-8") if isinstance(value, bytes) else value
        )
    frame["Class"] = pd.to_numeric(frame["Class"], errors="raise").astype(int)
    frame = frame[EXPECTED_COLUMNS]
    _validate_dataset(frame)

    staged_output = output_path.with_suffix(".csv.tmp")
    frame.to_csv(staged_output, index=False)
    staged_output.replace(output_path)
    return frame


def fetch_dataset(
    output_path: Path = DATA_PATH,
    url: str = DATASET_URL,
    expected_md5: str = DATASET_MD5,
) -> pd.DataFrame:
    """Download the canonical public dataset, verify it, and save a local CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if output_path.is_file():
        existing = pd.read_csv(output_path)
        _validate_dataset(existing)
        return existing

    staged_arff = output_path.with_suffix(".arff.download")
    digest = hashlib.md5()
    request = Request(url, headers={"User-Agent": "payment-risk-console/1.0"})
    try:
        with urlopen(request, timeout=90) as response, staged_arff.open("wb") as target:
            while chunk := response.read(1024 * 1024):
                digest.update(chunk)
                target.write(chunk)

        if digest.hexdigest().lower() != expected_md5.lower():
            raise ValueError(
                "The downloaded dataset checksum did not match the published OpenML checksum."
            )
        return _convert_arff(staged_arff, output_path)
    finally:
        staged_arff.unlink(missing_ok=True)


def main() -> None:
    dataset = fetch_dataset()
    print(
        f"Verified ULB credit-card fraud dataset: {len(dataset):,} rows, "
        f"{int(dataset['Class'].sum()):,} fraud ({DATA_PATH})"
    )


if __name__ == "__main__":
    main()
