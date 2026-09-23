"""A bounded, directed client neighbourhood from one completed snapshot."""
from typing import Literal

from pydantic import BaseModel, Field

Role = Literal["consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral"]


class LocalNode(BaseModel):
    id: str
    gid: str
    role: Role
    role_score: float = Field(ge=0, le=1, allow_inf_nan=False)
    priority_score: float = Field(ge=0, le=1, allow_inf_nan=False)
    rank: int = Field(ge=1)
    cluster_id: int = Field(ge=0)
    depth: int = Field(ge=0)
    is_seed: bool
    is_isolated: bool
    truncated_by_depth: bool
    selected: bool


class LocalEdge(BaseModel):
    id: str
    source: str
    target: str
    sum_kzt: float = Field(ge=0, allow_inf_nan=False)
    n_tx: int = Field(ge=1)


class LocalGraph(BaseModel):
    run_id: str
    gid: str
    hops: Literal[1] = 1
    limit: int = Field(ge=1, le=150)
    nodes: list[LocalNode]
    edges: list[LocalEdge]
    total_nodes: int = Field(ge=1)
    shown_nodes: int = Field(ge=1)
    truncated: bool


def build_local_graph(data: dict, run_id: str, gid: str, limit: int = 150) -> LocalGraph:
    if not 1 <= limit <= 150:
        raise ValueError("limit должен быть от 1 до 150")
    by_gid = {row["gid"]: row for row in data["nodes"]}
    if gid not in by_gid:
        raise KeyError(gid)

    neighbours = set()
    for edge in data["edges"]:
        if edge["src"] == gid:
            neighbours.add(edge["dst"])
        if edge["dst"] == gid:
            neighbours.add(edge["src"])
    neighbours.discard(gid)
    ordered = sorted(neighbours, key=lambda other: (-round(by_gid[other]["priority_score"], 12), int(other)))
    visible = [gid, *ordered[:limit - 1]]
    visible_set = set(visible)
    fields = ("gid", "role", "role_score", "priority_score", "rank", "cluster_id",
              "depth", "is_seed", "is_isolated", "truncated_by_depth")
    nodes = [LocalNode(id=other, selected=other == gid,
                       **{field: by_gid[other][field] for field in fields}) for other in visible]
    # Include every original directed edge between visible nodes, not only spokes.
    edges = [LocalEdge(id=f"{edge['src']}->{edge['dst']}", source=edge["src"],
                       target=edge["dst"], sum_kzt=edge["sum_kzt"], n_tx=edge["n_tx"])
             for edge in sorted(data["edges"], key=lambda e: (int(e["src"]), int(e["dst"])))
             if edge["src"] in visible_set and edge["dst"] in visible_set]
    total = len(neighbours) + 1
    return LocalGraph(run_id=run_id, gid=gid, limit=limit, nodes=nodes, edges=edges,
                      total_nodes=total, shown_nodes=len(nodes), truncated=len(nodes) < total)
