"""Upload analysis jobs and read immutable results without recomputing them."""
from datetime import datetime, timezone
from contextlib import suppress
from functools import lru_cache
import json
import os
from pathlib import Path
import re
import shutil
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from backend.app.analytics.config import load_config
from backend.app.analytics.pipeline import CSV_FIELDS, release_run, reserve_run, write_json
from backend.app.analytics.scoring import ROLES
from backend.app.data import DATA_DIR
from backend.app.jobs import read_state, supervise_job, write_state
from backend.app.local_graph import LocalGraph, build_local_graph

router = APIRouter(prefix="/api/runs", tags=["runs"])
MAX_UPLOAD_BYTES = 128 * 1024 * 1024


class AcceptedRun(BaseModel):
    run_id: str
    status: Literal["queued"] = "queued"


def api_error(http_status, code, message, **details):
    return HTTPException(http_status, detail=dict(code=code, message=message, details=details))


def save_upload(source, destination):
    size = 0
    with destination.open("xb") as target:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                raise api_error(413, "file_too_large", "Размер одного файла превышает 128 MiB.")
            target.write(chunk)


@router.post("", status_code=202, response_model=AcceptedRun)
async def create_run(background_tasks: BackgroundTasks, nodes: UploadFile = File(...),
                     edges: UploadFile = File(...), transactions: UploadFile = File(...)):
    out_dir = output_dir()
    run_id = uuid4().hex
    reserved = False
    accepted = False
    directory = out_dir / "jobs" / run_id
    try:
        try:
            reserve_run(out_dir, run_id)
            reserved = True
        except ValueError as exc:
            raise api_error(409, "analysis_busy", str(exc)) from exc
        uploads = directory / "uploads"
        uploads.mkdir(parents=True)
        for name, upload in (("nodes", nodes), ("edges", edges), ("transactions", transactions)):
            # User-supplied filenames are never used as filesystem paths.
            await run_in_threadpool(save_upload, upload.file, uploads / (name + ".parquet"))
        # Finish every cancellable file operation before committing the job.
        for upload in (nodes, edges, transactions):
            await upload.close()
        config = load_config()
        write_json(directory / "config.json", config.model_dump())
        write_state(out_dir, dict(run_id=run_id, created_at=datetime.now(timezone.utc).isoformat(),
            status="queued", stage="queued", summary=None, warnings=[], error=None))
        background_tasks.add_task(supervise_job, out_dir, run_id)
        accepted = True
        return AcceptedRun(run_id=run_id)
    except HTTPException:
        raise
    except Exception as exc:
        raise api_error(503, "upload_failed", "Не удалось подготовить файлы или конфигурацию расчёта.") from exc
    finally:
        if reserved and not accepted:
            shutil.rmtree(directory, ignore_errors=True)
            release_run(out_dir, run_id)
        if not accepted:
            for upload in (nodes, edges, transactions):
                with suppress(Exception):
                    await upload.close()


def output_dir():
    return Path(os.environ.get("GRAPH_OUTPUT_DIR", str(DATA_DIR.parent / "out"))).resolve()


def snapshot(run_id):
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise api_error(404, "run_not_found", "Неизвестный run_id")
    directory = output_dir() / "runs" / run_id
    if not (directory / "run_report.json").is_file():
        state = read_state(output_dir(), run_id)
        if state is not None:
            raise api_error(409, "result_not_ready", "Готовый результат этого запуска отсутствует.",
                            run_id=run_id, status=state["status"], error=state["error"])
        raise api_error(404, "run_not_found", "Запуск не найден")
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
    completed_ids = {item["run_id"] for item in items}
    for path in (output_dir() / "jobs").glob("*/status.json"):
        state = json.loads(path.read_text(encoding="utf-8"))
        if state["run_id"] not in completed_ids:
            items.append(state)
    return {"items": sorted(items, key=lambda r: (r["created_at"], r["run_id"]), reverse=True)}


@router.get("/{run_id}")
def get_run(run_id: str):
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise api_error(404, "run_not_found", "Неизвестный run_id")
    report_path = output_dir() / "runs" / run_id / "run_report.json"
    if report_path.is_file():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        return {**report, "stage": "completed", "error": None}
    state = read_state(output_dir(), run_id)
    if state is None:
        raise api_error(404, "run_not_found", "Запуск не найден")
    return state


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


@router.get("/{run_id}/graph", response_model=LocalGraph)
def run_graph(run_id: str, gid: str = Query(..., min_length=1),
              hops: int = Query(1, ge=1, le=1), limit: int = Query(150, ge=1, le=150)):
    data = read_analysis(snapshot(run_id))
    try:
        return build_local_graph(data, run_id, gid, limit)
    except KeyError as exc:
        raise api_error(404, "node_not_found", "Клиент не найден", gid=gid) from exc


@router.get("/{run_id}/exports/{filename}")
def export_csv(run_id: str, filename: str):
    if filename not in CSV_FIELDS:
        raise HTTPException(404, detail="Выгрузка не найдена")
    directory = snapshot(run_id)
    return FileResponse(directory / filename, media_type="text/csv; charset=utf-8",
                        filename=filename, headers={"X-Run-Id": run_id})
