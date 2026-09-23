"""Check centrality against analytic results and an independent linear solve."""

import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException
import networkx as nx
import numpy as np

from backend.app.analytics.metrics import (
    CentralityError, calculate_client_metrics, load_client_metrics,
)
from backend.app.main import client_metrics

A, B, C, D = (100000000000000001 + i for i in range(4))


def make_graph(nodes, edges):
    graph = nx.DiGraph()
    for gid in nodes:
        graph.add_node(gid, depth=0 if gid == A else 1, is_seed=gid == A)
    for src, dst, amount in edges:
        graph.add_edge(src, dst, sum_kzt=amount, n_tx=1, depth=1)
    return graph


def by_id(graph):
    return {int(row.gid): row for row in calculate_client_metrics(graph)}


class CentralityTests(unittest.TestCase):
    def test_directed_chain_has_known_normalized_betweenness(self):
        rows = by_id(make_graph([A, B, C], [(A, B, 10), (B, C, 10)]))
        self.assertEqual(rows[A].betweenness, 0)
        self.assertEqual(rows[B].betweenness, 0.5)
        self.assertEqual(rows[C].betweenness, 0)
        self.assertLess(rows[A].pagerank, rows[B].pagerank)
        self.assertLess(rows[B].pagerank, rows[C].pagerank)

    def test_equal_shortest_paths_share_credit(self):
        rows = by_id(make_graph([A, B, C, D], [
            (A, B, 10), (A, C, 10), (B, D, 10), (C, D, 10),
        ]))
        self.assertAlmostEqual(rows[B].betweenness, 1 / 12)
        self.assertAlmostEqual(rows[C].betweenness, 1 / 12)
        self.assertEqual(rows[A].betweenness, 0)
        self.assertEqual(rows[D].betweenness, 0)

    def test_amounts_are_not_path_distances(self):
        graph = make_graph([A, B, C], [(A, B, 1), (B, C, 1), (A, C, 1000)])
        rows = by_id(graph)
        self.assertTrue(all(row.betweenness == 0 for row in rows.values()))
        graph[A][C]["sum_kzt"] = 0.01
        self.assertEqual(
            [row.betweenness for row in rows.values()],
            [row.betweenness for row in by_id(graph).values()],
        )

    def test_weighted_pagerank_matches_analytic_star(self):
        rows = by_id(make_graph([A, B, C], [(A, B, 100), (A, C, 300)]))
        alpha = 0.85
        expected = {A: 1 / (3 + alpha), B: (1 + alpha / 4) / (3 + alpha),
                    C: (1 + 3 * alpha / 4) / (3 + alpha)}
        for gid, score in expected.items():
            self.assertAlmostEqual(rows[gid].pagerank, score, delta=1e-7)

    def test_pagerank_matches_independent_linear_system_with_cycle_sink_isolate(self):
        nodes = [A, B, C, D]
        graph = make_graph(nodes, [(A, B, 10), (A, C, 30), (B, A, 20)])
        # Row-stochastic transition matrix, including uniform dangling rows.
        transition = np.array([
            [0, 0.25, 0.75, 0], [1, 0, 0, 0],
            [0.25, 0.25, 0.25, 0.25], [0.25, 0.25, 0.25, 0.25],
        ])
        expected = np.linalg.solve(np.eye(4) - 0.85 * transition.T, np.full(4, 0.15 / 4))
        rows = by_id(graph)
        for gid, score in zip(nodes, expected):
            self.assertAlmostEqual(rows[gid].pagerank, score, delta=1e-7)

    def test_isolate_is_preserved_and_included_in_normalization(self):
        rows = by_id(make_graph([A, B, C, D], [(A, B, 10), (B, C, 20)]))
        self.assertAlmostEqual(rows[B].betweenness, 1 / 6)
        isolated = rows[D]
        self.assertTrue(isolated.is_isolated)
        self.assertEqual(isolated.betweenness, 0)
        self.assertGreater(isolated.pagerank, 0)
        self.assertEqual(isolated.in_kzt + isolated.out_kzt, 0)
        self.assertAlmostEqual(sum(row.pagerank for row in rows.values()), 1)

    def test_empty_graph_and_graphs_with_only_isolates(self):
        self.assertEqual(calculate_client_metrics(nx.DiGraph()), [])
        for nodes in ([A], [A, B, C]):
            with self.subTest(nodes=nodes):
                rows = by_id(make_graph(nodes, []))
                for row in rows.values():
                    self.assertAlmostEqual(row.pagerank, 1 / len(nodes))
                    self.assertEqual(row.betweenness, 0)

    def test_input_order_does_not_change_scores_or_string_identifiers(self):
        edges = [(A, B, 10), (B, A, 20), (B, C, 30)]
        first = calculate_client_metrics(make_graph([A, B, C, D], edges))
        second = calculate_client_metrics(make_graph([D, C, B, A], list(reversed(edges))))
        encoded = json.loads(first[0].model_dump_json())
        self.assertEqual(encoded['gid'], str(A))
        self.assertEqual([row.gid for row in second], list(map(str, [A, B, C, D])))
        for left, right in zip(first, second):
            self.assertAlmostEqual(left.pagerank, right.pagerank, delta=1e-12)
            self.assertAlmostEqual(left.betweenness, right.betweenness, delta=1e-12)

    def test_basic_metrics_remain_correct(self):
        graph = make_graph([A, B, C, D], [(A, B, 0.10), (B, A, 0.20), (C, B, 0.20)])
        graph[A][B]['n_tx'] = 2
        row = by_id(graph)[B]
        self.assertEqual((row.in_deg, row.out_deg, row.in_tx, row.out_tx), (2, 1, 3, 1))
        self.assertEqual((row.in_kzt, row.out_kzt, row.net_flow_kzt), (0.30, 0.20, 0.10))

    def test_algorithm_parameters_match_specification(self):
        graph = make_graph([A, B, C], [(A, B, 1), (B, C, 1)])
        with patch('backend.app.analytics.metrics.nx.pagerank', wraps=nx.pagerank) as rank:
            with patch('backend.app.analytics.metrics.nx.betweenness_centrality',
                       wraps=nx.betweenness_centrality) as between:
                calculate_client_metrics(graph)
        rank.assert_called_once_with(graph, alpha=0.85, personalization=None,
                                     max_iter=1000, tol=1e-8, weight='sum_kzt', dangling=None)
        between.assert_called_once_with(graph, k=None, normalized=True, weight=None, endpoints=False)

    def test_nonconvergence_is_an_error_not_zero_scores(self):
        with patch('backend.app.analytics.metrics.nx.pagerank',
                   side_effect=nx.PowerIterationFailedConvergence(1000)):
            with self.assertRaisesRegex(CentralityError, 'не сошёлся'):
                calculate_client_metrics(make_graph([A], []))

    def test_nonconvergence_is_mapped_to_http_503(self):
        with patch('backend.app.main.load_client_metrics', side_effect=CentralityError('PageRank не сошёлся')):
            with self.assertRaises(HTTPException) as raised:
                client_metrics(offset=0, limit=100)
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(raised.exception.detail, 'PageRank не сошёлся')

    def test_pagination_does_not_recalculate_on_subgraph(self):
        graph = make_graph([A, B, C, D], [(A, B, 10), (B, C, 20)])
        dataset = SimpleNamespace(validation=SimpleNamespace(warnings=['example']))
        with patch('backend.app.analytics.metrics.load_dataset', return_value=dataset):
            with patch('backend.app.analytics.metrics.build_graph', return_value=graph):
                full = load_client_metrics(limit=500)
                page = load_client_metrics(offset=1, limit=2)
                empty = load_client_metrics(offset=4, limit=2)
        self.assertEqual(page.items, full.items[1:3])
        self.assertEqual(page.total_count, 4)
        self.assertEqual(page.validation.warnings, ['example'])
        self.assertEqual(empty.items, [])

    def test_invalid_pagination_is_rejected_before_loading(self):
        with patch('backend.app.analytics.metrics.load_dataset') as load:
            for offset, limit in [(-1, 100), (0, 0), (0, 501)]:
                with self.subTest(offset=offset, limit=limit):
                    with self.assertRaises(ValueError):
                        load_client_metrics(offset=offset, limit=limit)
            load.assert_not_called()


if __name__ == '__main__':
    unittest.main()
