/** Identifiers cross every browser boundary as decimal strings, never numbers. */
export type Gid = string;
export type RunId = string;

export type Role =
  | 'consolidator'
  | 'transit'
  | 'distributor'
  | 'terminal'
  | 'coordinator'
  | 'peripheral';

export type RunState = 'queued' | 'running' | 'completed' | 'failed';

/** Proposed summary fields; finalize with the backend before HTTP integration. */
export interface RunSummary {
  period_start: string | null;
  period_end: string | null;
  n_nodes: number;
  n_edges: number;
  n_transactions: number;
  n_seed: number;
  n_clusters: number;
  n_isolated: number;
  n_truncated: number;
  sum_kzt: number;
  elapsed_seconds: number;
}

export interface ApiError {
  code: string;
  message: string;
  details: unknown;
}

export interface Run {
  run_id: RunId;
  created_at: string;
  status: RunState;
  stage: string | null;
  summary: RunSummary | null;
  warnings: string[];
  error: ApiError | null;
}

export interface ClientSummary {
  gid: Gid;
  rank: number;
  role: Role;
  role_score: number;
  priority_score: number;
  cluster_id: number;
  depth: number;
  is_seed: boolean;
  truncated_by_depth: boolean;
  in_deg: number;
  out_deg: number;
  in_kzt: number;
  out_kzt: number;
  evidence: string;
  /** Proposed field from the frontend specification; not inferred from evidence. */
  priority_reason_short: string;
}

export interface NodePage {
  run_id: RunId;
  items: ClientSummary[];
  total: number;
}

export interface NodeQuery {
  offset: number;
  limit: number;
  role?: Role;
  cluster_id?: number;
}

export interface PriorityFactor {
  name: string;
  raw_value: number | null;
  normalized_value: number;
  weight: number;
  contribution: number;
}

export interface Counterparty {
  gid: Gid;
  sum_kzt: number;
  n_tx: number;
}

export interface ClientDetails extends ClientSummary {
  run_id: RunId;
  metrics: Record<string, number | string | boolean | null>;
  role_selection_reason: string;
  role_explanation: string;
  priority_explanation: string;
  priority_factors: PriorityFactor[];
  warnings: string[];
  incoming: Counterparty[];
  outgoing: Counterparty[];
}

export interface GraphNode {
  id: Gid;
  role: Role;
  cluster_id: number;
  is_seed: boolean;
  truncated_by_depth: boolean;
}

export interface GraphEdge {
  id: string;
  source: Gid;
  target: Gid;
  sum_kzt: number;
  n_tx: number;
}

export interface GraphResponse {
  run_id: RunId;
  nodes: GraphNode[];
  edges: GraphEdge[];
  total_nodes: number;
  shown_nodes: number;
  truncated: boolean;
}

export interface Cluster {
  cluster_id: number;
  n_nodes: number;
  n_seed: number;
  sum_kzt_internal: number;
  top_gids: Gid[];
  hypothesis: string;
}

export interface ClusterResponse {
  run_id: RunId;
  items: Cluster[];
}

/** Only the reads needed for stage one are implemented. */
export interface AnalyticsApi {
  listRuns(signal: AbortSignal): Promise<Run[]>;
  listNodes(
    runId: RunId,
    query: NodeQuery,
    signal: AbortSignal,
  ): Promise<NodePage>;
}
