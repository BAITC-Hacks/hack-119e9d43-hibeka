"""Read a summary of the local hackathon dataset."""

from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import BaseModel, Field

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


class DatasetError(Exception):
    """The local dataset is missing or cannot be read."""


class DataSummary(BaseModel):
    nodes_count: int = Field(ge=0)
    edges_count: int = Field(ge=0)
    transactions_count: int = Field(ge=0)
    total_amount_kzt: float = Field(ge=0, allow_inf_nan=False)


def load_summary(data_dir: Path = DATA_DIR) -> DataSummary:
    columns = {
        "nodes.parquet": ["gid"],
        "edges.parquet": ["src", "dst"],
        "transactions.parquet": ["sum_kzt"],
    }
    tables = {}
    for filename, selected_columns in columns.items():
        path = data_dir / filename
        if not path.is_file():
            raise DatasetError(f"Не найден файл data/{filename}.")
        try:
            tables[filename] = pq.read_table(path, columns=selected_columns)
        except (pa.ArrowInvalid, pa.ArrowNotImplementedError, OSError) as exc:
            raise DatasetError(
                f"Не удалось прочитать data/{filename}. "
                "Проверьте формат Parquet и обязательные столбцы."
            ) from exc

    amounts = tables["transactions.parquet"]["sum_kzt"]
    if not (
        pa.types.is_integer(amounts.type)
        or pa.types.is_floating(amounts.type)
        or pa.types.is_decimal(amounts.type)
    ):
        raise DatasetError("Столбец sum_kzt должен содержать числовые суммы.")

    total = Decimal("0")
    for amount in amounts.to_pylist():
        try:
            value = Decimal(str(amount))
        except InvalidOperation as exc:
            raise DatasetError("В sum_kzt есть пропущенная или некорректная сумма.") from exc
        if not value.is_finite() or value < 0:
            raise DatasetError("Суммы sum_kzt должны быть конечными и неотрицательными.")
        total += value

    return DataSummary(
        nodes_count=tables["nodes.parquet"].num_rows,
        edges_count=tables["edges.parquet"].num_rows,
        transactions_count=tables["transactions.parquet"].num_rows,
        total_amount_kzt=float(total.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
    )
