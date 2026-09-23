"""Validate dataset structure and reconcile transfers using integer tiyn."""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP, localcontext

import pyarrow as pa


class DatasetError(Exception):
    """The local dataset is missing, unreadable, or inconsistent."""


SCHEMAS = {
    "nodes.parquet": {"gid": "id", "depth": "integer", "is_seed": "boolean"},
    "edges.parquet": {
        "src": "id", "dst": "id", "sum_kzt": "amount",
        "n_tx": "integer", "depth": "integer",
    },
    "transactions.parquet": {
        "src": "id", "dst": "id", "date": "date", "sum_kzt": "amount",
    },
}
PROFILE_START = date(2026, 7, 1)
PROFILE_END = date(2026, 7, 31)


@dataclass(frozen=True)
class ValidationResult:
    total_tiyn: int
    warnings: list[str]


def _valid_type(dtype: pa.DataType, expected: str) -> bool:
    if expected == "id":
        return pa.types.is_int64(dtype)
    if expected == "integer":
        return pa.types.is_integer(dtype)
    if expected == "boolean":
        return pa.types.is_boolean(dtype)
    if expected == "amount":
        return (pa.types.is_integer(dtype) or pa.types.is_floating(dtype)
                or pa.types.is_decimal(dtype))
    return pa.types.is_date(dtype) or pa.types.is_timestamp(dtype)


def _check_schema(table: pa.Table, filename: str) -> None:
    if len(set(table.column_names)) != len(table.column_names):
        raise DatasetError(f"{filename}: имена столбцов не должны повторяться.")
    for name, expected in SCHEMAS[filename].items():
        if name not in table.column_names:
            raise DatasetError(f"{filename}: отсутствует обязательный столбец {name}.")
        column = table[name]
        if not _valid_type(column.type, expected):
            label = "int64 без преобразования в float" if expected == "id" else expected
            raise DatasetError(f"{filename}: столбец {name} должен иметь тип {label}.")
        if column.null_count:
            raise DatasetError(f"{filename}: столбец {name} содержит пропущенные значения.")


def _to_tiyn(amount: int | float | Decimal, location: str) -> int:
    value = Decimal(str(amount))
    if not value.is_finite() or value <= 0:
        raise DatasetError(f"{location}: sum_kzt должна быть конечной и положительной.")
    with localcontext() as context:
        context.prec = max(38, len(value.as_tuple().digits) + max(value.adjusted(), 0) + 3)
        return int(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) * 100)


def _format_kzt(tiyn: int) -> str:
    return f"{tiyn // 100}.{tiyn % 100:02d}"


def validate_tables(tables: dict[str, pa.Table]) -> ValidationResult:
    for filename in SCHEMAS:
        if filename not in tables:
            raise DatasetError(f"Отсутствует таблица {filename}.")
        _check_schema(tables[filename], filename)
    try:
        rows = {name: table.select(list(SCHEMAS[name])).to_pylist()
                for name, table in tables.items() if name in SCHEMAS}
    except (ValueError, OverflowError, pa.ArrowInvalid) as exc:
        raise DatasetError("Не удалось прочитать значения таблиц; проверьте даты и типы.") from exc

    nodes = rows["nodes.parquet"]
    gids = set()
    for row in nodes:
        gid = row["gid"]
        if gid in gids:
            raise DatasetError(f"nodes.parquet: повторяется gid {gid}.")
        gids.add(gid)
        if not 0 <= row["depth"] <= 4:
            raise DatasetError(f"nodes.parquet: depth клиента {gid} вне диапазона 0–4.")
        if row["is_seed"] != (row["depth"] == 0):
            raise DatasetError(f"nodes.parquet: is_seed и depth клиента {gid} не согласованы.")

    edges = {}
    in_graph = set()
    senders = set()
    incoming = defaultdict(int)
    outgoing = defaultdict(int)
    for row in rows["edges.parquet"]:
        src, dst = row["src"], row["dst"]
        pair = (src, dst)
        if src not in gids or dst not in gids:
            raise DatasetError(f"edges.parquet: пара {src} → {dst} ссылается на неизвестный gid.")
        if pair in edges:
            raise DatasetError(f"edges.parquet: повторяется пара {src} → {dst}.")
        if row["n_tx"] <= 0:
            raise DatasetError(f"edges.parquet: n_tx пары {src} → {dst} должна быть положительной.")
        if not 1 <= row["depth"] <= 4:
            raise DatasetError(f"edges.parquet: depth пары {src} → {dst} вне диапазона 1–4.")
        amount = _to_tiyn(row["sum_kzt"], f"edges.parquet, {src} → {dst}")
        edges[pair] = (amount, row["n_tx"])
        in_graph.update(pair)
        senders.add(src)
        incoming[dst] += amount
        outgoing[src] += amount

    tx_sums = defaultdict(int)
    tx_counts = Counter()
    seen_transactions = set()
    duplicate_count = below_threshold = outside_period = 0
    total_tiyn = 0
    for row in rows["transactions.parquet"]:
        src, dst = row["src"], row["dst"]
        if src not in gids or dst not in gids:
            raise DatasetError(f"transactions.parquet: пара {src} → {dst} ссылается на неизвестный gid.")
        amount = _to_tiyn(row["sum_kzt"], f"transactions.parquet, {src} → {dst}")
        timestamp = row["date"]
        day = timestamp.date() if isinstance(timestamp, datetime) else timestamp
        outside_period += not PROFILE_START <= day <= PROFILE_END
        below_threshold += Decimal(str(row["sum_kzt"])) < Decimal("5000")
        key = (src, dst, timestamp, row["sum_kzt"])
        duplicate_count += key in seen_transactions
        seen_transactions.add(key)
        tx_sums[(src, dst)] += amount
        tx_counts[(src, dst)] += 1
        total_tiyn += amount

    missing_in_edges = tx_counts.keys() - edges.keys()
    missing_in_tx = edges.keys() - tx_counts.keys()
    if missing_in_edges:
        src, dst = min(missing_in_edges)
        raise DatasetError(f"Пара {src} → {dst} из transactions.parquet отсутствует в edges.parquet.")
    if missing_in_tx:
        src, dst = min(missing_in_tx)
        raise DatasetError(f"Пара {src} → {dst} из edges.parquet отсутствует в transactions.parquet.")
    for pair, (edge_sum, edge_count) in edges.items():
        src, dst = pair
        if edge_count != tx_counts[pair]:
            raise DatasetError(
                f"Пара {src} → {dst}: n_tx в edges={edge_count}, "
                f"в transactions={tx_counts[pair]}."
            )
        if abs(edge_sum - tx_sums[pair]) > 1:
            raise DatasetError(
                f"Пара {src} → {dst}: сумма в edges={_format_kzt(edge_sum)} KZT, "
                f"в transactions={_format_kzt(tx_sums[pair])} KZT; допуск 0.01 KZT."
            )

    warnings = []
    isolated_count = len(gids - in_graph)
    boundary_count = sum(row["depth"] == 4 and row["gid"] not in senders for row in nodes)
    seed_count = sum(row["is_seed"] for row in nodes)
    out_exceeds_in = sum(outgoing[gid] > incoming[gid] for gid in gids)
    if isolated_count:
        warnings.append(f"Изолированных клиентов: {isolated_count}. Они сохранены в сводке.")
    if duplicate_count:
        warnings.append(f"Повторяющихся строк операций: {duplicate_count}. Они сохранены; transaction_id отсутствует.")
    if boundary_count:
        warnings.append(f"Клиентов на depth=4 без исходящих: {boundary_count}. Продолжение потока не наблюдается.")
    if seed_count:
        warnings.append(f"Исходных клиентов seed: {seed_count}. Их входящие потоки могут быть неполными.")
    if out_exceeds_in:
        warnings.append(f"Клиентов с исходящей суммой больше наблюдаемой входящей: {out_exceeds_in}. Полный баланс неизвестен.")
    if below_threshold:
        warnings.append(f"Операций ниже порога профиля 5000 KZT: {below_threshold}.")
    if outside_period:
        warnings.append(f"Операций вне периода профиля 2026-07-01 — 2026-07-31: {outside_period}.")
    return ValidationResult(total_tiyn=total_tiyn, warnings=warnings)
