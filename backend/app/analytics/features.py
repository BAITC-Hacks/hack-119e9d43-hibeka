"""Observation and seed-reachability features; no chronology is inferred."""
from datetime import datetime

import networkx as nx

from backend.app.analytics.clusters import ClusterResult
from backend.app.analytics.config import AnalysisConfig
from backend.app.analytics.metrics import calculate_client_metrics
from backend.app.data import ValidatedDataset


def calculate_features(graph: nx.DiGraph, dataset: ValidatedDataset,
                       clusters: ClusterResult, config: AnalysisConfig) -> list[dict]:
    rows = [m.model_dump() for m in calculate_client_metrics(graph, clusters=clusters, config=config)]
    upstream = dict.fromkeys(graph, 0)
    for seed in sorted(gid for gid in graph if graph.nodes[gid]["is_seed"]):
        # descendants uses a visited set and excludes the source, even in cycles.
        for gid in nx.descendants(graph, seed):
            upstream[gid] += 1
    components = sorted(nx.weakly_connected_components(graph), key=lambda c: (-len(c), min(c)))
    component_ids = {gid: i for i, members in enumerate(components) for gid in members}
    first_in = {}
    last_day = None
    for tx in dataset.tables["transactions.parquet"].select(["dst", "date"]).to_pylist():
        day = tx["date"].date() if isinstance(tx["date"], datetime) else tx["date"]
        last_day = day if last_day is None else max(last_day, day)
        first_in[tx["dst"]] = min(first_in.get(tx["dst"], day), day)
    for row in rows:
        gid = int(row["gid"])
        first = first_in.get(gid)
        truncated = row["depth"] == config.boundary_depth and row["out_deg"] == 0
        warnings = ["Наблюдается только часть переводов; разность сумм не является остатком на счёте."]
        if row["is_seed"]:
            warnings.append("У исходного клиента входящие потоки особенно неполны.")
        if truncated:
            warnings.append(f"Граница depth={config.boundary_depth}: продолжение переводов не наблюдается.")
        if row["is_isolated"]:
            warnings.append("В выгрузке нет связей клиента; данных для специализированной роли недостаточно.")
        if row["out_kzt"] > row["in_kzt"]:
            warnings.append("Исходящая сумма больше наблюдаемой входящей; полный баланс неизвестен.")
        row.update(
            activity_kzt=round(row["in_kzt"] + row["out_kzt"], 2),
            neighbor_count=row["in_deg"] + row["out_deg"],
            pass_through=row["out_kzt"] / row["in_kzt"] if row["in_kzt"] > 0 else None,
            truncated_by_depth=truncated,
            seed_in_direct=sum(graph.nodes[v]["is_seed"] for v in graph.predecessors(gid)),
            n_seed_upstream=upstream[gid],
            neighbor_cluster_count=len({clusters.assignments[v] for v in
                                        set(graph.predecessors(gid)) | set(graph.successors(gid))}),
            component_id=component_ids[gid], first_in_date=first.isoformat() if first else None,
            days_after_first_in=(last_day - first).days if first and last_day else None,
            warnings=warnings,
        )
    return rows
