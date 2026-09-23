"""Build a directed transaction graph including every provided client."""

from pathlib import Path

import networkx as nx
from pydantic import BaseModel, Field

from backend.app.data import DATA_DIR, ValidatedDataset, load_dataset


class GraphSummary(BaseModel):
    directed: bool
    nodes_count: int = Field(ge=0)
    edges_count: int = Field(ge=0)
    seed_count: int = Field(ge=0)
    isolated_nodes_count: int = Field(ge=0)
    weak_components_count: int = Field(ge=0)
    largest_component_size: int = Field(ge=0)


def build_graph(dataset: ValidatedDataset) -> nx.DiGraph:
    """Preserve int64 IDs, edge direction and attributes from validated input."""
    graph = nx.DiGraph()
    nodes = dataset.tables["nodes.parquet"].select(["gid", "depth", "is_seed"])
    edges = dataset.tables["edges.parquet"].select(["src", "dst", "sum_kzt", "n_tx", "depth"])

    # Insert all clients first: clients without transfers must not disappear.
    for row in nodes.sort_by([("gid", "ascending")]).to_pylist():
        graph.add_node(row["gid"], depth=row["depth"], is_seed=row["is_seed"])

    for row in edges.sort_by([("src", "ascending"), ("dst", "ascending")]).to_pylist():
        graph.add_edge(
            row["src"], row["dst"],
            sum_kzt=row["sum_kzt"], n_tx=row["n_tx"], depth=row["depth"],
        )
    return graph


def summarize_graph(graph: nx.DiGraph) -> GraphSummary:
    component_sizes = [len(component) for component in nx.weakly_connected_components(graph)]
    return GraphSummary(
        directed=graph.is_directed(),
        nodes_count=graph.number_of_nodes(),
        edges_count=graph.number_of_edges(),
        seed_count=sum(attributes["is_seed"] for _, attributes in graph.nodes(data=True)),
        isolated_nodes_count=nx.number_of_isolates(graph),
        weak_components_count=len(component_sizes),
        largest_component_size=max(component_sizes, default=0),
    )


def load_graph_summary(data_dir: Path = DATA_DIR) -> GraphSummary:
    dataset = load_dataset(data_dir)
    return summarize_graph(build_graph(dataset))
