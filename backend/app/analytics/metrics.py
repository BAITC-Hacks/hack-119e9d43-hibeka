"""Client metrics and centrality from the observed directed transfer graph."""

from pathlib import Path

import networkx as nx
from pydantic import BaseModel, Field

from backend.app.analytics.graph import build_graph
from backend.app.data import DATA_DIR, ValidationInfo, load_dataset
from backend.app.validation import _to_tiyn


class CentralityError(Exception):
    """Centrality calculation could not produce a converged result."""


class ClientMetrics(BaseModel):
    gid: str
    depth: int
    is_seed: bool
    is_isolated: bool
    in_deg: int = Field(ge=0)
    out_deg: int = Field(ge=0)
    in_tx: int = Field(ge=0)
    out_tx: int = Field(ge=0)
    in_kzt: float = Field(ge=0, allow_inf_nan=False)
    out_kzt: float = Field(ge=0, allow_inf_nan=False)
    net_flow_kzt: float = Field(allow_inf_nan=False)
    pagerank: float = Field(ge=0, allow_inf_nan=False)
    betweenness: float = Field(ge=0, allow_inf_nan=False)


class ClientMetricsPage(BaseModel):
    total_count: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(ge=1, le=500)
    items: list[ClientMetrics]
    validation: ValidationInfo


def calculate_client_metrics(graph: nx.DiGraph) -> list[ClientMetrics]:
    """Count each directed edge once per endpoint, keeping isolated clients."""
    # Calculate on the complete graph, before pagination, including isolates.
    try:
        pagerank = nx.pagerank(
            graph, alpha=0.85, personalization=None, max_iter=1000,
            tol=1e-8, weight="sum_kzt", dangling=None,
        )
    except nx.PowerIterationFailedConvergence as exc:
        raise CentralityError(
            "PageRank не сошёлся за 1000 итераций. Показатели не рассчитаны."
        ) from exc
    # Transfer amounts are not path lengths; use exact unweighted paths.
    betweenness = nx.betweenness_centrality(
        graph, k=None, normalized=True, weight=None, endpoints=False,
    )
    totals = {
        gid: {"in_tiyn": 0, "out_tiyn": 0, "in_tx": 0, "out_tx": 0}
        for gid in graph.nodes
    }
    for src, dst, attributes in graph.edges(data=True):
        # Use the same rounding as dataset validation; add integer tiyn.
        amount = _to_tiyn(attributes["sum_kzt"], f"graph, {src} → {dst}")
        count = attributes["n_tx"]
        totals[src]["out_tiyn"] += amount
        totals[src]["out_tx"] += count
        totals[dst]["in_tiyn"] += amount
        totals[dst]["in_tx"] += count

    result = []
    for gid in sorted(graph.nodes):
        attributes = graph.nodes[gid]
        values = totals[gid]
        in_deg = graph.in_degree(gid)
        out_deg = graph.out_degree(gid)
        result.append(ClientMetrics(
            gid=str(gid),
            depth=attributes["depth"],
            is_seed=attributes["is_seed"],
            is_isolated=in_deg == 0 and out_deg == 0,
            in_deg=in_deg,
            out_deg=out_deg,
            in_tx=values["in_tx"],
            out_tx=values["out_tx"],
            in_kzt=values["in_tiyn"] / 100,
            out_kzt=values["out_tiyn"] / 100,
            net_flow_kzt=(values["in_tiyn"] - values["out_tiyn"]) / 100,
            pagerank=pagerank[gid],
            betweenness=betweenness[gid],
        ))
    return result


def load_client_metrics(
    data_dir: Path = DATA_DIR, *, offset: int = 0, limit: int = 100,
) -> ClientMetricsPage:
    if offset < 0 or not 1 <= limit <= 500:
        raise ValueError("offset must be nonnegative and limit must be between 1 and 500")
    dataset = load_dataset(data_dir)
    metrics = calculate_client_metrics(build_graph(dataset))
    return ClientMetricsPage(
        total_count=len(metrics),
        offset=offset,
        limit=limit,
        items=metrics[offset:offset + limit],
        validation=ValidationInfo(warnings=dataset.validation.warnings),
    )
