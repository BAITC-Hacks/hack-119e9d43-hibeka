import type { AnalyticsApi, NodePage, Run, RunSummary } from '../types/api.ts';

export interface Overview {
  run: Run & { summary: RunSummary };
  nodes: NodePage;
}

export async function loadOverview(
  api: AnalyticsApi,
  signal: AbortSignal,
): Promise<Overview | null> {
  const runs = await api.listRuns(signal);
  signal.throwIfAborted();
  const latest = runs
    .filter((run) => run.status === 'completed')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!latest) return null;
  if (!latest.summary)
    throw new Error('В завершённом запуске отсутствует сводка.');
  const nodes = await api.listNodes(
    latest.run_id,
    { offset: 0, limit: 7 },
    signal,
  );
  signal.throwIfAborted();
  if (nodes.run_id !== latest.run_id) {
    throw new Error('Ответы относятся к разным запускам. Повторите загрузку.');
  }
  if (
    nodes.items.some(
      (node) => typeof node.gid !== 'string' || !/^\d+$/.test(node.gid),
    )
  ) {
    throw new Error(
      'API должен передавать идентификаторы клиентов строками из цифр.',
    );
  }
  return { run: { ...latest, summary: latest.summary }, nodes };
}
