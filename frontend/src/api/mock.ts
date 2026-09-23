import type { AnalyticsApi } from '../types/api.ts';
import { demoClients, demoRun } from './fixtures.ts';

export type MockScenario = 'success' | 'loading' | 'empty' | 'error';

export function isMockScenario(value: string): value is MockScenario {
  return ['success', 'loading', 'empty', 'error'].includes(value);
}

function waitForResponse(
  signal: AbortSignal,
  delay: number | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (delay !== null) {
      timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, delay);
    }
  });
}

export function createMockApi(
  scenario: MockScenario,
  delay = 450,
): AnalyticsApi {
  return {
    async listRuns(signal) {
      await waitForResponse(signal, scenario === 'loading' ? null : delay);
      if (scenario === 'error') {
        throw new Error(
          'Демонстрационная ошибка: не удалось получить данные запуска.',
        );
      }
      return scenario === 'empty' ? [] : structuredClone([demoRun]);
    },
    async listNodes(runId, query, signal) {
      await waitForResponse(signal, delay);
      if (runId !== demoRun.run_id) {
        throw new Error('Демонстрационный запуск не найден.');
      }
      return structuredClone({
        run_id: runId,
        items: demoClients.slice(query.offset, query.offset + query.limit),
        total: demoClients.length,
      });
    },
  };
}
