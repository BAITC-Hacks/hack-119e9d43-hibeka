"""Local graph selection, direction, truncation and exact identifiers."""
from copy import deepcopy
import json
import unittest

from backend.app.local_graph import build_local_graph

A, B, C, D, E = (str(100000000000000001 + i) for i in range(5))
RUN = 'a' * 32


def node(gid, priority=.5, **overrides):
    row = dict(gid=gid, role='peripheral', role_score=0., priority_score=priority,
               rank=1, cluster_id=0, depth=1, is_seed=False, is_isolated=False,
               truncated_by_depth=False)
    row.update(overrides)
    return row


def edge(src, dst, amount=5000., count=1):
    return dict(src=src, dst=dst, sum_kzt=amount, n_tx=count)


class LocalGraphTests(unittest.TestCase):
    def setUp(self):
        self.data = dict(nodes=[node(A, .1), node(B, .7), node(C, .9), node(D),
                               node(E, is_isolated=True)],
                         edges=[edge(B, A, 10000., 2), edge(A, B, 20000., 3),
                                edge(A, C), edge(B, C), edge(C, D)])

    def test_both_directions_choose_one_hop_and_do_not_include_second_hop(self):
        result = build_local_graph(self.data, RUN, A)
        self.assertEqual([n.gid for n in result.nodes], [A, C, B])
        self.assertEqual((result.total_nodes, result.shown_nodes, result.truncated), (3, 3, False))
        self.assertEqual(result.run_id, RUN)
        self.assertEqual(result.hops, 1)

    def test_edges_between_neighbours_and_reciprocal_directions_are_preserved(self):
        result = build_local_graph(self.data, RUN, A)
        edges = {e.id: e for e in result.edges}
        self.assertEqual(set(edges), {f'{A}->{B}', f'{B}->{A}', f'{A}->{C}', f'{B}->{C}'})
        self.assertEqual((edges[f'{B}->{A}'].source, edges[f'{B}->{A}'].target), (B, A))
        self.assertEqual((edges[f'{B}->{A}'].sum_kzt, edges[f'{B}->{A}'].n_tx), (10000., 2))
        self.assertEqual((edges[f'{A}->{B}'].sum_kzt, edges[f'{A}->{B}'].n_tx), (20000., 3))

    def test_limit_preserves_center_and_highest_priority_neighbour(self):
        result = build_local_graph(self.data, RUN, A, 2)
        self.assertEqual([n.id for n in result.nodes], [A, C])
        self.assertEqual([e.id for e in result.edges], [f'{A}->{C}'])
        self.assertEqual((result.total_nodes, result.shown_nodes, result.truncated), (3, 2, True))
        self.assertEqual([n.id for n in result.nodes if n.selected], [A])

    def test_limit_one_returns_center_without_edges_to_hidden_nodes(self):
        result = build_local_graph(self.data, RUN, A, 1)
        self.assertEqual([n.id for n in result.nodes], [A])
        self.assertEqual(result.edges, [])
        self.assertTrue(result.truncated)

    def test_more_than_150_nodes_obeys_hard_limit(self):
        neighbours = [str(200000000000000001 + i) for i in range(180)]
        data = dict(nodes=[node(A, 0), *[node(g, i / 180) for i, g in enumerate(neighbours)]],
                    edges=[edge(A, g) for g in neighbours])
        result = build_local_graph(data, RUN, A)
        self.assertEqual((result.total_nodes, result.shown_nodes), (181, 150))
        self.assertTrue(result.truncated)
        self.assertEqual([n.id for n in result.nodes], [A, *list(reversed(neighbours))[:149]])
        self.assertEqual(len(result.edges), 149)

    def test_priority_ties_use_rounded_score_and_numeric_gid(self):
        data = dict(nodes=[node('1', 0), node('10', .50000000000001), node('2', .5)],
                    edges=[edge('1', '10'), edge('1', '2')])
        self.assertEqual([n.id for n in build_local_graph(data, RUN, '1').nodes], ['1', '2', '10'])

    def test_isolate_has_one_node_no_edges_and_no_truncation(self):
        result = build_local_graph(self.data, RUN, E, 1)
        self.assertEqual((result.total_nodes, result.shown_nodes, result.truncated), (1, 1, False))
        self.assertEqual(result.edges, [])
        self.assertTrue(result.nodes[0].is_isolated)

    def test_role_seed_boundary_and_global_rank_are_not_recalculated(self):
        self.data['nodes'][2].update(role='consolidator', role_score=.6, rank=23,
                                     cluster_id=8, is_seed=True, depth=4, truncated_by_depth=True)
        result = build_local_graph(self.data, RUN, A, 2)
        shown = result.nodes[1]
        self.assertEqual((shown.role, shown.role_score, shown.rank, shown.cluster_id), ('consolidator', .6, 23, 8))
        self.assertTrue(shown.is_seed and shown.truncated_by_depth)

    def test_exact_ids_survive_json_round_trip(self):
        serialized = json.loads(build_local_graph(self.data, RUN, A).model_dump_json())
        self.assertEqual(serialized['gid'], A)
        self.assertEqual({n['id'] for n in serialized['nodes']}, {A, B, C})
        self.assertTrue(all(isinstance(e['source'], str) and isinstance(e['target'], str) for e in serialized['edges']))

    def test_input_is_unchanged_and_order_is_reproducible(self):
        original = deepcopy(self.data)
        first = build_local_graph(self.data, RUN, A)
        self.assertEqual(self.data, original)
        shuffled = dict(nodes=list(reversed(original['nodes'])), edges=list(reversed(original['edges'])))
        self.assertEqual(first, build_local_graph(shuffled, RUN, A))

    def test_invalid_limit_and_unknown_node(self):
        for limit in (0, -1, 151):
            with self.assertRaises(ValueError):
                build_local_graph(self.data, RUN, A, limit)
        for gid in ('missing', str(float(A)), '0' + A):
            with self.assertRaises(KeyError):
                build_local_graph(self.data, RUN, gid)

    def test_self_loop_does_not_duplicate_center(self):
        self.data['edges'].append(edge(A, A))
        result = build_local_graph(self.data, RUN, A, 1)
        self.assertEqual(len(result.nodes), 1)
        self.assertEqual([e.id for e in result.edges], [f'{A}->{A}'])
        self.assertEqual(result.total_nodes, 3)


if __name__ == '__main__':
    unittest.main()
