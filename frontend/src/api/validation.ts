import type { ClientDetails, NodePage, ClusterResponse } from '../types/api.ts';
import { isValidGid } from '../utils/gid.ts';

function checkRun(actual: string, expected: string) {
  if (actual !== expected)
    throw new Error('Ответы относятся к разным запускам. Повторите загрузку.');
}

export function validatePage(page: NodePage, runId: string): NodePage {
  checkRun(page.run_id, runId);
  if (
    !Number.isSafeInteger(page.total) ||
    page.total < 0 ||
    page.items.some((node) => !isValidGid(node.gid)) ||
    new Set(page.items.map((node) => node.gid)).size !== page.items.length
  ) {
    throw new Error(
      'Некорректная очередь: идентификаторы должны быть уникальными строками из цифр.',
    );
  }
  return page;
}

export function validateClient(
  client: ClientDetails,
  runId: string,
  gid: string,
): ClientDetails {
  checkRun(client.run_id, runId);
  if (
    !isValidGid(client.gid) ||
    client.gid !== gid ||
    !Number.isSafeInteger(client.rank) ||
    client.rank < 1 ||
    [...client.incoming, ...client.outgoing].some(
      (node) => !isValidGid(node.gid),
    )
  ) {
    throw new Error(
      'Сервер вернул карточку с некорректным идентификатором или рангом.',
    );
  }
  return client;
}

export function validateClusters(
  value: ClusterResponse,
  runId: string,
): ClusterResponse {
  checkRun(value.run_id, runId);
  if (
    value.items.some(
      (cluster) =>
        !Number.isSafeInteger(cluster.cluster_id) ||
        cluster.cluster_id < 0 ||
        cluster.top_gids.some((gid) => !isValidGid(gid)),
    )
  ) {
    throw new Error('Некорректный ответ со списком кластеров.');
  }
  return value;
}
