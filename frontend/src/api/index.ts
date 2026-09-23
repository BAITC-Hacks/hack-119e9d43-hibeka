import type { AnalyticsApi } from '../types/api.ts';
import { createMockApi, type MockScenario } from './mock.ts';

/** HTTP integration is stage four. Unknown modes must never silently show mocks. */
export function createApi(mode: string, scenario: MockScenario): AnalyticsApi {
  if (mode !== 'mock') {
    const unavailable = (): never => {
      throw new Error(
        'Подключение аналитического API ещё не реализовано. Для каркаса первого этапа установите VITE_API_MODE=mock.',
      );
    };
    return {
      listRuns: async () => unavailable(),
      listNodes: async () => unavailable(),
    };
  }
  return createMockApi(scenario);
}
