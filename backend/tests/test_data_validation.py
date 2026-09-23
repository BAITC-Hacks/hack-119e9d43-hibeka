"""Check reconciliation failures without changing the provided dataset."""

from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException

from backend.app.data import DatasetError, load_summary
from backend.app.main import data_summary
from backend.app.validation import validate_tables

A, B, C, D = (100000000000000001 + i for i in range(4))
SCHEMAS = {
    "nodes.parquet": pa.schema([
        ("gid", pa.int64()), ("depth", pa.int64()), ("is_seed", pa.bool_()),
    ]),
    "edges.parquet": pa.schema([
        ("src", pa.int64()), ("dst", pa.int64()), ("sum_kzt", pa.float64()),
        ("n_tx", pa.int64()), ("depth", pa.int8()),
    ]),
    "transactions.parquet": pa.schema([
        ("src", pa.int64()), ("dst", pa.int64()),
        ("date", pa.date32()), ("sum_kzt", pa.float64()),
    ]),
}


class ValidationTests(unittest.TestCase):
    def setUp(self):
        self.rows = {
            "nodes.parquet": [
                {"gid": A, "depth": 0, "is_seed": True},
                {"gid": B, "depth": 1, "is_seed": False},
                {"gid": C, "depth": 4, "is_seed": False},
                {"gid": D, "depth": 0, "is_seed": True},
            ],
            "edges.parquet": [
                {"src": A, "dst": B, "sum_kzt": 100000.0, "n_tx": 2, "depth": 1},
                {"src": B, "dst": C, "sum_kzt": 40000.0, "n_tx": 1, "depth": 4},
            ],
            "transactions.parquet": [
                {"src": A, "dst": B, "date": date(2026, 7, 5), "sum_kzt": 50000.0},
                {"src": A, "dst": B, "date": date(2026, 7, 5), "sum_kzt": 50000.0},
                {"src": B, "dst": C, "date": date(2026, 7, 6), "sum_kzt": 40000.0},
            ],
        }

    def tables(self):
        return {name: pa.Table.from_pylist(rows, schema=SCHEMAS[name])
                for name, rows in self.rows.items()}

    def test_valid_data_preserves_duplicates_isolates_and_exact_gids(self):
        tables = self.tables()
        result = validate_tables(tables)
        self.assertEqual(result.total_tiyn, 14000000)
        self.assertEqual(tables["nodes.parquet"]["gid"].to_pylist(), [A, B, C, D])
        for message in ["Изолированных клиентов: 1", "Повторяющихся строк операций: 1",
                        "Клиентов на depth=4 без исходящих: 1"]:
            self.assertTrue(any(message in warning for warning in result.warnings))

    def test_each_required_column_is_checked(self):
        for name, schema in SCHEMAS.items():
            for column in schema.names:
                with self.subTest(file=name, column=column):
                    tables = self.tables()
                    tables[name] = tables[name].drop([column])
                    with self.assertRaisesRegex(DatasetError, "обязательный столбец"):
                        validate_tables(tables)

    def test_nulls_in_each_required_column_are_rejected(self):
        for name, schema in SCHEMAS.items():
            for index, field in enumerate(schema):
                with self.subTest(file=name, column=field.name):
                    tables = self.tables()
                    values = tables[name][field.name].to_pylist()
                    values[0] = None
                    tables[name] = tables[name].set_column(index, field.name, pa.array(values, type=field.type))
                    with self.assertRaisesRegex(DatasetError, "пропущенные значения"):
                        validate_tables(tables)

    def test_float_identifiers_are_rejected_in_every_file(self):
        for name, columns in [("nodes.parquet", ["gid"]), ("edges.parquet", ["src", "dst"]),
                              ("transactions.parquet", ["src", "dst"])]:
            for column in columns:
                with self.subTest(file=name, column=column):
                    tables = self.tables()
                    table = tables[name]
                    array = pa.array([float(v) for v in table[column].to_pylist()])
                    tables[name] = table.set_column(table.column_names.index(column), column, array)
                    with self.assertRaisesRegex(DatasetError, "int64"):
                        validate_tables(tables)

    def test_duplicate_gid_is_rejected(self):
        self.rows["nodes.parquet"].append(dict(self.rows["nodes.parquet"][0]))
        with self.assertRaisesRegex(DatasetError, "повторяется gid"):
            validate_tables(self.tables())

    def test_duplicate_pair_is_rejected(self):
        self.rows["edges.parquet"].append(dict(self.rows["edges.parquet"][0]))
        with self.assertRaisesRegex(DatasetError, "повторяется пара"):
            validate_tables(self.tables())

    def test_unknown_endpoints_are_rejected(self):
        for name in ["edges.parquet", "transactions.parquet"]:
            for column in ["src", "dst"]:
                with self.subTest(file=name, column=column):
                    self.setUp()
                    self.rows[name][0][column] = D + 10
                    with self.assertRaisesRegex(DatasetError, "неизвестный gid"):
                        validate_tables(self.tables())

    def test_missing_pair_is_rejected_in_both_directions(self):
        for name in ["edges.parquet", "transactions.parquet"]:
            with self.subTest(file=name):
                self.setUp()
                self.rows[name].pop()
                with self.assertRaisesRegex(DatasetError, "отсутствует в"):
                    validate_tables(self.tables())

    def test_count_mismatch_is_rejected(self):
        self.rows["edges.parquet"][0]["n_tx"] = 3
        with self.assertRaisesRegex(DatasetError, "n_tx в edges=3, в transactions=2"):
            validate_tables(self.tables())

    def test_sum_tolerance_is_absolute_even_for_large_amounts(self):
        for base in [100000.0, 1000000000.0]:
            with self.subTest(base=base):
                self.setUp()
                self.rows["transactions.parquet"][0]["sum_kzt"] = base / 2
                self.rows["transactions.parquet"][1]["sum_kzt"] = base / 2
                self.rows["edges.parquet"][0]["sum_kzt"] = base + .01
                validate_tables(self.tables())
                self.rows["edges.parquet"][0]["sum_kzt"] = base + .02
                with self.assertRaisesRegex(DatasetError, "допуск 0.01 KZT"):
                    validate_tables(self.tables())

    def test_nonpositive_and_nonfinite_amounts_are_rejected(self):
        for name in ["edges.parquet", "transactions.parquet"]:
            for amount in [0.0, -1.0, float("nan"), float("inf")]:
                with self.subTest(file=name, amount=amount):
                    self.setUp()
                    self.rows[name][0]["sum_kzt"] = amount
                    with self.assertRaisesRegex(DatasetError, "конечной и положительной"):
                        validate_tables(self.tables())

    def test_depth_and_seed_consistency(self):
        for name, column, value, message in [
            ("nodes.parquet", "depth", 5, "диапазона 0–4"),
            ("nodes.parquet", "is_seed", False, "не согласованы"),
            ("edges.parquet", "depth", 0, "диапазона 1–4"),
            ("edges.parquet", "n_tx", 0, "должна быть положительной"),
        ]:
            with self.subTest(file=name, column=column):
                self.setUp()
                self.rows[name][0][column] = value
                with self.assertRaisesRegex(DatasetError, message):
                    validate_tables(self.tables())

    def test_fractional_count_and_string_date_are_rejected(self):
        for name, column, values in [
            ("edges.parquet", "n_tx", [2.5, 1.0]),
            ("transactions.parquet", "date", ["invalid"] * 3),
        ]:
            with self.subTest(file=name, column=column):
                tables = self.tables()
                table = tables[name]
                tables[name] = table.set_column(table.column_names.index(column), column, pa.array(values))
                with self.assertRaisesRegex(DatasetError, "должен иметь тип"):
                    validate_tables(tables)

    def test_profile_deviations_are_nonblocking_warnings(self):
        for row in self.rows["transactions.parquet"][:2]:
            row["sum_kzt"] = 500.0
            row["date"] = date(2027, 1, 1)
        self.rows["edges.parquet"][0]["sum_kzt"] = 1000.0
        result = validate_tables(self.tables())
        self.assertTrue(any("ниже порога" in w for w in result.warnings))
        self.assertTrue(any("вне периода" in w for w in result.warnings))

    def test_empty_edges_and_transactions_preserve_all_nodes(self):
        self.rows["edges.parquet"] = []
        self.rows["transactions.parquet"] = []
        result = validate_tables(self.tables())
        self.assertEqual(result.total_tiyn, 0)
        self.assertTrue(any("Изолированных клиентов: 4" in w for w in result.warnings))

    def test_parquet_loader_and_missing_or_corrupt_file(self):
        with TemporaryDirectory() as directory:
            path = Path(directory)
            with self.assertRaisesRegex(DatasetError, "Не найден файл"):
                load_summary(path)
            for name, table in self.tables().items():
                pq.write_table(table, path / name)
            summary = load_summary(path)
            self.assertEqual(summary.nodes_count, 4)
            self.assertEqual(summary.transactions_count, 3)
            self.assertEqual(summary.total_amount_kzt, 140000.0)
            self.assertEqual(summary.validation.status, "passed")
            (path / "edges.parquet").write_bytes(b"not parquet")
            with self.assertRaisesRegex(DatasetError, "Не удалось прочитать"):
                load_summary(path)

    def test_invalid_dataset_is_mapped_to_http_503(self):
        with patch("backend.app.main.load_summary", side_effect=DatasetError("Суммы не совпадают")):
            with self.assertRaises(HTTPException) as error:
                data_summary()
        self.assertEqual(error.exception.status_code, 503)
        self.assertEqual(error.exception.detail, "Суммы не совпадают")


if __name__ == "__main__":
    unittest.main()
