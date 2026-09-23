import type { AnalyticsApi, Run, RunSummary } from '../types/api.ts';

export interface Overview {
  run: Run & { summary: RunSummary };
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
  return { run: { ...latest, summary: latest.summary } };
}
