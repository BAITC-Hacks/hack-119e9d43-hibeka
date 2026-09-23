"""Behavioural coverage for communities, observations, roles and exports."""
from copy import deepcopy
import csv
from datetime import date
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

import networkx as nx
import pyarrow as pa
import pyarrow.parquet as pq
from pydantic import ValidationError

from backend.app.analytics.clusters import calculate_clusters, ClusteringError
from backend.app.analytics.config import AnalysisConfig
from backend.app.analytics.features import calculate_features
from backend.app.analytics.graph import build_graph
from backend.app.analytics.pipeline import CSV_FIELDS, checksum, run_analysis
from backend.app.analytics.scoring import positive_percentiles, score_features, select_role
from backend.app.data import ValidatedDataset
from backend.app.validation import validate_tables

A, B, C, D, E = (100000000000000001 + i for i in range(5))


def dataset(empty=False, isolates=False):
    nodes = pa.table({'gid': pa.array([A, B, C, D, E], type=pa.int64()),
                      'depth': [0, 1, 0, 4, 0], 'is_seed': [True, False, True, False, True]})
    edges = pa.table({'src': pa.array([A, B, C, B], type=pa.int64()),
                     'dst': pa.array([B, A, B, D], type=pa.int64()),
                     'sum_kzt': [10000., 5000., 5000., 5000.], 'n_tx': [2, 1, 1, 1], 'depth': [1, 2, 1, 4]})
    tx = pa.table({'src': pa.array([A, A, B, C, B], type=pa.int64()),
                   'dst': pa.array([B, B, A, B, D], type=pa.int64()),
                   'sum_kzt': [5000.] * 5,
                   'date': pa.array([date(2026, 7, d) for d in [1, 3, 4, 10, 20]], type=pa.date32())})
    tables = dict(zip(('nodes.parquet', 'edges.parquet', 'transactions.parquet'), (nodes, edges, tx)))
    if isolates or empty:
        tables['edges.parquet'] = edges.slice(0, 0)
        tables['transactions.parquet'] = tx.slice(0, 0)
    if empty:
        tables['nodes.parquet'] = nodes.slice(0, 0)
    return ValidatedDataset(tables, validate_tables(tables))


def fixture_row(gid=A, **overrides):
    row = dict(gid=str(gid), cluster_id=0, component_id=0, depth=1, is_seed=False,
        is_isolated=False, in_deg=1, out_deg=1, in_tx=2, out_tx=2,
        in_kzt=100000., out_kzt=100000., net_flow_kzt=0., activity_kzt=200000.,
        neighbor_count=2, pass_through=1., truncated_by_depth=False,
        seed_in_direct=1, n_seed_upstream=1, neighbor_cluster_count=1,
        first_in_date='2026-07-01', days_after_first_in=30,
        pagerank=.1, betweenness=.1, warnings=['Наблюдение неполное.'])
    row.update(overrides)
    return row


class ClusterTests(unittest.TestCase):
    def setUp(self):
        self.graph = build_graph(dataset())

    def test_reciprocal_weights_are_summed_and_original_is_unchanged(self):
        original = deepcopy(self.graph)
        partition = [{A, B, C, D}, {E}]
        with patch('backend.app.analytics.clusters.nx.community.louvain_communities', return_value=partition) as call:
            result = calculate_clusters(self.graph)
        projection = call.call_args.args[0]
        self.assertFalse(projection.is_directed())
        self.assertEqual(projection[A][B]['sum_tiyn'], 1500000)
        self.assertEqual(call.call_args.kwargs, dict(weight='sum_tiyn', resolution=1., seed=42))
        self.assertTrue(nx.utils.graphs_equal(original, self.graph))
        self.assertEqual(result.summaries[0].internal_kzt, 25000)

    def test_intercluster_transfers_count_once_per_direction(self):
        with patch('backend.app.analytics.clusters.nx.community.louvain_communities', return_value=[{A, B}, {C, D}, {E}]):
            result = calculate_clusters(self.graph)
        first, second, isolated = result.summaries
        self.assertEqual((first.internal_kzt, first.incoming_kzt, first.outgoing_kzt), (15000, 5000, 5000))
        self.assertEqual((second.internal_kzt, second.incoming_kzt, second.outgoing_kzt), (0, 5000, 5000))
        self.assertEqual(isolated.n_nodes, 1)
        self.assertEqual(sum(c.internal_kzt + c.outgoing_kzt for c in result.summaries), 25000)

    def test_reproducible_ids_and_isolate_singleton(self):
        first = calculate_clusters(self.graph)
        shuffled = nx.DiGraph()
        shuffled.add_nodes_from(reversed(list(self.graph.nodes(data=True))))
        shuffled.add_edges_from(reversed(list(self.graph.edges(data=True))))
        second = calculate_clusters(shuffled)
        self.assertEqual(first, second)
        self.assertEqual(first.summaries[first.assignments[E]].n_nodes, 1)
        self.assertEqual(set(first.assignments), set(self.graph))
        sizes = [(s.n_nodes, min(g for g, cid in first.assignments.items() if cid == s.cluster_id)) for s in first.summaries]
        self.assertEqual(sizes, sorted(sizes, key=lambda v: (-v[0], v[1])))

    def test_invalid_partition_rejected(self):
        for partition in ([{A, B}, {B, C, D}, {E}], [{A, B}, {E}]):
            with patch('backend.app.analytics.clusters.nx.community.louvain_communities', return_value=partition):
                with self.assertRaises(ClusteringError):
                    calculate_clusters(self.graph)

    def test_empty_and_no_edges(self):
        self.assertEqual(calculate_clusters(nx.DiGraph()).assignments, {})
        isolated = build_graph(dataset(isolates=True))
        self.assertEqual(len(calculate_clusters(isolated).summaries), 5)


class FeatureTests(unittest.TestCase):
    def features(self, data):
        graph = build_graph(data)
        return {int(r['gid']): r for r in calculate_features(graph, data, calculate_clusters(graph), AnalysisConfig())}

    def test_seed_reachability_uses_unique_sources_and_excludes_self_in_cycle(self):
        rows = self.features(dataset())
        self.assertEqual([rows[g]['n_seed_upstream'] for g in (A, B, C, D, E)], [1, 2, 0, 2, 0])
        self.assertEqual(rows[B]['seed_in_direct'], 2)
        self.assertEqual(rows[D]['seed_in_direct'], 0)

    def test_dates_and_observation_boundary(self):
        rows = self.features(dataset())
        self.assertEqual(rows[B]['first_in_date'], '2026-07-01')
        self.assertEqual(rows[B]['days_after_first_in'], 19)
        self.assertEqual(rows[D]['days_after_first_in'], 0)
        self.assertTrue(rows[D]['truncated_by_depth'])
        self.assertTrue(any('Граница' in w for w in rows[D]['warnings']))
        self.assertIsNone(rows[E]['pass_through'])
        self.assertIsNone(rows[E]['first_in_date'])
        self.assertTrue(any('входящие' in w for w in rows[A]['warnings']))

    def test_no_transactions_means_no_dates(self):
        rows = self.features(dataset(isolates=True))
        self.assertTrue(all(r['first_in_date'] is None and r['days_after_first_in'] is None for r in rows.values()))


class RoleTests(unittest.TestCase):
    def score(self, **overrides):
        return score_features([fixture_row(**overrides)], AnalysisConfig())[0]

    def test_each_specialized_role(self):
        cases = [({'in_deg': 3}, 'consolidator'), ({'out_deg': 10}, 'distributor'),
                 ({}, 'transit'), ({'out_deg': 0, 'out_kzt': 0., 'pass_through': 0.}, 'terminal'),
                 ({'neighbor_cluster_count': 2}, 'coordinator')]
        for overrides, role in cases:
            with self.subTest(role=role):
                self.assertEqual(self.score(**overrides)['role'], role)

    def test_seed_and_boundary_never_become_transit_or_terminal(self):
        for flags in ({'is_seed': True, 'depth': 0}, {'depth': 4, 'truncated_by_depth': True}):
            for out in (0, 1):
                r = self.score(**flags, out_deg=out, out_kzt=100000. if out else 0., pass_through=1. if out else 0.)
                self.assertNotIn(r['role'], ('transit', 'terminal'))

    def test_terminal_strength_uses_days_not_money(self):
        for days, expected in [(0, .39), (3, .5014285714285714), (7, .65), (30, .65)]:
            for amount in (5000., 5000000.):
                r = self.score(out_deg=0, out_tx=0, out_kzt=0., pass_through=0., days_after_first_in=days, in_kzt=amount)
                self.assertEqual(r['role'], 'terminal')
                self.assertAlmostEqual(r['role_score'], expected)

    def test_transit_ratio_bounds_and_missing_chronology(self):
        for ratio in (.8, 1., 1.2):
            r = self.score(pass_through=ratio)
            self.assertEqual(r['role'], 'transit')
            self.assertIn('Хронология', r['evidence'])
        for ratio in (.79, 1.21, None):
            self.assertEqual(self.score(pass_through=ratio)['role'], 'peripheral')

    def test_role_intersections_follow_explicit_rules(self):
        self.assertEqual(self.score(in_deg=3, out_deg=10)['role'], 'consolidator')
        self.assertEqual(self.score(in_deg=3, out_deg=11)['role'], 'distributor')
        self.assertEqual(self.score(in_deg=3, out_deg=20, neighbor_cluster_count=2)['role'], 'coordinator')
        r = self.score(in_deg=3, out_deg=0, out_kzt=0., pass_through=0.)
        self.assertEqual(r['role'], 'consolidator')
        self.assertIn('terminal', r['candidate_roles'])

    def test_changing_q_does_not_change_role_rank_or_priority(self):
        rows = [fixture_row(A, in_deg=3), fixture_row(B, out_deg=12)]
        config = AnalysisConfig()
        first = score_features(deepcopy(rows), config)
        config.roles.consolidator_q = .01
        config.roles.distributor_q = 1.
        second = score_features(deepcopy(rows), config)
        self.assertEqual([(r['gid'], r['role'], r['priority_score'], r['rank']) for r in first],
                         [(r['gid'], r['role'], r['priority_score'], r['rank']) for r in second])
        self.assertNotEqual([r['role_score'] for r in first], [r['role_score'] for r in second])

    def test_boundary_consolidator_multiplies_observability(self):
        row = self.score(in_deg=4, out_deg=0, out_kzt=0., pass_through=0., depth=4, truncated_by_depth=True)
        self.assertEqual(row['role'], 'consolidator')
        self.assertAlmostEqual(row['role_score'], .6 * row['role_strength'])
        self.assertIn('Граница', row['evidence'])

    def test_coordinator_positive_linear_quantile(self):
        rows = [fixture_row(A + i, betweenness=float(i + 1), neighbor_cluster_count=2) for i in range(20)]
        result = score_features(rows, AnalysisConfig())
        self.assertTrue(all(abs(r['coordinator_cutoff'] - 19.05) < 1e-10 for r in result))
        self.assertEqual(sum(r['role'] == 'coordinator' for r in result), 1)
        self.assertNotEqual(self.score(betweenness=0, neighbor_cluster_count=2)['role'], 'coordinator')

    def test_percentiles_ties_zeros_and_isolates(self):
        rows = [fixture_row(A), fixture_row(B), fixture_row(C, betweenness=0), fixture_row(D, is_isolated=True, betweenness=100)]
        p = positive_percentiles(rows)
        self.assertEqual(p[str(A)]['betweenness'], .5)
        self.assertEqual(p[str(C)]['betweenness'], 0)
        self.assertEqual(p[str(D)]['betweenness'], 0)

    def test_isolate_priority_zero_despite_pagerank_and_seed_flag(self):
        row = self.score(is_isolated=True, is_seed=True, depth=0, in_deg=0, out_deg=0,
                         in_kzt=0., out_kzt=0., pagerank=.9, betweenness=0., pass_through=None)
        self.assertEqual((row['role'], row['role_score'], row['priority_score']), ('peripheral', 0, 0))
        self.assertTrue(all(f['contribution'] == 0 for f in row['priority_factors']))

    def test_priority_ties_use_numeric_gid(self):
        rows = [fixture_row(10), fixture_row(2)]
        result = score_features(rows, AnalysisConfig())
        self.assertEqual([r['gid'] for r in result], ['2', '10'])
        self.assertTrue(all(abs(sum(f['contribution'] for f in r['priority_factors']) - r['priority_score']) < 1e-12 for r in result))

    def test_config_rejects_unknown_fields_bad_weights_and_small_top(self):
        for data in ({'typo': 1}, {'ranking': {'betweenness': .9}}, {'top_n': 10},
                     {'roles': {'terminal_observation_days': 0}}):
            with self.assertRaises(ValidationError):
                AnalysisConfig.model_validate(data)


class PipelineTests(unittest.TestCase):
    def write_input(self, path, data):
        path.mkdir()
        for name, table in data.tables.items():
            pq.write_table(table, path / name)

    def test_full_export_repeats_byte_for_byte_and_preserves_snapshot_on_failure(self):
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, out = root / 'input', root / 'out'
            self.write_input(source, dataset())
            first = run_analysis(source, out, AnalysisConfig())
            hashes = {name: checksum(out / name) for name in CSV_FIELDS}
            second = run_analysis(source, out, AnalysisConfig())
            self.assertNotEqual(first['run_id'], second['run_id'])
            self.assertEqual(hashes, {name: checksum(out / name) for name in CSV_FIELDS})
            self.assertTrue((out / 'runs' / first['run_id'] / 'analysis.json').is_file())
            self.assertEqual(second['summary']['nodes_count'], 5)
            for name, fields in CSV_FIELDS.items():
                with (out / name).open() as stream:
                    reader = csv.DictReader(stream)
                    self.assertEqual(reader.fieldnames, fields)
                    rows = list(reader)
                    self.assertTrue(all(all(r.values()) for r in rows))
            with (out / 'nodes_roles.csv').open() as stream:
                self.assertEqual([r['gid'] for r in csv.DictReader(stream)], list(map(str, [A, B, C, D, E])))
            with (out / 'clusters.csv').open() as stream:
                for r in csv.DictReader(stream):
                    self.assertTrue(all(isinstance(g, str) for g in json.loads(r['top_gids'])))
            (source / 'edges.parquet').write_bytes(b'broken')
            with self.assertRaises(Exception):
                run_analysis(source, out, AnalysisConfig())
            self.assertEqual((out / 'latest').resolve().name, second['run_id'])
            self.assertEqual(hashes, {name: checksum(out / name) for name in CSV_FIELDS})
            self.assertTrue(list((out / 'failed').glob('*.json')))
            self.assertFalse((out / '.analysis.lock').exists())

    def test_empty_and_all_isolates_export(self):
        for empty in (False, True):
            with self.subTest(empty=empty), TemporaryDirectory() as temporary:
                root = Path(temporary)
                self.write_input(root / 'data', dataset(empty=empty, isolates=True))
                report = run_analysis(root / 'data', root / 'out', AnalysisConfig())
                self.assertEqual(report['summary']['nodes_count'], 0 if empty else 5)
                analysis = json.loads((root / 'out/latest/analysis.json').read_text())
                self.assertTrue(all(r['priority_score'] == 0 and r['role'] == 'peripheral' for r in analysis['nodes']))

    def test_existing_lock_refuses_concurrent_run(self):
        with TemporaryDirectory() as temporary:
            out = Path(temporary) / 'out'
            (out / '.analysis.lock').mkdir(parents=True)
            with self.assertRaisesRegex(ValueError, 'уже выполняется'):
                run_analysis(Path(temporary) / 'data', out, AnalysisConfig())


if __name__ == '__main__':
    unittest.main()
