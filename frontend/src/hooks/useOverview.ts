import { useEffect, useState } from 'react';
import type { AnalyticsApi } from '../types/api';
import { loadOverview, type Overview } from '../api/overview';

export type OverviewState =
  | { status: 'loading' }
  | { status: 'success'; data: Overview }
  | { status: 'empty' }
  | { status: 'error'; message: string };

export function useOverview(
  api: AnalyticsApi,
  revision: number,
): OverviewState {
  const [snapshot, setSnapshot] = useState<{
    api: AnalyticsApi;
    revision: number;
    state: OverviewState;
  }>({ api, revision, state: { status: 'loading' } });

  useEffect(() => {
    const controller = new AbortController();
    void loadOverview(api, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) {
          setSnapshot({
            api,
            revision,
            state: data ? { status: 'success', data } : { status: 'empty' },
          });
        }
      },
      (error: unknown) => {
        if (!controller.signal.aborted) {
          setSnapshot({
            api,
            revision,
            state: {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Не удалось загрузить данные.',
            },
          });
        }
      },
    );
    return () => controller.abort();
  }, [api, revision]);

  return snapshot.api === api && snapshot.revision === revision
    ? snapshot.state
    : { status: 'loading' };
}
