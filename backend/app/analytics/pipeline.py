"""One local pipeline producing validated, immutable analysis snapshots."""
from collections import Counter
import csv
from datetime import datetime, timezone
import hashlib
from importlib.metadata import version
import json
import math
import os
from pathlib import Path
import platform
import re
import shutil
from time import perf_counter
from uuid import uuid4

from backend.app.analytics.clusters import calculate_clusters
from backend.app.analytics.config import AnalysisConfig
from backend.app.analytics.features import calculate_features
from backend.app.analytics.graph import build_graph
from backend.app.analytics.review import ranking_review
from backend.app.analytics.scoring import ROLES, complete_clusters, score_features
from backend.app.data import load_dataset

CSV_FIELDS = {
    "nodes_roles.csv": ["gid", "role", "role_score", "cluster_id", "priority_score", "evidence"],
    "clusters.csv": ["cluster_id", "n_nodes", "n_seed", "sum_kzt_internal", "top_gids", "hypothesis"],
    "top_nodes.csv": ["rank", "gid", "role", "priority_score", "why"],
}
INPUT_FILES = ("nodes.parquet", "edges.parquet", "transactions.parquet")


def reserve_run(out_dir: Path, run_id: str):
    """Reserve the same slot for CLI, upload and worker processes."""
    out_dir.mkdir(parents=True, exist_ok=True)
    lock = out_dir / ".analysis.lock"
    try:
        lock.mkdir()
    except FileExistsError as exc:
        raise ValueError("В этой папке результатов уже выполняется расчёт") from exc
    try:
        write_json(lock / "owner.json", {"run_id": run_id, "pid": os.getpid()})
    except BaseException:
        (lock / "owner.json").unlink(missing_ok=True)
        lock.rmdir()
        raise


def release_run(out_dir: Path, run_id: str):
    lock = out_dir / ".analysis.lock"
    owner = lock / "owner.json"
    if owner.is_file() and json.loads(owner.read_text())["run_id"] == run_id:
        owner.unlink()
        lock.rmdir()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def checksum(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_result(rows, clusters, expected_gids):
    if len(rows) != len(expected_gids) or {r["gid"] for r in rows} != expected_gids:
        raise ValueError("Результат должен содержать каждый входной gid ровно один раз")
    if sum(c["n_nodes"] for c in clusters) != len(rows):
        raise ValueError("Размеры кластеров не сходятся")
    if sum(c["n_seed"] for c in clusters) != sum(r["is_seed"] for r in rows):
        raise ValueError("Количество seed не сходится")
    ids = {c["cluster_id"] for c in clusters}
    if len(ids) != len(clusters):
        raise ValueError("Дублируются cluster_id")
    for r in rows:
        if r["role"] not in ROLES or r["cluster_id"] not in ids:
            raise ValueError("Некорректная роль или кластер")
        for field in ("role_score", "priority_score"):
            if not math.isfinite(r[field]) or not 0 <= r[field] <= 1:
                raise ValueError("Оценки должны лежать в диапазоне 0..1")
        if (not r["evidence"] or len(r["evidence"]) > 200 or '\n' in r["evidence"]
                or not any(ch.isdigit() for ch in r["evidence"])):
            raise ValueError("Некорректное evidence")
        if not r["priority_explanation"] or len(r["priority_explanation"]) > 500:
            raise ValueError("Некорректное объяснение приоритета")
        if abs(sum(f["contribution"] for f in r["priority_factors"]) - r["priority_score"]) > 1e-12:
            raise ValueError("Вклады факторов не сходятся")


def write_csvs(directory, rows, clusters, top_n):
    output_rows = {
        "nodes_roles.csv": sorted(rows, key=lambda r: int(r["gid"])),
        "clusters.csv": [{**c, "top_gids": json.dumps(c["top_gids"])} for c in clusters],
        "top_nodes.csv": [{**r, "why": r["priority_explanation"]} for r in rows[:top_n]],
    }
    for name, fields in CSV_FIELDS.items():
        with (directory / name).open("w", encoding="utf-8", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
            writer.writeheader()
            writer.writerows(output_rows[name])
        # Read back serialized content before publishing any result.
        with (directory / name).open(encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            if reader.fieldnames != fields:
                raise ValueError(f"Неверная схема {name}")
            saved = list(reader)
        if len(saved) != len(output_rows[name]) or any(not r[f] for r in saved for f in fields):
            raise ValueError(f"Неполный CSV {name}")


def run_analysis(data_dir: Path, out_dir: Path, config: AnalysisConfig, *,
                 run_id: str | None = None, reserved: bool = False, progress=None) -> dict:
    start = perf_counter()
    out_dir = out_dir.resolve()
    data_dir = data_dir.resolve()
    if out_dir == data_dir or data_dir in out_dir.parents:
        raise ValueError("Папка результатов должна находиться вне входной папки")
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = run_id or uuid4().hex
    if not re.fullmatch(r"[0-9a-f]{32}", run_id):
        raise ValueError("Некорректный run_id")
    if (out_dir / "runs" / run_id).exists():
        raise ValueError("Такой запуск уже существует")
    if reserved:
        owner = out_dir / ".analysis.lock" / "owner.json"
        if not owner.is_file() or json.loads(owner.read_text())["run_id"] != run_id:
            raise ValueError("Запуск не владеет слотом расчёта")
    else:
        reserve_run(out_dir, run_id)
    def stage_changed(name):
        if progress is not None:
            progress(name)
    runs = out_dir / "runs"
    stage = runs / (".pending-" + run_id)
    destination = runs / run_id
    published = False
    report = dict(run_id=run_id, created_at=datetime.now(timezone.utc).isoformat(), status="running",
                  schema_version=config.schema_version, role_version=config.role_version,
                  ranking_version=config.ranking_version, config=config.model_dump(), stages_seconds={})
    try:
        stage_changed("copying_inputs")
        for name in CSV_FIELDS:
            target = out_dir / name
            if (target.exists() or target.is_symlink()) and not (
                    target.is_symlink() and os.readlink(target) == "latest/" + name):
                raise ValueError(f"Не перезаписываю посторонний файл {target}")
        latest = out_dir / "latest"
        if latest.exists() and not latest.is_symlink():
            raise ValueError("Путь latest занят посторонним файлом или папкой")
        stage.mkdir(parents=True)
        inputs = stage / "inputs"
        inputs.mkdir()
        hashes = {}
        for name in INPUT_FILES:
            original = data_dir / name
            before = checksum(original)
            shutil.copyfile(original, inputs / name)
            if before != checksum(original) or before != checksum(inputs / name):
                raise ValueError("Входные файлы изменились во время копирования")
            hashes[name] = before
        report["input_sha256"] = hashes
        config_bytes = json.dumps(config.model_dump(), sort_keys=True).encode()
        report["config_sha256"] = hashlib.sha256(config_bytes).hexdigest()
        stage_changed("validation")
        checkpoint = perf_counter()
        dataset = load_dataset(inputs)
        report["stages_seconds"]["validation"] = perf_counter() - checkpoint
        checkpoint = perf_counter()
        stage_changed("graph_and_clusters")
        graph = build_graph(dataset)
        clusters = calculate_clusters(graph, config)
        report["stages_seconds"]["graph_and_clusters"] = perf_counter() - checkpoint
        checkpoint = perf_counter()
        stage_changed("features")
        features = calculate_features(graph, dataset, clusters, config)
        report["stages_seconds"]["features"] = perf_counter() - checkpoint
        checkpoint = perf_counter()
        stage_changed("roles_and_ranking")
        ranked = score_features(features, config)
        cluster_rows = complete_clusters(clusters, ranked)
        validate_result(ranked, cluster_rows, {str(gid) for gid in graph})
        report["stages_seconds"]["roles_and_ranking"] = perf_counter() - checkpoint
        top_n = min(config.top_n, len(ranked))
        warnings = list(dataset.validation.warnings)
        if config.top_n > len(ranked):
            warnings.append(f"Запрошено top_n={config.top_n}; экспортированы все {len(ranked)} клиентов.")
        if len(ranked) < 20:
            warnings.append("Во входном наборе меньше 20 клиентов; top_nodes содержит всех.")
        dates = dataset.tables["transactions.parquet"]["date"].to_pylist()
        days = [d.date() if isinstance(d, datetime) else d for d in dates]
        report.update(summary=dict(nodes_count=len(ranked), edges_count=graph.number_of_edges(),
            transactions_count=len(days), seed_count=sum(r["is_seed"] for r in ranked),
            clusters_count=len(cluster_rows), total_amount_kzt=dataset.validation.total_tiyn / 100,
            period_start=min(days).isoformat() if days else None, period_end=max(days).isoformat() if days else None),
            warnings=warnings, dependencies={name: version(name) for name in
                ("networkx", "numpy", "scipy", "pyarrow", "pydantic", "fastapi")}, python=platform.python_version())
        checkpoint = perf_counter()
        stage_changed("diagnostics")
        review, sensitivity = ranking_review(ranked, config)
        (stage / "ranking_review.md").write_text(review, encoding="utf-8")
        write_json(stage / "ranking_sensitivity.json", sensitivity)
        distributions = {}
        for role in ROLES:
            scores = [r["role_score"] for r in ranked if r["role"] == role]
            distributions[role] = dict(count=len(scores), min=min(scores, default=None),
                                       max=max(scores, default=None), mean=sum(scores)/len(scores) if scores else None)
        overlaps = {}
        for row in ranked:
            key = "+".join(sorted(row["candidate_roles"])) or "none"
            item = overlaps.setdefault(key, dict(count=0, examples=[]))
            item["count"] += 1
            if len(item["examples"]) < 3:
                item["examples"].append({k: row[k] for k in ("gid", "role", "role_selection_reason")})
        write_json(stage / "role_diagnostics.json", dict(distributions=distributions, intersections=overlaps))
        report["stages_seconds"]["diagnostics"] = perf_counter() - checkpoint
        checkpoint = perf_counter()
        stage_changed("exports")
        write_csvs(stage, ranked, cluster_rows, top_n)
        write_json(stage / "config.json", config.model_dump())
        write_json(stage / "analysis.json", dict(nodes=ranked, clusters=cluster_rows,
            edges=[dict(src=str(src), dst=str(dst), **attrs) for src, dst, attrs in graph.edges(data=True)]))
        report["csv_sha256"] = {name: checksum(stage / name) for name in CSV_FIELDS}
        report["stages_seconds"]["exports"] = perf_counter() - checkpoint
        report.update(status="completed", total_seconds=perf_counter() - start)
        write_json(stage / "run_report.json", report)
        stage_changed("publishing")
        stage.rename(destination)
        published = True
        # Stable file links follow one atomically replaced latest pointer.
        for name in CSV_FIELDS:
            target = out_dir / name
            if target.is_symlink() and os.readlink(target) == "latest/" + name:
                continue
            if target.exists() or target.is_symlink():
                raise ValueError(f"Не перезаписываю посторонний файл {target}")
            target.symlink_to("latest/" + name)
        pending_link = out_dir / (".latest-" + run_id)
        pending_link.symlink_to("runs/" + run_id, target_is_directory=True)
        pending_link.replace(out_dir / "latest")
        return report
    except Exception as exc:
        report.update(status="failed", error=str(exc), total_seconds=perf_counter() - start)
        failed = out_dir / "failed"
        failed.mkdir(exist_ok=True)
        write_json(failed / (run_id + ".json"), report)
        if stage.exists():
            shutil.rmtree(stage)
        if published and destination.exists() and (out_dir / "latest").resolve() != destination:
            shutil.rmtree(destination)
        raise
    finally:
        release_run(out_dir, run_id)
