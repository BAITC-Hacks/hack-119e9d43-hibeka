"""Persistent upload job state and supervision of one local worker process."""
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import shutil
import subprocess
import sys
from uuid import uuid4

from backend.app.analytics.pipeline import release_run

logger = logging.getLogger(__name__)
PROJECT_DIR = Path(__file__).resolve().parents[2]
TERMINAL_STATES = {"completed", "failed"}


def write_state(out_dir: Path, state: dict):
    directory = out_dir / "jobs" / state["run_id"]
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / (".status-" + uuid4().hex)
    try:
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")
        temporary.replace(directory / "status.json")
    finally:
        temporary.unlink(missing_ok=True)


def read_state(out_dir: Path, run_id: str):
    path = out_dir / "jobs" / run_id / "status.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.is_file() else None


def fail_job(out_dir: Path, run_id: str, code: str, message: str):
    state = read_state(out_dir, run_id)
    if state is None or state["status"] in TERMINAL_STATES:
        return
    state.update(status="failed", failed_stage=state["stage"], stage="failed",
                 error=dict(code=code, message=message, details={}),
                 finished_at=datetime.now(timezone.utc).isoformat())
    write_state(out_dir, state)


def supervise_job(out_dir: Path, run_id: str):
    """FastAPI runs this wait in a background thread; analytics runs in a child."""
    directory = out_dir / "jobs" / run_id
    try:
        with (directory / "worker.log").open("ab") as log:
            process = subprocess.Popen(
                [sys.executable, "-m", "backend.app.worker", "--out", str(out_dir), "--run-id", run_id],
                cwd=PROJECT_DIR, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
            )
            returncode = process.wait()
        state = read_state(out_dir, run_id)
        if state and state["status"] not in TERMINAL_STATES:
            report_path = out_dir / "runs" / run_id / "run_report.json"
            if report_path.is_file():
                report = json.loads(report_path.read_text(encoding="utf-8"))
                state.update(status="completed", stage="completed", summary=report["summary"],
                             warnings=report["warnings"], error=None,
                             finished_at=datetime.now(timezone.utc).isoformat())
                write_state(out_dir, state)
            else:
                fail_job(out_dir, run_id, "worker_failed", f"Процесс анализа завершился без результата (код {returncode}).")
    except Exception:
        logger.exception("Cannot execute analysis job %s", run_id)
        fail_job(out_dir, run_id, "worker_failed", "Не удалось запустить или завершить процесс анализа.")
    finally:
        try:
            release_run(out_dir, run_id)
        finally:
            shutil.rmtree(directory / "uploads", ignore_errors=True)
            shutil.rmtree(out_dir / "runs" / (".pending-" + run_id), ignore_errors=True)
