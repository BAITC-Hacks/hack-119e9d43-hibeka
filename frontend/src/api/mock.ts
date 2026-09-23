import type { AnalyticsApi } from '../types/api.ts';
import { demoClients, demoRun, demoDetails, demoClusters } from './fixtures.ts';
import { ApiRequestError } from './errors.ts';
import { filterNodes } from './queries.ts';

export type MockScenario =
  | 'success'
  | 'loading'
  | 'empty'
  | 'error'
  | 'queue-error'
  | 'card-error'
  | 'partial';

export function isMockScenario(value: string): value is MockScenario {
  return [
    'success',
    'loading',
    'empty',
    'error',
    'queue-error',
    'card-error',
    'partial',
  ].includes(value);
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
      if (scenario === 'queue-error')
        throw new ApiRequestError(
          'UNAVAILABLE',
          'Демонстрационная ошибка загрузки очереди.',
        );
      const items = filterNodes(demoClients, query);
      return structuredClone({
        run_id: runId,
        items: items.slice(query.offset, query.offset + query.limit),
        total: items.length,
      });
    },
    async getNode(runId, gid, signal) {
      // Different durations intentionally exercise cancellation on fast selection.
      await waitForResponse(signal, delay + (gid.endsWith('105') ? delay : 0));
      if (scenario === 'card-error')
        throw new ApiRequestError(
          'UNAVAILABLE',
          'Демонстрационная ошибка загрузки карточки.',
        );
      const node = demoClients.find((client) => client.gid === gid);
      if (runId !== demoRun.run_id || !node)
        throw new ApiRequestError(
          'NOT_FOUND',
          'Клиент с таким идентификатором не найден в выбранном наборе.',
        );
      const details = demoDetails(node);
      if (scenario === 'partial') {
        details.metrics = {
          in_tx: null,
          out_tx: null,
          pass_through: null,
          first_in_date: null,
          days_after_first_in: null,
        };
        details.role_selection_reason = '';
        details.priority_explanation = '';
        details.priority_factors = [];
        details.warnings.push(
          'Часть показателей не предоставлена в демонстрационном ответе.',
        );
      }
      return structuredClone(details);
    },
    async listClusters(runId, signal) {
      await waitForResponse(signal, delay);
      if (runId !== demoRun.run_id)
        throw new ApiRequestError('NOT_FOUND', 'Запуск не найден.');
      return structuredClone({ run_id: runId, items: demoClusters });
    },
  };
}
