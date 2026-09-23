import type { ClientSummary, NodeQuery, Role } from '../types/api.ts';

export interface QueueFilters {
  role?: Role;
  cluster_id?: number;
}
export const PAGE_SIZE = 25;

export function buildNodeQuery(page: number, filters: QueueFilters): NodeQuery {
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error('Некорректный номер страницы.');
  if (
    filters.cluster_id !== undefined &&
    (!Number.isSafeInteger(filters.cluster_id) || filters.cluster_id < 0)
  ) {
    throw new Error('Некорректный кластер.');
  }
  return {
    offset: (page - 1) * PAGE_SIZE,
    limit: PAGE_SIZE,
    ...(filters.role ? { role: filters.role } : {}),
    ...(filters.cluster_id !== undefined
      ? { cluster_id: filters.cluster_id }
      : {}),
  };
}

export function filterNodes(
  nodes: ClientSummary[],
  query: QueueFilters,
): ClientSummary[] {
  return nodes.filter(
    (node) =>
      (query.role === undefined || node.role === query.role) &&
      (query.cluster_id === undefined || node.cluster_id === query.cluster_id),
  );
}
