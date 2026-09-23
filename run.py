#!/usr/bin/env python3
"""Run the full local money-graph analysis once."""
import argparse
from pathlib import Path
import sys

from backend.app.analytics.config import DEFAULT_CONFIG_PATH, load_config
from backend.app.analytics.pipeline import run_analysis


def main():
    parser = argparse.ArgumentParser(description="Граф денег: признаки, роли, рейтинг и три CSV")
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--out", type=Path, default=Path("out"))
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG_PATH)
    parser.add_argument("--top-n", type=int)
    args = parser.parse_args()
    try:
        config = load_config(args.config)
        if args.top_n is not None:
            config = type(config).model_validate({**config.model_dump(), "top_n": args.top_n})
        report = run_analysis(args.data, args.out, config)
    except Exception as exc:
        print(f"Ошибка анализа: {exc}", file=sys.stderr)
        return 1
    print(f"Готово: {report['run_id']}; клиентов {report['summary']['nodes_count']}; "
          f"кластеров {report['summary']['clusters_count']}; {report['total_seconds']:.2f} с")
    print(f"CSV: {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
