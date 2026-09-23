import type { AnalysisGraph } from '../api/client';

export type GraphDirection = 'all' | 'incoming' | 'outgoing';

/** Reduce only the visible graph. Server analytics and global ranks stay intact. */
export function selectGraphView(
  graph: AnalysisGraph,
  direction: GraphDirection,
  showAll: boolean,
) {
  const allowed = new Set<string>();
  for (const edge of graph.edges) {
    if (direction !== 'outgoing' && edge.target === graph.gid)
      allowed.add(edge.source);
    if (direction !== 'incoming' && edge.source === graph.gid)
      allowed.add(edge.target);
  }
  allowed.delete(graph.gid);
  // The server returns direct neighbours in descending priority order.
  const candidates = graph.nodes.filter(
    (node) => node.id !== graph.gid && allowed.has(node.id),
  );
  const neighbours = showAll ? candidates : candidates.slice(0, 20);
  const ids = new Set([graph.gid, ...neighbours.map((node) => node.id)]);
  const nodes = graph.nodes.filter((node) => ids.has(node.id));
  const edges = graph.edges.filter(
    (edge) =>
      ids.has(edge.source) &&
      ids.has(edge.target) &&
      (direction === 'all' ||
        (direction === 'incoming'
          ? edge.target === graph.gid
          : edge.source === graph.gid)),
  );
  return {
    eligibleCount: candidates.length,
    shownCount: neighbours.length,
    graph: { ...graph, nodes, edges, shown_nodes: nodes.length },
  };
}
