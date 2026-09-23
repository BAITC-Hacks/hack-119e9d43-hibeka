"""Explainable role selection and role-independent review priority."""
from bisect import bisect_left, bisect_right
from collections import Counter

import numpy as np

from backend.app.analytics.config import AnalysisConfig

ROLES = ("consolidator", "transit", "distributor", "terminal", "coordinator", "peripheral")
PERCENTILE_FIELDS = ("in_kzt", "in_tx", "out_kzt", "out_tx", "betweenness",
                     "pagerank", "activity_kzt", "neighbor_count")
FACTOR_LABELS = {"betweenness": "посредничество", "pagerank": "PageRank",
                 "activity_kzt": "вход+выход KZT", "n_seed_upstream": "достижим из seed",
                 "neighbor_count": "направленные связи"}


def clip(value):
    return max(0., min(1., value))


def positive_percentiles(rows: list[dict]) -> dict[str, dict[str, float]]:
    result = {r["gid"]: {} for r in rows}
    for field in PERCENTILE_FIELDS:
        positive = sorted(r[field] for r in rows if not r["is_isolated"] and r[field] > 0)
        for row in rows:
            value = row[field]
            result[row["gid"]][field] = (
                (bisect_left(positive, value) + bisect_right(positive, value)) / (2 * len(positive))
                if positive and value > 0 and not row["is_isolated"] else 0.
            )
    return result


def select_role(row, p, cutoff, config):
    c = config.roles
    ratio = row["pass_through"]
    candidates = []
    if row["in_deg"] >= c.consolidator_min_in:
        candidates.append("consolidator")
    if row["out_deg"] >= c.distributor_min_out:
        candidates.append("distributor")
    if (not row["is_seed"] and row["depth"] < config.boundary_depth and
            row["in_deg"] > 0 and row["out_deg"] > 0 and ratio is not None and
            c.transit_min_ratio <= ratio <= c.transit_max_ratio):
        candidates.append("transit")
    if (not row["is_seed"] and row["depth"] < config.boundary_depth and
            row["in_deg"] > 0 and row["out_deg"] == 0):
        candidates.append("terminal")
    if (row["in_deg"] > 0 and row["out_deg"] > 0 and row["betweenness"] > 0 and
            cutoff is not None and row["betweenness"] >= cutoff and
            row["neighbor_cluster_count"] >= c.coordinator_min_clusters):
        candidates.append("coordinator")
    if "coordinator" in candidates:
        role, reason = "coordinator", "Структурный связующий узел: первое правило выбора."
    elif "consolidator" in candidates and "distributor" in candidates:
        role = ("consolidator" if c.distributor_min_out * row["in_deg"] >=
                c.consolidator_min_in * row["out_deg"] else "distributor")
        reason = (f"Пересечение сбора и распределения: сравнение in_deg/{c.consolidator_min_in} "
                  f"и out_deg/{c.distributor_min_out}; равенство — consolidator.")
    else:
        role = next((r for r in ("consolidator", "distributor", "transit", "terminal") if r in candidates), "peripheral")
        reason = "Первое применимое правило: сбор, распределение, транзит, конечный получатель; иначе peripheral."
    seed = min(row["n_seed_upstream"] / c.seed_scale, 1)
    strength = q = 0.
    if role == "consolidator":
        parts = [min(row["in_deg"] / c.consolidator_scale_in, 1), p["in_kzt"], p["in_tx"], seed]
        strength = sum(w * v for w, v in zip(c.consolidator_weights, parts))
        q = c.consolidator_boundary_q if row["truncated_by_depth"] else c.consolidator_q
    elif role == "distributor":
        strength = sum(w * v for w, v in zip(c.distributor_weights,
                       [min(row["out_deg"] / c.distributor_scale_out, 1), p["out_kzt"], p["out_tx"]]))
        q = c.distributor_q
    elif role == "transit":
        strength = sum(w * v for w, v in zip(c.transit_weights, [
            clip(1 - abs(ratio - 1) / c.transit_balance_width),
            min(min(row["in_tx"], row["out_tx"]) / c.transit_scale_tx, 1),
            min(min(row["in_kzt"], row["out_kzt"]) / c.transit_scale_kzt, 1)]))
        q = c.transit_q
    elif role == "terminal":
        if row["days_after_first_in"] is None:
            raise ValueError("Для terminal отсутствует дата входящей операции")
        strength = c.terminal_base + c.terminal_days_weight * clip(row["days_after_first_in"] / c.terminal_observation_days)
        q = c.terminal_q
    elif role == "coordinator":
        strength = sum(w * v for w, v in zip(c.coordinator_weights,
                       [p["betweenness"], min(row["neighbor_cluster_count"] / c.coordinator_scale_clusters, 1), seed]))
        q = c.coordinator_q
    return role, q * clip(strength), candidates, reason, strength, q


def limitation(row):
    if row["is_isolated"]:
        return "Связей нет; недостаточно данных."
    if row["truncated_by_depth"]:
        return f"Граница depth={row['depth']}; продолжение не видно."
    if row["is_seed"]:
        return "Seed: входящие неполны."
    if row.get("role") == "transit":
        return "Хронология транзита не доказана."
    if row.get("role") == "terminal":
        return "Нет исходящих в выборке; остаток неизвестен."
    return "Полный баланс неизвестен."


def role_explanations(row, config, cutoff):
    c = config.roles
    role = row["role"]
    short = {
        "consolidator": f"Сбор: отправителей {row['in_deg']}, вход {row['in_kzt']:.6g} KZT; выход {row['out_kzt']:.6g} KZT.",
        "distributor": f"Распределение: получателей {row['out_deg']}, выход {row['out_kzt']:.6g} KZT; операций {row['out_tx']}.",
        "transit": f"Кандидат на транзит: вход {row['in_kzt']:.6g}, выход {row['out_kzt']:.6g} KZT; отношение {row['pass_through'] or 0:.3f}.",
        "terminal": f"Возможный конечный получатель: вход {row['in_kzt']:.6g} KZT, исходящих 0; наблюдение {row['days_after_first_in']} дн.",
        "coordinator": f"Связующий узел: соседних кластеров {row['neighbor_cluster_count']}, посредничество {row['betweenness']:.5g}; гипотеза.",
        "peripheral": f"Роль не определена: входящих связей {row['in_deg']}, исходящих {row['out_deg']}.",
    }[role]
    evidence = short + " " + limitation(row)
    if len(evidence) > 200:
        raise ValueError("Краткое объяснение превысило 200 символов")
    rules = {
        "consolidator": f"in_deg={row['in_deg']} >= {c.consolidator_min_in}",
        "distributor": f"out_deg={row['out_deg']} >= {c.distributor_min_out}",
        "transit": f"не seed; depth<{config.boundary_depth}; есть вход и выход; {c.transit_min_ratio} <= out/in={row['pass_through']} <= {c.transit_max_ratio}",
        "terminal": f"не seed; depth<{config.boundary_depth}; in_deg>0; out_deg=0; дней наблюдения={row['days_after_first_in']}",
        "coordinator": f"есть вход и выход; betweenness={row['betweenness']:.8g} >= квантиль {cutoff}; соседних кластеров {row['neighbor_cluster_count']} >= {c.coordinator_min_clusters}",
        "peripheral": "Ни одно специализированное правило не выполнено; оценка 0 не означает отсутствия риска",
    }
    full = (f"{evidence} Правило: {rules[role]}. "
            f"S={row['role_strength']:.8f}; q={row['observability_q']:.4f}; "
            f"role_score=q×clip(S)={row['role_score']:.8f}. "
            "Это сила признаков, не вероятность виновности. " + " ".join(row["warnings"]))
    return evidence, full


def rank_rows(rows, weights):
    for row in rows:
        for factor in row["priority_factors"]:
            factor["weight"] = weights[factor["name"]]
            factor["contribution"] = factor["weight"] * factor["normalized_value"]
        row["priority_score"] = clip(sum(f["contribution"] for f in row["priority_factors"]))
    ranked = sorted(rows, key=lambda r: (-round(r["priority_score"], 12), int(r["gid"])))
    for rank, row in enumerate(ranked, 1):
        row["rank"] = rank
    return ranked


def score_features(rows: list[dict], config: AnalysisConfig) -> list[dict]:
    percentiles = positive_percentiles(rows)
    positive = [r["betweenness"] for r in rows if r["betweenness"] > 0 and not r["is_isolated"]]
    cutoff = float(np.quantile(positive, config.roles.coordinator_quantile, method="linear")) if positive else None
    for row in rows:
        p = percentiles[row["gid"]]
        role, score, candidates, reason, strength, q = select_role(row, p, cutoff, config)
        row.update(role=role, role_score=score, candidate_roles=candidates,
                   role_selection_reason=reason, role_strength=strength, observability_q=q,
                   percentiles=p, coordinator_cutoff=cutoff)
        row["evidence"], row["role_explanation"] = role_explanations(row, config, cutoff)
        row["priority_factors"] = []
        for name, weight in config.ranking.model_dump().items():
            normalized = min(row[name] / config.roles.seed_scale, 1) if name == "n_seed_upstream" else p[name]
            row["priority_factors"].append(dict(name=name, raw_value=row[name],
                normalized_value=0. if row["is_isolated"] else normalized, weight=weight, contribution=0.))
    ranked = rank_rows(rows, config.ranking.model_dump())
    for row in ranked:
        factors = sorted(row["priority_factors"], key=lambda f: -f["contribution"])[:3]
        row["priority_explanation"] = "; ".join(
            f"{FACTOR_LABELS[f['name']]}={f['raw_value']:.6g}, вклад={f['contribution']:.4f}" for f in factors
        ) + ". " + limitation(row)
    return ranked


def complete_clusters(clusters, ranked):
    result = []
    for cluster in clusters.summaries:
        members = [r for r in ranked if r["cluster_id"] == cluster.cluster_id]
        counts = dict.fromkeys(ROLES, 0)
        counts.update(Counter(r["role"] for r in members))
        hypothesis = ("Изолированный клиент; связей в выгрузке нет." if all(r["is_isolated"] for r in members) else
            f"Группа из {cluster.n_nodes} клиентов, исходных {cluster.n_seed}; "
            f"признаки сбора у {counts['consolidator']}, распределения у {counts['distributor']}, "
            f"связующих узлов {counts['coordinator']}; внутренние переводы {cluster.internal_kzt:.2f} KZT. "
            "Гипотеза по наблюдаемым переводам.")
        result.append({**cluster.model_dump(), "sum_kzt_internal": cluster.internal_kzt,
                       "top_gids": [r["gid"] for r in members[:5]], "role_counts": counts,
                       "hypothesis": hypothesis})
    return result
