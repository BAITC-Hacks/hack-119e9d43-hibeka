"""Acceptance checks against the provided dataset, separate from generic logic."""
from collections import Counter
import csv
from decimal import Decimal
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from backend.app.analytics.config import AnalysisConfig
from backend.app.analytics.pipeline import CSV_FIELDS, checksum, run_analysis
from backend.app.data import DATA_DIR, load_dataset
from backend.app.local_graph import build_local_graph


class DatasetAcceptanceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = TemporaryDirectory()
        cls.addClassCleanup(cls.temp.cleanup)
        cls.out = Path(cls.temp.name) / 'results'
        cls.before = {name: checksum(DATA_DIR / name) for name in ('nodes.parquet', 'edges.parquet', 'transactions.parquet')}
        cls.first = run_analysis(DATA_DIR, cls.out, AnalysisConfig())
        cls.second = run_analysis(DATA_DIR, cls.out, AnalysisConfig())
        cls.analysis = json.loads((cls.out / 'latest/analysis.json').read_text())
        cls.rows = cls.analysis['nodes']
        cls.data = load_dataset()

    def test_byte_identical_csvs_and_unchanged_inputs(self):
        self.assertEqual(self.first['csv_sha256'], self.second['csv_sha256'])
        self.assertEqual(self.before, {name: checksum(DATA_DIR / name) for name in self.before})
        for name in CSV_FIELDS:
            self.assertEqual((self.out / 'runs' / self.first['run_id'] / name).read_bytes(), (self.out / name).read_bytes())
        self.assertLess(self.second['total_seconds'], 300)

    def test_full_coverage_and_cluster_membership(self):
        self.assertEqual(len(self.rows), 2248)
        expected = {str(gid) for gid in self.data.tables['nodes.parquet']['gid'].to_pylist()}
        self.assertEqual({r['gid'] for r in self.rows}, expected)
        clusters = self.analysis['clusters']
        self.assertEqual(sum(c['n_nodes'] for c in clusters), 2248)
        self.assertEqual(sum(c['n_seed'] for c in clusters), 81)
        for c in clusters:
            members = [r for r in self.rows if r['cluster_id'] == c['cluster_id']]
            self.assertEqual(len(members), c['n_nodes'])
            self.assertEqual(c['top_gids'], [r['gid'] for r in members[:5]])
            self.assertEqual(sum(c['role_counts'].values()), c['n_nodes'])

    def test_isolates_and_observation_limits(self):
        isolated = [r for r in self.rows if r['is_isolated']]
        self.assertEqual(len(isolated), 19)
        self.assertTrue(all(r['role'] == 'peripheral' and r['priority_score'] == 0 for r in isolated))
        boundary = [r for r in self.rows if r['truncated_by_depth']]
        self.assertEqual(len(boundary), 444)
        self.assertTrue(all(r['role'] != 'terminal' for r in boundary))
        self.assertTrue(all(r['role'] not in ('terminal', 'transit') for r in self.rows if r['is_seed']))

    def test_actual_top20_facts_match_original_operations_and_seed_paths(self):
        txs = self.data.tables['transactions.parquet'].to_pylist()
        end = max(tx['date'] for tx in txs)
        parents = {}
        for e in self.data.tables['edges.parquet'].to_pylist():
            parents.setdefault(e['dst'], set()).add(e['src'])
        seeds = {r['gid'] for r in self.data.tables['nodes.parquet'].to_pylist() if r['is_seed']}
        for r in self.rows[:20]:
            gid = int(r['gid'])
            incoming = [tx for tx in txs if tx['dst'] == gid]
            outgoing = [tx for tx in txs if tx['src'] == gid]
            self.assertEqual(Decimal(str(r['in_kzt'])), sum((Decimal(str(tx['sum_kzt'])) for tx in incoming), Decimal(0)))
            self.assertEqual(Decimal(str(r['out_kzt'])), sum((Decimal(str(tx['sum_kzt'])) for tx in outgoing), Decimal(0)))
            self.assertEqual(r['in_tx'], len(incoming))
            self.assertEqual(r['out_tx'], len(outgoing))
            self.assertEqual(r['in_deg'], len({tx['src'] for tx in incoming}))
            self.assertEqual(r['out_deg'], len({tx['dst'] for tx in outgoing}))
            if incoming:
                first = min(tx['date'] for tx in incoming)
                self.assertEqual(r['first_in_date'], first.isoformat())
                self.assertEqual(r['days_after_first_in'], (end - first).days)
            visited, stack = {gid}, [gid]
            while stack:
                for parent in parents.get(stack.pop(), set()):
                    if parent not in visited:
                        visited.add(parent)
                        stack.append(parent)
            self.assertEqual(r['n_seed_upstream'], len((visited - {gid}) & seeds))

    def test_ranking_factors_against_independent_percentile_counts(self):
        distributions = {}
        weights = AnalysisConfig().ranking.model_dump()
        for name in weights:
            if name == 'n_seed_upstream':
                continue
            counts = Counter(r[name] for r in self.rows if r[name] > 0 and not r['is_isolated'])
            total = sum(counts.values())
            less = 0
            values = {}
            for value, count in sorted(counts.items()):
                values[value] = (less + count / 2) / total
                less += count
            distributions[name] = values
        for r in self.rows:
            score = 0
            for f in r['priority_factors']:
                value = min(r['n_seed_upstream'] / 3, 1) if f['name'] == 'n_seed_upstream' else distributions[f['name']].get(r[f['name']], 0)
                if r['is_isolated']:
                    value = 0
                contribution = value * weights[f['name']]
                self.assertAlmostEqual(f['contribution'], contribution)
                score += contribution
            self.assertAlmostEqual(r['priority_score'], score)
        self.assertEqual(self.rows, sorted(self.rows, key=lambda r: (-round(r['priority_score'], 12), int(r['gid']))))

    def test_csvs_match_internal_results_and_schema(self):
        by_gid = {r['gid']: r for r in self.rows}
        for name, fields in CSV_FIELDS.items():
            with (self.out / name).open(encoding='utf-8') as stream:
                reader = csv.DictReader(stream)
                self.assertEqual(reader.fieldnames, fields)
                saved = list(reader)
            if name == 'nodes_roles.csv':
                self.assertEqual(len(saved), 2248)
                self.assertEqual([int(r['gid']) for r in saved], sorted(int(g) for g in by_gid))
                self.assertTrue(all(0 < len(r['evidence']) <= 200 for r in saved))
            elif name == 'top_nodes.csv':
                self.assertEqual(len(saved), 50)
                self.assertEqual([int(r['rank']) for r in saved], list(range(1, 51)))
                for r in saved:
                    self.assertEqual(r['role'], by_gid[r['gid']]['role'])
                    self.assertEqual(float(r['priority_score']), by_gid[r['gid']]['priority_score'])

    def test_diagnostics_cover_all_fifteen_variants(self):
        review = json.loads((self.out / 'latest/ranking_sensitivity.json').read_text())
        self.assertEqual(len(review['variants']), 15)
        self.assertEqual(Counter(v['multiplier'] for v in review['variants']), {.8: 5, 1.2: 5, 0.: 5})
        for v in review['variants']:
            self.assertAlmostEqual(sum(v['weights'].values()), 1)
            self.assertTrue(0 <= v['overlap'] <= 1)

    def test_local_graph_for_every_client_matches_original_edges(self):
        source_edges = self.data.tables['edges.parquet'].to_pylist()
        neighbours = {r['gid']: set() for r in self.rows}
        pairs = {}
        for e in source_edges:
            src, dst = str(e['src']), str(e['dst'])
            neighbours[src].add(dst)
            neighbours[dst].add(src)
            pairs[(src, dst)] = e
        before = self.second['csv_sha256']
        by_gid = {r['gid']: r for r in self.rows}
        for r in self.rows:
            gid = r['gid']
            expected_order = sorted(neighbours[gid] - {gid},
                                    key=lambda g: (-round(by_gid[g]['priority_score'], 12), int(g)))
            expected_ids = [gid, *expected_order[:149]]
            result = build_local_graph(self.analysis, self.second['run_id'], gid)
            self.assertEqual([n.id for n in result.nodes], expected_ids)
            self.assertEqual(result.total_nodes, len(neighbours[gid] | {gid}))
            self.assertEqual(result.truncated, result.total_nodes > len(expected_ids))
            visible = set(expected_ids)
            expected_pairs = {pair for pair in pairs if pair[0] in visible and pair[1] in visible}
            self.assertEqual({(e.source, e.target) for e in result.edges}, expected_pairs)
            for edge in result.edges:
                source = pairs[(edge.source, edge.target)]
                self.assertEqual((edge.sum_kzt, edge.n_tx), (source['sum_kzt'], source['n_tx']))
        self.assertEqual(before, {name: checksum(self.out / name) for name in CSV_FIELDS})


if __name__ == '__main__':
    unittest.main()
