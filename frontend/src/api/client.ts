import type {
  Role,
  Counterparty,
  PriorityFactor,
  GraphResponse,
  Cluster,
} from '../types/api';

// The HTTP contract is independent of the original, optional preview fixtures.
export interface AnalysisRun {
  run_id: string;
  created_at: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  stage?: string;
  warnings?: string[];
  error?: { message: string; code: string } | null;
  total_seconds?: number;
  summary: {
    nodes_count: number;
    edges_count: number;
    transactions_count: number;
    seed_count: number;
    clusters_count: number;
    total_amount_kzt: number;
    period_start: string | null;
    period_end: string | null;
  } | null;
}

export interface AnalysisNode {
  gid: string;
  rank: number;
  role: Role;
  role_score: number;
  priority_score: number;
  cluster_id: number;
  depth: number;
  is_seed: boolean;
  is_isolated: boolean;
  truncated_by_depth: boolean;
  in_deg: number;
  out_deg: number;
  in_tx: number;
  out_tx: number;
  in_kzt: number;
  out_kzt: number;
  neighbor_count: number;
  neighbor_cluster_count: number;
  seed_in_direct: number;
  n_seed_upstream: number;
  first_in_date: string | null;
  days_after_first_in: number | null;
  evidence: string;
  role_selection_reason: string;
  role_explanation: string;
  priority_explanation: string;
  priority_factors: PriorityFactor[];
  warnings: string[];
}
export interface AnalysisDetail extends AnalysisNode {
  run_id: string;
  incoming: Counterparty[];
  outgoing: Counterparty[];
}
export interface AnalysisPage {
  run_id: string;
  total: number;
  items: AnalysisNode[];
}
export type AnalysisGraph = GraphResponse & { gid: string };
export interface Filters {
  role: string;
  cluster: string;
  seed: boolean;
  boundary: boolean;
}

export class ApiFailure extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function errorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const detail = 'detail' in body ? body.detail : body;
  if (typeof detail === 'string') return detail;
  if (
    detail &&
    typeof detail === 'object' &&
    'message' in detail &&
    typeof detail.message === 'string'
  )
    return detail.message;
  return undefined;
}
async function request<T>(
  path: string,
  signal?: AbortSignal,
  body?: FormData,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      signal,
      ...(body ? { method: 'POST', body } : {}),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'Не удалось подключиться к серверу. Проверьте соединение и повторите.',
    );
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    throw new ApiFailure(
      response.status,
      errorMessage(data) ?? `Не удалось получить данные (${response.status}).`,
    );
  }
  return response.json() as Promise<T>;
}
export const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : 'Не удалось выполнить запрос.';
const runPath = (id: string) => `/runs/${encodeURIComponent(id)}`;
function sameRun<T extends { run_id: string }>(data: T, id: string): T {
  if (data.run_id !== id)
    throw new Error('Ответ относится к другому анализу. Обновите данные.');
  return data;
}
export const http = {
  runs: (signal?: AbortSignal) =>
    request<{ items: AnalysisRun[] }>('/runs', signal),
  run: async (id: string, signal?: AbortSignal) =>
    sameRun(await request<AnalysisRun>(runPath(id), signal), id),
  nodes: async (
    id: string,
    offset: number,
    filters: Filters,
    signal?: AbortSignal,
  ) => {
    const params = new URLSearchParams({ offset: String(offset), limit: '30' });
    if (filters.role) params.set('role', filters.role);
    if (filters.cluster) params.set('cluster_id', filters.cluster);
    if (filters.seed) params.set('is_seed', 'true');
    if (filters.boundary) params.set('truncated_by_depth', 'true');
    const data = sameRun(
      await request<AnalysisPage>(`${runPath(id)}/nodes?${params}`, signal),
      id,
    );
    if (data.items.some((node) => typeof node.gid !== 'string'))
      throw new Error('Сервер вернул некорректный идентификатор клиента.');
    return data;
  },
  node: async (id: string, gid: string, signal?: AbortSignal) => {
    const data = sameRun(
      await request<AnalysisDetail>(
        `${runPath(id)}/nodes/${encodeURIComponent(gid)}`,
        signal,
      ),
      id,
    );
    if (data.gid !== gid) throw new Error('Ответ относится к другому клиенту.');
    return data;
  },
  graph: async (id: string, gid: string, signal?: AbortSignal) => {
    const data = sameRun(
      await request<AnalysisGraph>(
        `${runPath(id)}/graph?${new URLSearchParams({ gid, hops: '1', limit: '150' })}`,
        signal,
      ),
      id,
    );
    if (data.gid !== gid) throw new Error('Граф относится к другому клиенту.');
    return data;
  },
  clusters: async (id: string, signal?: AbortSignal) =>
    sameRun(
      await request<{ run_id: string; items: Cluster[] }>(
        `${runPath(id)}/clusters`,
        signal,
      ),
      id,
    ),
  upload: (body: FormData, signal?: AbortSignal) =>
    request<{ run_id: string; status: string }>('/runs', signal, body),
  exportUrl: (id: string, file: string) =>
    `/api${runPath(id)}/exports/${encodeURIComponent(file)}`,
};
