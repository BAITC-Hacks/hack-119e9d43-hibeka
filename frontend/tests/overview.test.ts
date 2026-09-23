import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/api/index.ts';
import { createMockApi } from '../src/api/mock.ts';
import { demoRun } from '../src/api/fixtures.ts';
import { loadOverview } from '../src/api/overview.ts';

test('overview chooses latest completed run, independently of queue failures', async () => {
  const api = createMockApi('queue-error', 0);
  api.listRuns = async () => [
    { ...demoRun, run_id: 'older', created_at: '2026-08-01T00:00:00Z' },
    {
      ...demoRun,
      run_id: 'failed',
      created_at: '2026-10-01T00:00:00Z',
      status: 'failed',
    },
    demoRun,
  ];
  const result = await loadOverview(api, new AbortController().signal);
  assert.equal(result?.run.run_id, demoRun.run_id);
  assert.equal(result?.run.summary.n_nodes, 63);
});

test('empty, failure, and missing summary remain explicit', async () => {
  const signal = new AbortController().signal;
  assert.equal(await loadOverview(createMockApi('empty', 0), signal), null);
  await assert.rejects(
    loadOverview(createMockApi('error', 0), signal),
    /Демонстрационная ошибка/,
  );
  const api = createMockApi('success', 0);
  api.listRuns = async () => [{ ...demoRun, summary: null }];
  await assert.rejects(loadOverview(api, signal), /отсутствует сводка/);
});

test('overview cancellation also guards a provider ignoring AbortSignal', async () => {
  const controller = new AbortController();
  const api = createMockApi('success', 0);
  api.listRuns = async () => {
    controller.abort();
    return [demoRun];
  };
  await assert.rejects(loadOverview(api, controller.signal), {
    name: 'AbortError',
  });
  const loading = new AbortController();
  const pending = loadOverview(createMockApi('loading', 0), loading.signal);
  loading.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('unsupported API mode never silently falls back to demo results', async () => {
  await assert.rejects(
    loadOverview(createApi('http', 'success'), new AbortController().signal),
    /ещё не реализовано/,
  );
});
