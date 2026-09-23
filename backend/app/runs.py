"""Read completed CLI snapshots without recomputing analytics per request."""
from functools import lru_cache
import json
import os
from pathlib import Path
import re

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.app.analytics.pipeline import CSV_FIELDS
from backend.app.analytics.scoring import ROLES
from backend.app.data import DATA_DIR

router = APIRouter(prefix="/api/runs", tags=["runs"])


def output_dir():
    return Path(os.environ.get("GRAPH_OUTPUT_DIR", str(DATA_DIR.parent / "out"))).resolve()


def snapshot(run_id):
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise HTTPException(404, detail="Неизвестный run_id")
    directory = output_dir() / "runs" / run_id
    if not (directory / "run_report.json").is_file():
        raise HTTPException(404, detail="Запуск не найден")
    return directory


@lru_cache(maxsize=4)
def read_analysis(directory):
    return json.loads((directory / "analysis.json").read_text(encoding="utf-8"))


@router.get("")
def list_runs():
    items = []
    for file in (output_dir() / "runs").glob("*/run_report.json"):
        if not re.fullmatch(r"[0-9a-f]{32}", file.parent.name):
            continue
        report = json.loads(file.read_text(encoding="utf-8"))
        if report["status"] == "completed":
            items.append({key: report[key] for key in ("run_id", "created_at", "status", "summary")})
    return {"items": sorted(items, key=lambda r: (r["created_at"], r["run_id"]), reverse=True)}


@router.get("/{run_id}")
def get_run(run_id: str):
    return json.loads((snapshot(run_id) / "run_report.json").read_text(encoding="utf-8"))


@router.get("/{run_id}/nodes")
def run_nodes(run_id: str, offset: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500),
              role: str | None = None, cluster_id: int | None = None, is_seed: bool | None = None,
              truncated_by_depth: bool | None = None, min_priority: float = Query(0, ge=0, le=1)):
    if role is not None and role not in ROLES:
        raise HTTPException(422, detail="Неизвестная роль")
    rows = read_analysis(snapshot(run_id))["nodes"]
    selected = [r for r in rows if (role is None or r["role"] == role)
                and (cluster_id is None or r["cluster_id"] == cluster_id)
                and (is_seed is None or r["is_seed"] == is_seed)
                and (truncated_by_depth is None or r["truncated_by_depth"] == truncated_by_depth)
                and r["priority_score"] >= min_priority]
    return dict(run_id=run_id, total=len(selected), items=selected[offset:offset + limit])


@router.get("/{run_id}/nodes/{gid}")
def run_node(run_id: str, gid: str):
    data = read_analysis(snapshot(run_id))
    row = next((r for r in data["nodes"] if r["gid"] == gid), None)
    if row is None:
        raise HTTPException(404, detail="Клиент не найден")
    incoming = [dict(gid=e["src"], sum_kzt=e["sum_kzt"], n_tx=e["n_tx"]) for e in data["edges"] if e["dst"] == gid]
    outgoing = [dict(gid=e["dst"], sum_kzt=e["sum_kzt"], n_tx=e["n_tx"]) for e in data["edges"] if e["src"] == gid]
    return dict(run_id=run_id, **row, incoming=incoming, outgoing=outgoing)


@router.get("/{run_id}/clusters")
def run_clusters(run_id: str):
    return dict(run_id=run_id, items=read_analysis(snapshot(run_id))["clusters"])


@router.get("/{run_id}/exports/{filename}")
def export_csv(run_id: str, filename: str):
    if filename not in CSV_FIELDS:
        raise HTTPException(404, detail="Выгрузка не найдена")
    directory = snapshot(run_id)
    return FileResponse(directory / filename, media_type="text/csv; charset=utf-8",
                        filename=filename, headers={"X-Run-Id": run_id})
