"""Reproducible ranking diagnostics, without claims of labelled accuracy."""
from collections import Counter
from copy import deepcopy

from backend.app.analytics.scoring import limitation, rank_rows


def ranking_review(ranked, config):
    k = min(20, len(ranked))
    original = ranked[:k]
    original_ids = {r["gid"] for r in original}
    baseline = sorted(ranked, key=lambda r: (-r["activity_kzt"], int(r["gid"])))[:k]
    baseline_ids = {r["gid"] for r in baseline}
    by_gid = {r["gid"]: r for r in ranked}
    weights = config.ranking.model_dump()
    variants = []
    for factor in weights:
        for multiplier in (.8, 1.2, 0.):
            altered = dict(weights)
            altered[factor] *= multiplier
            total = sum(altered.values())
            if total == 0:
                variants.append(dict(factor=factor, multiplier=multiplier, skipped="Все оставшиеся веса нулевые"))
                continue
            altered = {name: value / total for name, value in altered.items()}
            ordered = rank_rows(deepcopy(ranked), altered)
            positions = {r["gid"]: r["rank"] for r in ordered}
            selected = {r["gid"] for r in ordered[:k]}
            common = original_ids & selected
            moved = sorted(ranked, key=lambda r: (-abs(positions[r["gid"]] - r["rank"]), int(r["gid"])))[:5]
            variants.append(dict(factor=factor, multiplier=multiplier, weights=altered,
                overlap=len(common) / k if k else 1.,
                jaccard=len(common) / len(original_ids | selected) if k else 1.,
                entered=sorted(selected - original_ids, key=int),
                departed=sorted(original_ids - selected, key=int),
                first_five={r["gid"]: positions[r["gid"]] for r in original[:5]},
                mean_rank_change=sum(abs(positions[g] - by_gid[g]["rank"]) for g in common) / len(common) if common else None,
                largest_moves=[dict(gid=r["gid"], old_rank=r["rank"], new_rank=positions[r["gid"]],
                                    factor_normalized=next(f["normalized_value"] for f in r["priority_factors"] if f["name"] == factor)) for r in moved]))
    lines = ["# Проверка рейтинга по фактическому расчёту", "",
        "Без истинных меток эта проверка показывает основания и устойчивость, но не точность обнаружения.",
        "Преимущество перед сортировкой по обороту не подтверждено независимой разметкой; веса остаются экспертной гипотезой версии " + config.ranking_version + ".",
        "", "## Фактический топ-20", "",
        "Пять вкладов: betweenness / pagerank / activity_kzt / n_seed_upstream / neighbor_count.", "",
        "| Ранг | gid | Роль | Вход / выход KZT | Отправители / получатели | Пять вкладов | Основание и ограничение |",
        "|---|---|---|---|---|---|---|"]
    for r in original:
        contributions = " / ".join(f"{f['contribution']:.6f}" for f in r["priority_factors"])
        lines.append(f"| {r['rank']} | {r['gid']} | {r['role']} | {r['in_kzt']:.2f} / {r['out_kzt']:.2f} | {r['in_deg']} / {r['out_deg']} | {contributions} | {r['priority_explanation']} |")
    overlap = len(original_ids & baseline_ids)
    lines += ["", "## Сравнение с оборотом", "", f"Общих клиентов: {overlap} из {k}.",
        f"Роли рейтинга: {dict(Counter(r['role'] for r in original))}; baseline: {dict(Counter(r['role'] for r in baseline))}.",
        f"Кластеры рейтинга: {sorted({r['cluster_id'] for r in original})}; baseline: {sorted({r['cluster_id'] for r in baseline})}.",
        f"Граница выборки / seed в рейтинге: {sum(r['truncated_by_depth'] for r in original)} / {sum(r['is_seed'] for r in original)}; "
        f"в baseline: {sum(r['truncated_by_depth'] for r in baseline)} / {sum(r['is_seed'] for r in baseline)}.", ""]
    for gid in sorted(original_ids ^ baseline_ids, key=lambda g: by_gid[g]["rank"]):
        r = by_gid[gid]
        label = "Вошёл в рейтинг вместо baseline" if gid in original_ids else "Остался только в baseline по обороту"
        lines.append(f"- {gid}: {label}; глобальный ранг {r['rank']}, вход+выход {r['activity_kzt']:.2f} KZT. {r['priority_explanation']}")
    lines += ["", "Сбор и распределение характеризуют роль; в рейтинг входят сетевые признаки независимо от ярлыка. "
        "Seed-достижимость может насыщаться в циклах, а центральности и число связей могут коррелировать. "
        "Это ограничивает интерпретацию дополнительных оснований относительно оборота.",
        "", "## Чувствительность: десять изменений весов и пять исключений", "",
        "| Фактор | Множитель | overlap@20 | Jaccard | Среднее изменение ранга общих клиентов | Новые / выбывшие |",
        "|---|---|---|---|---|---|"]
    for v in variants:
        if "skipped" in v:
            lines.append(f"{v['factor']} × {v['multiplier']}: {v['skipped']}.")
            continue
        lines.append(f"| {v['factor']} | {v['multiplier']} | {v['overlap']:.3f} | {v['jaccard']:.3f} | {v['mean_rank_change']} | {', '.join(v['entered'])} / {', '.join(v['departed'])} |")
    lines += ["", "### Объяснения изменений", ""]
    for v in variants:
        if "skipped" in v:
            continue
        moves = "; ".join(f"{m['gid']}: {m['old_rank']}→{m['new_rank']}, P/норма={m['factor_normalized']:.4f}" for m in v["largest_moves"])
        lines.append(f"- {v['factor']} × {v['multiplier']}: после перенормировки вес {weights[v['factor']]:.4f}→{v['weights'][v['factor']]:.4f}; "
                     f"наибольшие сдвиги: {moves}. Позиции исходной первой пятёрки: {v['first_five']}.")
        if v["multiplier"] != 0 and v["overlap"] < .7:
            lines.append("  Состав топа чувствителен: изменение относительного вклада этого фактора переставило более 30% списка. "
                         "Сопоставить нормированные значения у вошедших/выбывших и близкие оценки на границе топа; "
                         "до экспертного разбора нельзя считать эти веса устойчиво обоснованными.")
    return "\n".join(lines) + "\n", {"baseline_overlap": overlap, "top_size": k, "variants": variants}
