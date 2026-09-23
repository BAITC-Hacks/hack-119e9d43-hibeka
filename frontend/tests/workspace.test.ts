import assert from 'node:assert/strict';
import test from 'node:test';
import { createMockApi } from '../src/api/mock.ts';
import { demoClients, demoDetails, demoRun } from '../src/api/fixtures.ts';
import { buildNodeQuery, PAGE_SIZE } from '../src/api/queries.ts';
import { validatePage, validateClient } from '../src/api/validation.ts';
import { WorkspaceController } from '../src/state/workspace.ts';
import type { ClientDetails, NodePage } from '../src/types/api.ts';
import { copyGid } from '../src/utils/clipboard.ts';
import {
  formatDate,
  formatDecimal,
  formatInteger,
  formatMoney,
  formatScore,
  formatText,
} from '../src/utils/format.ts';

const signal = () => new AbortController().signal;
const first = demoClients[0]!;
const second = demoClients[1]!;

async function setup(
  scenario: Parameters<typeof createMockApi>[0] = 'success',
) {
  const api = createMockApi(scenario, 0);
  const controller = new WorkspaceController(api);
  await controller.open(demoRun.run_id);
  return { api, controller };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test('queue loads only one page, auto-selects first client and synchronizes card', async () => {
  const { controller } = await setup();
  const state = controller.getSnapshot();
  assert.equal(state.selectedGid, first.gid);
  assert.equal(state.queue.status, 'success');
  assert.equal(state.card.status, 'success');
  if (state.queue.status !== 'success' || state.card.status !== 'success')
    return;
  assert.equal(state.queue.data.items.length, 25);
  assert.equal(state.queue.data.total, 63);
  assert.equal(state.card.data.gid, state.selectedGid);
  assert.equal(state.card.data.incoming.length, 3);
  assert.equal(state.card.data.outgoing.length, 1);
});

test('pagination preserves selection and filters; changing filters resets page and selection', async () => {
  const { controller } = await setup();
  await controller.setPage(3);
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
  const page3 = controller.getSnapshot().queue;
  assert.equal(page3.status, 'success');
  if (page3.status === 'success') assert.equal(page3.data.items.length, 13);
  await controller.setFilters({ role: 'transit' });
  assert.equal(controller.getSnapshot().page, 1);
  await controller.setPage(2);
  assert.equal(controller.getSnapshot().filters.role, 'transit');
  const filtered = controller.getSnapshot().queue;
  if (filtered.status === 'success')
    assert.equal(filtered.data.items.length, 2);
  await controller.setFilters({ role: 'transit', cluster_id: 0 });
  assert.equal(controller.getSnapshot().page, 1);
  const both = controller.getSnapshot().queue;
  assert.equal(both.status, 'success');
  if (both.status === 'success')
    assert.ok(
      both.data.items.every(
        (node) => node.role === 'transit' && node.cluster_id === 0,
      ),
    );
  await controller.setFilters({});
  assert.deepEqual(controller.getSnapshot().filters, {});
});

test('empty intersection clears the card by explicit filter policy and recovers', async () => {
  const { controller } = await setup();
  await controller.setFilters({ role: 'transit', cluster_id: 1 });
  const state = controller.getSnapshot();
  assert.equal(state.selectedGid, null);
  assert.equal(state.card.status, 'idle');
  if (state.queue.status === 'success') assert.equal(state.queue.data.total, 0);
  await controller.setFilters({});
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
});

test('exact trimmed search opens any client on its global page and clears filters', async () => {
  const { controller } = await setup();
  await controller.setFilters({ role: 'consolidator' });
  const isolated = demoClients.find(
    (node) => node.gid === '900000000000000107',
  )!;
  controller.setSearchInput(`  ${isolated.gid}  `);
  await controller.search();
  const state = controller.getSnapshot();
  assert.equal(state.selectedGid, isolated.gid);
  assert.equal(state.searchInput, isolated.gid);
  assert.equal(state.page, Math.floor((isolated.rank - 1) / PAGE_SIZE) + 1);
  assert.deepEqual(state.filters, {});
  assert.match(state.notice ?? '', /Фильтры сняты/);
  if (state.card.status === 'success') {
    assert.equal(state.card.data.incoming.length, 0);
    assert.equal(state.card.data.outgoing.length, 0);
  }
});

test('invalid or unknown search preserves existing selection and empty query is cleared', async () => {
  const { controller } = await setup();
  controller.setSearchInput('abc');
  await controller.search();
  assert.equal(controller.getSnapshot().search.status, 'error');
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
  controller.setSearchInput('123');
  await controller.search();
  assert.equal(controller.getSnapshot().search.status, 'error');
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
  controller.setSearchInput('  ');
  await controller.search();
  assert.equal(controller.getSnapshot().searchInput, '');
  assert.equal(controller.getSnapshot().search.status, 'idle');
});

test('editing or clearing the query resets pagination without clearing selection', async () => {
  const { controller } = await setup();
  await controller.setPage(3);
  controller.setSearchInput('9000');
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
  controller.clearSearch();
  assert.equal(controller.getSnapshot().searchInput, '');
  controller.dispose();
});

test('counterparty and cluster top-client entry points use the same selected ID', async () => {
  const { controller } = await setup();
  const details = controller.getSnapshot().card;
  assert.equal(details.status, 'success');
  if (details.status !== 'success') return;
  const target = details.data.incoming[0]!.gid;
  await controller.select(target, true);
  assert.equal(controller.getSnapshot().selectedGid, target);
  const card = controller.getSnapshot().card;
  if (card.status === 'success') assert.equal(card.data.gid, target);
  const clusters = controller.getSnapshot().clusters;
  if (clusters.status !== 'success') return;
  const top = clusters.data.items[4]!.top_gids[0]!;
  await controller.select(top, true);
  assert.equal(controller.getSnapshot().selectedGid, top);
});

test('repeat selection issues no request; refresh preserves selected client', async () => {
  const { api, controller } = await setup();
  let calls = 0;
  const original = api.getNode;
  api.getNode = (...args) => {
    calls += 1;
    return original(...args);
  };
  await controller.select(first.gid);
  assert.equal(calls, 0);
  controller.setSearchInput(first.gid);
  await controller.search();
  assert.equal(calls, 0);
  await controller.select(second.gid);
  assert.equal(calls, 1);
  await controller.open(demoRun.run_id);
  assert.equal(controller.getSnapshot().selectedGid, second.gid);
  assert.equal(calls, 2);
});

test('editing a search rejects its late response even if the adapter ignores cancellation', async () => {
  const { api, controller } = await setup();
  const old = deferred<ClientDetails>();
  const original = api.getNode;
  api.getNode = (run, gid, abort) =>
    gid === second.gid ? old.promise : original(run, gid, abort);
  controller.setSearchInput(second.gid);
  const pending = controller.search();
  controller.setSearchInput(demoClients[3]!.gid);
  await controller.search();
  old.resolve(demoDetails(second));
  await pending;
  assert.equal(controller.getSnapshot().selectedGid, demoClients[3]!.gid);
  assert.equal(controller.getSnapshot().search.status, 'success');
});

test('switching runs resets selection and rejects the old card response', async () => {
  const { api, controller } = await setup();
  const old = deferred<ClientDetails>();
  api.getNode = () => old.promise;
  const pending = controller.select(second.gid);
  api.listNodes = async (run) => ({ run_id: run, items: [], total: 0 });
  api.listClusters = async (run) => ({ run_id: run, items: [] });
  await controller.open('new-run');
  old.resolve(demoDetails(second));
  await pending;
  assert.equal(controller.getSnapshot().runId, 'new-run');
  assert.equal(controller.getSnapshot().selectedGid, null);
  assert.equal(controller.getSnapshot().card.status, 'idle');
});

test('cluster failure stays isolated and can be retried', async () => {
  const { api, controller } = await setup();
  const original = api.listClusters;
  api.listClusters = async () => {
    throw new Error('Кластеры недоступны');
  };
  await controller.loadClusters();
  assert.equal(controller.getSnapshot().clusters.status, 'error');
  assert.equal(controller.getSnapshot().queue.status, 'success');
  assert.equal(controller.getSnapshot().card.status, 'success');
  api.listClusters = original;
  await controller.loadClusters();
  assert.equal(controller.getSnapshot().clusters.status, 'success');
});

test('refresh during a search cancels it without leaving the search action locked', async () => {
  const { api, controller } = await setup();
  const old = deferred<ClientDetails>();
  const original = api.getNode;
  api.getNode = (run, gid, abort) =>
    gid === second.gid ? old.promise : original(run, gid, abort);
  controller.setSearchInput(second.gid);
  const pending = controller.search();
  await controller.open(demoRun.run_id);
  old.resolve(demoDetails(second));
  await pending;
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
  assert.equal(controller.getSnapshot().search.status, 'idle');
  api.getNode = original;
  await controller.search();
  assert.equal(controller.getSnapshot().selectedGid, second.gid);
});

test('card responses arriving out of order cannot overwrite a newer selection', async () => {
  const { api, controller } = await setup();
  const a = demoClients[2]!;
  const b = demoClients[3]!;
  const slow = deferred<ClientDetails>();
  const fast = deferred<ClientDetails>();
  api.getNode = (_run, gid) => (gid === a.gid ? slow.promise : fast.promise);
  const observed: boolean[] = [];
  const unsubscribe = controller.subscribe(() => {
    const s = controller.getSnapshot();
    observed.push(
      s.card.status !== 'success' || s.card.data.gid === s.selectedGid,
    );
  });
  const p1 = controller.select(a.gid);
  const p2 = controller.select(b.gid);
  assert.equal(controller.getSnapshot().card.status, 'loading');
  fast.resolve(demoDetails(b));
  await p2;
  slow.resolve(demoDetails(a));
  await p1;
  const state = controller.getSnapshot();
  assert.equal(state.selectedGid, b.gid);
  if (state.card.status === 'success') assert.equal(state.card.data.gid, b.gid);
  assert.ok(observed.every(Boolean));
  unsubscribe();
});

test('a row selection cancels an outstanding exact search', async () => {
  const { api, controller } = await setup();
  const slow = deferred<ClientDetails>();
  const original = api.getNode;
  api.getNode = (run, gid, abort) =>
    gid === second.gid ? slow.promise : original(run, gid, abort);
  controller.setSearchInput(second.gid);
  const pending = controller.search();
  const target = demoClients[3]!;
  await controller.select(target.gid);
  slow.resolve(demoDetails(second));
  await pending;
  assert.equal(controller.getSnapshot().selectedGid, target.gid);
});

test('stale queue responses cannot replace a newer page', async () => {
  const { api, controller } = await setup();
  const slow = deferred<NodePage>();
  const fast = deferred<NodePage>();
  api.listNodes = (_run, query) =>
    query.offset === 25 ? slow.promise : fast.promise;
  const p2 = controller.setPage(2);
  const p3 = controller.setPage(3);
  fast.resolve({
    run_id: demoRun.run_id,
    items: demoClients.slice(50),
    total: 63,
  });
  await p3;
  slow.resolve({
    run_id: demoRun.run_id,
    items: demoClients.slice(25, 50),
    total: 63,
  });
  await p2;
  const state = controller.getSnapshot();
  assert.equal(state.page, 3);
  if (state.queue.status === 'success')
    assert.equal(state.queue.data.items[0]?.rank, 51);
});

test('shrinking results clamp invalid page without dropping the selected client', async () => {
  const { api, controller } = await setup();
  await controller.setPage(3);
  api.listNodes = async (run, query) => ({
    run_id: run,
    items: query.offset === 0 ? [first] : [],
    total: 1,
  });
  await controller.loadQueue();
  assert.equal(controller.getSnapshot().page, 1);
  assert.equal(controller.getSnapshot().selectedGid, first.gid);
});

test('queue, card, missing client, and partial data have separate states', async () => {
  const queueError = await setup('queue-error');
  assert.equal(queueError.controller.getSnapshot().queue.status, 'error');
  const cardError = await setup('card-error');
  assert.equal(cardError.controller.getSnapshot().card.status, 'error');
  assert.equal(cardError.controller.getSnapshot().queue.status, 'success');
  const partial = await setup('partial');
  const card = partial.controller.getSnapshot().card;
  if (card.status === 'success') {
    assert.equal(formatInteger(card.data.metrics.in_tx), 'Нет данных');
    assert.equal(card.data.priority_factors.length, 0);
  }
  const normal = await setup();
  await normal.controller.select('123');
  assert.equal(normal.controller.getSnapshot().card.status, 'error');
  assert.equal(normal.controller.getSnapshot().selectedGid, '123');
});

test('response guards reject mixed runs, wrong clients and numeric IDs', () => {
  assert.throws(
    () =>
      validatePage({ run_id: 'wrong', total: 0, items: [] }, demoRun.run_id),
    /разным запускам/,
  );
  const broken = structuredClone(first);
  Object.assign(broken, { gid: 900000000000000100 });
  assert.throws(
    () =>
      validatePage(
        { run_id: demoRun.run_id, items: [broken], total: 1 },
        demoRun.run_id,
      ),
    /строками из цифр/,
  );
  assert.throws(
    () => validateClient(demoDetails(first), demoRun.run_id, second.gid),
    /некорректным идентификатором/,
  );
});

test('query building excludes empty filters and rejects invalid page/cluster', () => {
  assert.deepEqual(buildNodeQuery(2, {}), { offset: 25, limit: 25 });
  assert.deepEqual(buildNodeQuery(1, { role: 'transit', cluster_id: 0 }), {
    offset: 0,
    limit: 25,
    role: 'transit',
    cluster_id: 0,
  });
  assert.throws(() => buildNodeQuery(0, {}));
  assert.throws(() => buildNodeQuery(1, { cluster_id: -1 }));
});

test('copy preserves exact gid, propagates permission failure and supports repeating', async () => {
  const writes: string[] = [];
  const clipboard = {
    writeText: async (text: string) => {
      writes.push(text);
    },
  };
  await copyGid(first.gid, clipboard);
  await copyGid(first.gid, clipboard);
  assert.deepEqual(writes, [first.gid, first.gid]);
  await assert.rejects(
    copyGid(first.gid, {
      writeText: async () => {
        throw new Error('denied');
      },
    }),
    /Не удалось скопировать/,
  );
  await assert.rejects(
    copyGid(first.gid, undefined),
    /Буфер обмена недоступен/,
  );
  await assert.rejects(copyGid('', clipboard), /корректного gid/);
  assert.equal(writes.length, 2);
});

test('formatters never show undefined, NaN, null or invalid calendar dates', () => {
  assert.equal(formatMoney(0), '0,00 KZT');
  assert.equal(formatScore(0), '0 / 100');
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(formatMoney(value), 'Нет данных');
    assert.equal(formatInteger(value), 'Нет данных');
    assert.equal(formatDecimal(value), 'Нет данных');
  }
  assert.equal(formatText(''), 'Нет данных');
  assert.equal(formatDate('2026-02-30'), 'Нет данных');
  assert.equal(formatDate('2026-07-01'), '01.07.2026');
});

test('mock data are isolated copies and all counterpart links resolve', async () => {
  const api = createMockApi('success', 0);
  const page = await api.listNodes(
    demoRun.run_id,
    buildNodeQuery(1, {}),
    signal(),
  );
  page.items[0]!.gid = '123';
  assert.equal(
    (await api.listNodes(demoRun.run_id, buildNodeQuery(1, {}), signal()))
      .items[0]?.gid,
    first.gid,
  );
  const known = new Set(demoClients.map((node) => node.gid));
  for (const client of demoClients) {
    const details = demoDetails(client);
    assert.ok(
      [...details.incoming, ...details.outgoing].every((node) =>
        known.has(node.gid),
      ),
    );
    assert.ok(
      Math.abs(
        details.priority_factors.reduce(
          (sum, factor) => sum + factor.contribution,
          0,
        ) - client.priority_score,
      ) < 1e-10,
    );
  }
});
