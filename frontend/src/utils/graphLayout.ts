import type { AnalysisGraph } from '../api/client';

/** Positions encode direction relative to the selected client, never hop depth. */
export function directionLayout(graph: AnalysisGraph) {
  const incoming = new Set(
    graph.edges
      .filter((edge) => edge.target === graph.gid && edge.source !== graph.gid)
      .map((edge) => edge.source),
  );
  const outgoing = new Set(
    graph.edges
      .filter((edge) => edge.source === graph.gid && edge.target !== graph.gid)
      .map((edge) => edge.target),
  );
  const groups = {
    incoming: graph.nodes.filter(
      (node) => incoming.has(node.id) && !outgoing.has(node.id),
    ),
    outgoing: graph.nodes.filter(
      (node) => outgoing.has(node.id) && !incoming.has(node.id),
    ),
    both: graph.nodes.filter(
      (node) => incoming.has(node.id) && outgoing.has(node.id),
    ),
  };
  const positions: Record<string, { x: number; y: number }> = {
    [graph.gid]: { x: 450, y: 210 },
  };
  const sizes: Record<string, number> = { [graph.gid]: 44 };
  function place(
    nodes: typeof graph.nodes,
    x: number,
    y: number,
    width: number,
    height: number,
  ) {
    if (!nodes.length) return;
    const columns = Math.max(
      1,
      Math.ceil(Math.sqrt((nodes.length * width) / height)),
    );
    const rows = Math.ceil(nodes.length / columns);
    const stepX = width / columns;
    const stepY = Math.min(70, height / rows);
    const size = Math.max(14, Math.min(30, stepX * 0.6, stepY * 0.6));
    nodes.forEach((node, index) => {
      const row = Math.floor(index / columns);
      const rowCount = Math.min(columns, nodes.length - row * columns);
      positions[node.id] = {
        x: x + width / 2 + ((index % columns) - (rowCount - 1) / 2) * stepX,
        y: y + height / 2 + (row - (rows - 1) / 2) * stepY,
      };
      sizes[node.id] = size;
    });
  }
  place(groups.incoming, 30, 45, 280, 330);
  place(groups.outgoing, 590, 45, 280, 330);
  place(
    groups.both,
    220,
    420,
    460,
    Math.max(70, Math.ceil(groups.both.length / 10) * 40),
  );
  return {
    positions,
    sizes,
    groups,
    bounds: {
      x1: 0,
      y1: 0,
      x2: 900,
      y2: groups.both.length
        ? 440 + Math.max(70, Math.ceil(groups.both.length / 10) * 40)
        : 420,
    },
  };
}
