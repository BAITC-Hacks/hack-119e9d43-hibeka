import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi } from '../src/api/index.ts';
import { createMockApi } from '../src/api/mock.ts';
import { demoClients, demoRun } from '../src/api/fixtures.ts';
import { loadOverview } from '../src/api/overview.ts';
import type { AnalyticsApi } from '../src/types/api.ts';
import { formatDate, formatMoney, formatScore } from '../src/utils/format.ts';

test('successful overview keeps exact long IDs and one run identity', async () => {
  const result = await loadOverview(
    createMockApi('success', 0),
    new AbortController().signal,
  );
  assert.ok(result);
  assert.equal(result.nodes.run_id, result.run.run_id);
  assert.equal(result.nodes.items.length, 7);
  assert.equal(result.nodes.items[0]?.gid, '900000000000000105');
  assert.ok(result.nodes.items.every((node) => typeof node.gid === 'string'));
  assert.equal(result.nodes.total, result.run.summary.n_nodes);
  assert.ok(
    result.nodes.items.some(
      (node) => node.is_seed && node.in_deg === 0 && node.out_deg === 0,
    ),
  );
  assert.ok(
    result.nodes.items.some(
      (node) => node.truncated_by_depth && node.role !== 'terminal',
    ),
  );
});

test('empty and failed requests remain distinct from a successful result', async () => {
  const signal = new AbortController().signal;
  assert.equal(await loadOverview(createMockApi('empty', 0), signal), null);
  await assert.rejects(
    loadOverview(createMockApi('error', 0), signal),
    /Демонстрационная ошибка/,
  );
});

test('loading scenario can be cancelled when switching screens', async () => {
  const controller = new AbortController();
  const result = loadOverview(createMockApi('loading', 0), controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('a cancelled response cannot publish its result', async () => {
  const controller = new AbortController();
  const api: AnalyticsApi = {
    listRuns: async () => {
      controller.abort();
      return [demoRun];
    },
    listNodes: async () => {
      throw new Error('Must not request nodes after abort');
    },
  };
  await assert.rejects(loadOverview(api, controller.signal), {
    name: 'AbortError',
  });
});

test('rejects mismatched run identity instead of combining results', async () => {
  const api: AnalyticsApi = {
    listRuns: async () => [demoRun],
    listNodes: async () => ({
      run_id: 'different-run',
      items: demoClients,
      total: 7,
    }),
  };
  await assert.rejects(
    loadOverview(api, new AbortController().signal),
    /разным запускам/,
  );
});

test('does not silently accept numeric identifiers rounded by JSON', async () => {
  const invalid = JSON.parse(JSON.stringify(demoClients)) as typeof demoClients;
  Object.assign(invalid[0]!, { gid: 900000000000000100 });
  const api: AnalyticsApi = {
    listRuns: async () => [demoRun],
    listNodes: async () => ({
      run_id: demoRun.run_id,
      items: invalid,
      total: 7,
    }),
  };
  await assert.rejects(
    loadOverview(api, new AbortController().signal),
    /строками из цифр/,
  );
});

test('latest completed run is chosen, not a newer failed run', async () => {
  const api: AnalyticsApi = {
    listRuns: async () => [
      { ...demoRun, run_id: 'older', created_at: '2026-08-01T00:00:00Z' },
      {
        ...demoRun,
        run_id: 'failed',
        created_at: '2026-10-01T00:00:00Z',
        status: 'failed',
      },
      demoRun,
    ],
    listNodes: async (runId) => ({
      run_id: runId,
      items: demoClients,
      total: 7,
    }),
  };
  const result = await loadOverview(api, new AbortController().signal);
  assert.equal(result?.run.run_id, demoRun.run_id);
});

test('completed run without summary fails explicitly', async () => {
  const api: AnalyticsApi = {
    listRuns: async () => [{ ...demoRun, summary: null }],
    listNodes: async () => {
      throw new Error('Must not request nodes without summary');
    },
  };
  await assert.rejects(
    loadOverview(api, new AbortController().signal),
    /отсутствует сводка/,
  );
});

test('mock responses are independent copies', async () => {
  const api = createMockApi('success', 0);
  const signal = new AbortController().signal;
  const first = await api.listNodes(
    demoRun.run_id,
    { offset: 0, limit: 7 },
    signal,
  );
  first.items[0]!.gid = '123';
  const second = await api.listNodes(
    demoRun.run_id,
    { offset: 0, limit: 7 },
    signal,
  );
  assert.equal(second.items[0]?.gid, '900000000000000105');
});

test('unsupported API mode cannot masquerade as a live connection', async () => {
  await assert.rejects(
    loadOverview(createApi('http', 'success'), new AbortController().signal),
    /ещё не реализовано/,
  );
});

test('formatting distinguishes absent dates and zero monetary amounts', () => {
  assert.equal(formatDate(null), 'Нет данных');
  assert.equal(formatDate('2026-07-01'), '01.07.2026');
  assert.equal(formatMoney(0), '0,00 KZT');
  assert.equal(formatScore(0), '0 / 100');
});
