"""Verify direction, attributes and isolated clients in the transaction graph."""

from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import networkx as nx
import pyarrow as pa

from backend.app.analytics.graph import build_graph, load_graph_summary, summarize_graph
from backend.app.data import DatasetError, ValidatedDataset
from backend.app.validation import validate_tables

A, B, C, D = (100000000000000001 + i for i in range(4))


class GraphTests(unittest.TestCase):
    def setUp(self):
        # Deliberately unsorted input, adjacent large IDs and a reciprocal pair.
        self.tables = {
            "nodes.parquet": pa.table({
                "gid": pa.array([D, B, A, C], type=pa.int64()),
                "depth": [0, 1, 0, 2], "is_seed": [True, False, True, False],
            }),
            "edges.parquet": pa.table({
                "src": pa.array([B, A, B], type=pa.int64()),
                "dst": pa.array([C, B, A], type=pa.int64()),
                "sum_kzt": [20000.0, 10000.0, 15000.0],
                "n_tx": [1, 2, 1], "depth": [2, 1, 2],
            }),
            "transactions.parquet": pa.table({
                "src": pa.array([A, A, B, B], type=pa.int64()),
                "dst": pa.array([B, B, A, C], type=pa.int64()),
                "sum_kzt": [5000.0, 5000.0, 15000.0, 20000.0],
                "date": pa.array([date(2026, 7, 1)] * 4, type=pa.date32()),
            }),
        }

    def graph(self):
        return build_graph(ValidatedDataset(self.tables, validate_tables(self.tables)))

    def test_all_nodes_including_isolate_and_exact_ids_are_preserved(self):
        graph = self.graph()
        self.assertEqual(list(graph), [A, B, C, D])
        self.assertTrue(all(isinstance(gid, int) for gid in graph))
        self.assertEqual(list(nx.isolates(graph)), [D])
        self.assertEqual(graph.nodes[D], {"depth": 0, "is_seed": True})
        self.assertEqual(graph.nodes[C], {"depth": 2, "is_seed": False})

    def test_direction_and_reciprocal_edges_are_preserved(self):
        graph = self.graph()
        self.assertTrue(graph.is_directed())
        self.assertEqual(set(graph.edges), {(A, B), (B, A), (B, C)})
        self.assertFalse(graph.has_edge(C, B))
        self.assertEqual(list(graph.successors(C)), [])
        self.assertEqual(set(graph.predecessors(C)), {B})

    def test_amount_counts_and_edge_depth_are_preserved(self):
        graph = self.graph()
        self.assertEqual(graph[A][B], {"sum_kzt": 10000.0, "n_tx": 2, "depth": 1})
        self.assertEqual(graph[B][A], {"sum_kzt": 15000.0, "n_tx": 1, "depth": 2})
        self.assertEqual(sum(edge["n_tx"] for _, _, edge in graph.edges(data=True)), 4)
        self.assertEqual(sum(edge["sum_kzt"] for _, _, edge in graph.edges(data=True)), 45000.0)

    def test_summary_counts_weak_components_with_isolates(self):
        summary = summarize_graph(self.graph())
        self.assertEqual(summary.model_dump(), {
            "directed": True, "nodes_count": 4, "edges_count": 3,
            "seed_count": 2, "isolated_nodes_count": 1,
            "weak_components_count": 2, "largest_component_size": 3,
        })

    def test_insertion_order_does_not_depend_on_input_row_order(self):
        first = self.graph()
        self.tables = {
            name: table.take(pa.array(list(reversed(range(table.num_rows))), type=pa.int64()))
            for name, table in self.tables.items()
        }
        second = self.graph()
        self.assertEqual(list(first.nodes(data=True)), list(second.nodes(data=True)))
        self.assertEqual(list(first.edges(data=True)), list(second.edges(data=True)))

    def test_graph_with_only_isolates_and_empty_graph(self):
        self.tables["edges.parquet"] = self.tables["edges.parquet"].slice(0, 0)
        self.tables["transactions.parquet"] = self.tables["transactions.parquet"].slice(0, 0)
        summary = summarize_graph(self.graph())
        self.assertEqual(summary.isolated_nodes_count, 4)
        self.assertEqual(summary.weak_components_count, 4)
        self.assertEqual(summary.largest_component_size, 1)
        self.tables["nodes.parquet"] = self.tables["nodes.parquet"].slice(0, 0)
        empty = summarize_graph(self.graph())
        self.assertEqual(empty.nodes_count, 0)
        self.assertEqual(empty.weak_components_count, 0)
        self.assertEqual(empty.largest_component_size, 0)

    def test_graph_loader_requires_dataset_files(self):
        with TemporaryDirectory() as directory:
            with self.assertRaisesRegex(DatasetError, "Не найден файл"):
                load_graph_summary(Path(directory))


if __name__ == "__main__":
    unittest.main()
