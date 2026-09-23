"""Load and validate the local hackathon dataset."""

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import BaseModel, Field

from backend.app.validation import DatasetError, SCHEMAS, ValidationResult, validate_tables

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


@dataclass(frozen=True)
class ValidatedDataset:
    tables: dict[str, pa.Table]
    validation: ValidationResult


class ValidationInfo(BaseModel):
    status: Literal["passed"] = "passed"
    warnings: list[str]


class DataSummary(BaseModel):
    nodes_count: int = Field(ge=0)
    edges_count: int = Field(ge=0)
    transactions_count: int = Field(ge=0)
    total_amount_kzt: float = Field(ge=0, allow_inf_nan=False)
    validation: ValidationInfo


def load_dataset(data_dir: Path = DATA_DIR) -> ValidatedDataset:
    tables = {}
    for filename in SCHEMAS:
        path = data_dir / filename
        if not path.is_file():
            raise DatasetError(f"Не найден файл data/{filename}.")
        try:
            tables[filename] = pq.read_table(path)
        except (pa.ArrowInvalid, pa.ArrowNotImplementedError, OSError) as exc:
            raise DatasetError(
                f"Не удалось прочитать data/{filename}. "
                "Проверьте формат Parquet и обязательные столбцы."
            ) from exc

    result = validate_tables(tables)
    return ValidatedDataset(tables=tables, validation=result)


def load_summary(data_dir: Path = DATA_DIR) -> DataSummary:
    dataset = load_dataset(data_dir)
    tables = dataset.tables
    result = dataset.validation
    return DataSummary(
        nodes_count=tables["nodes.parquet"].num_rows,
        edges_count=tables["edges.parquet"].num_rows,
        transactions_count=tables["transactions.parquet"].num_rows,
        total_amount_kzt=result.total_tiyn / 100,
        validation=ValidationInfo(warnings=result.warnings),
    )
