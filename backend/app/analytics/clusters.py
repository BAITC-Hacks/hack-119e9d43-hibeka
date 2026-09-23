"""Deterministic Louvain communities and observed transfer totals."""

from dataclasses import dataclass
from pathlib import Path

import networkx as nx
from pydantic import BaseModel, Field

from backend.app.analytics.graph import build_graph
from backend.app.analytics.config import AnalysisConfig
from backend.app.data import DATA_DIR, ValidationInfo, load_dataset
from backend.app.validation import _to_tiyn


class ClusteringError(Exception):
    """The community partition does not cover every client exactly once."""


class ClusterSummary(BaseModel):
    cluster_id: int = Field(ge=0)
    n_nodes: int = Field(ge=1)
    n_seed: int = Field(ge=0)
    internal_kzt: float = Field(ge=0, allow_inf_nan=False)
    incoming_kzt: float = Field(ge=0, allow_inf_nan=False)
    outgoing_kzt: float = Field(ge=0, allow_inf_nan=False)


@dataclass(frozen=True)
class ClusterResult:
    assignments: dict[int, int]
    summaries: list[ClusterSummary]


class ClustersPage(BaseModel):
    total_count: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=500)
    items: list[ClusterSummary]
    validation: ValidationInfo


def calculate_clusters(graph: nx.DiGraph, config: AnalysisConfig | None = None) -> ClusterResult:
    config = config or AnalysisConfig()
    # Aggregate reciprocal edges explicitly; keep the source graph unchanged.
    pair_amounts: dict[tuple[int, int], int] = {}
    directed_amounts = []
    for src, dst, attributes in sorted(graph.edges(data=True)):
        amount = _to_tiyn(attributes["sum_kzt"], f"graph, {src} → {dst}")
        pair = (min(src, dst), max(src, dst))
        pair_amounts[pair] = pair_amounts.get(pair, 0) + amount
        directed_amounts.append((src, dst, amount))

    projection = nx.Graph()
    projection.add_nodes_from(sorted(graph.nodes))
    for (src, dst), amount in sorted(pair_amounts.items()):
        projection.add_edge(src, dst, sum_tiyn=amount)

    if not pair_amounts or sum(pair_amounts.values()) == 0:
        communities = [{gid} for gid in projection]
    else:
        # Scaling every KZT weight by 100 preserves relative edge weights.
        communities = nx.community.louvain_communities(
            projection, weight="sum_tiyn", resolution=config.louvain_resolution, seed=config.random_seed,
        )
        covered = set().union(*communities)
        communities.extend({gid} for gid in nx.isolates(projection) if gid not in covered)

    communities.sort(key=lambda members: (-len(members), min(members)))
    assignments = {
        gid: cluster_id
        for cluster_id, members in enumerate(communities)
        for gid in sorted(members)
    }
    if (set(assignments) != set(graph.nodes)
            or sum(map(len, communities)) != graph.number_of_nodes()):
        raise ClusteringError("Кластеризация должна включать каждого клиента ровно один раз.")

    internal = [0] * len(communities)
    incoming = [0] * len(communities)
    outgoing = [0] * len(communities)
    # Count original directed amounts once, independent of the projection.
    for src, dst, amount in directed_amounts:
        source_cluster, target_cluster = assignments[src], assignments[dst]
        if source_cluster == target_cluster:
            internal[source_cluster] += amount
        else:
            outgoing[source_cluster] += amount
            incoming[target_cluster] += amount

    summaries = [
        ClusterSummary(
            cluster_id=cluster_id,
            n_nodes=len(members),
            n_seed=sum(graph.nodes[gid]["is_seed"] for gid in members),
            internal_kzt=internal[cluster_id] / 100,
            incoming_kzt=incoming[cluster_id] / 100,
            outgoing_kzt=outgoing[cluster_id] / 100,
        )
        for cluster_id, members in enumerate(communities)
    ]
    return ClusterResult(assignments=assignments, summaries=summaries)


def load_clusters(
    data_dir: Path = DATA_DIR, *, offset: int = 0, limit: int = 100,
) -> ClustersPage:
    if offset < 0 or not 1 <= limit <= 500:
        raise ValueError("offset must be nonnegative and limit must be between 1 and 500")
    dataset = load_dataset(data_dir)
    result = calculate_clusters(build_graph(dataset))
    return ClustersPage(
        total_count=len(result.summaries), offset=offset, limit=limit,
        items=result.summaries[offset:offset + limit],
        validation=ValidationInfo(warnings=dataset.validation.warnings),
    )
