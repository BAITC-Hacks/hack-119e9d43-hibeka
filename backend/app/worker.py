"""Child-process entry point, sharing exactly the CLI analysis pipeline."""
import argparse
from datetime import datetime, timezone
import os
from pathlib import Path
import sys

from backend.app.analytics.config import load_config
from backend.app.analytics.pipeline import run_analysis
from backend.app.jobs import fail_job, read_state, write_state


def execute(out_dir: Path, run_id: str):
    state = read_state(out_dir, run_id)
    if state is None or state["status"] != "queued":
        raise ValueError("Задание не находится в очереди")
    state.update(status="running", stage="starting", worker_pid=os.getpid(),
                 started_at=datetime.now(timezone.utc).isoformat())
    write_state(out_dir, state)

    def progress(stage):
        state["stage"] = stage
        write_state(out_dir, state)

    directory = out_dir / "jobs" / run_id
    try:
        config = load_config(directory / "config.json")
        report = run_analysis(directory / "uploads", out_dir, config,
                              run_id=run_id, reserved=True, progress=progress)
        state.update(status="completed", stage="completed", summary=report["summary"],
                     warnings=report["warnings"], error=None,
                     finished_at=datetime.now(timezone.utc).isoformat())
        write_state(out_dir, state)
        return 0
    except Exception as exc:
        fail_job(out_dir, run_id, "analysis_failed", str(exc))
        print(f"Ошибка анализа: {exc}", file=sys.stderr)
        return 1


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--run-id", required=True)
    args = parser.parse_args()
    return execute(args.out.resolve(), args.run_id)


if __name__ == "__main__":
    raise SystemExit(main())
