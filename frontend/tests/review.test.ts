import assert from 'node:assert/strict';
import test from 'node:test';
import { http, REVIEW_PAGE_SIZE } from '../src/api/client.ts';
import type { AnalysisNode } from '../src/api/client.ts';
import {
  emptyFilters,
  initialReviewState,
  reviewQueryKey,
  reviewReducer,
} from '../src/state/review.ts';
import { RequestGate } from '../src/state/requestGate.ts';
import { formatMoney } from '../src/utils/format.ts';
import { copyGid } from '../src/utils/clipboard.ts';

const node: AnalysisNode = {
  gid: '900000000000000101',
  rank: 1,
  role: 'transit',
  role_score: 0.5,
  priority_score: 0.7,
  cluster_id: 0,
  depth: 1,
  is_seed: false,
  is_isolated: false,
  truncated_by_depth: false,
  in_deg: 1,
  out_deg: 1,
  in_tx: 1,
  out_tx: 1,
  in_kzt: 1234.56,
  out_kzt: 1000.01,
  neighbor_count: 2,
  neighbor_cluster_count: 1,
  seed_in_direct: 1,
  n_seed_upstream: 1,
  first_in_date: '2026-07-01',
  days_after_first_in: 30,
  evidence: 'Тест',
  role_selection_reason: 'Тест',
  role_explanation: 'Тест',
  priority_explanation: 'Тест',
  priority_factors: [],
  warnings: [],
};
const page = (items = [node], total = 65) => ({ run_id: 'run', items, total });
const initial = () =>
  reviewReducer(initialReviewState, {
    type: 'page-loaded',
    key: reviewQueryKey(initialReviewState),
    page: page(),
  });

test('live review persists both the default client and explicit selection across pages', () => {
  let state = initial();
  assert.equal(state.picked, node.gid);
  state = reviewReducer(state, { type: 'page', offset: REVIEW_PAGE_SIZE });
  assert.equal(state.picked, node.gid);
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page([{ ...node, gid: '900000000000000102' }]),
  });
  assert.equal(state.picked, node.gid);
  state = reviewReducer(state, { type: 'select', gid: '900000000000000103' });
  state = reviewReducer(state, { type: 'page', offset: 0 });
  assert.equal(state.picked, '900000000000000103');
});

test('filters reset the page and reject the old queue before choosing the first matching client', () => {
  let state = reviewReducer(initial(), { type: 'page', offset: 60 });
  const oldKey = reviewQueryKey(state);
  state = reviewReducer(state, { type: 'filters', filters: { cluster: '0' } });
  assert.equal(state.offset, 0);
  assert.equal(state.picked, '');
  assert.equal(
    reviewReducer(state, { type: 'page-loaded', key: oldKey, page: page() }),
    state,
  );
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page(),
  });
  assert.equal(state.picked, node.gid);
  state = reviewReducer(state, { type: 'page', offset: 30 });
  assert.equal(state.filters.cluster, '0');
});

test('editing and clearing search reset the page without changing the card; stale success and error are ignored', () => {
  let state = reviewReducer(initial(), { type: 'page', offset: 60 });
  state = reviewReducer(state, { type: 'search-start', value: node.gid });
  const oldVersion = state.searchVersion;
  state = reviewReducer(state, { type: 'edit-search', value: '123' });
  assert.equal(state.offset, 0);
  assert.equal(state.searching, false);
  assert.equal(state.picked, node.gid);
  assert.equal(
    reviewReducer(state, {
      type: 'search-found',
      version: oldVersion,
      node: { ...node, gid: '456' },
    }),
    state,
  );
  assert.equal(
    reviewReducer(state, {
      type: 'search-error',
      version: oldVersion,
      message: 'old error',
    }),
    state,
  );
  state = reviewReducer(state, { type: 'edit-search', value: '' });
  assert.equal(state.search, '');
  assert.equal(state.searchError, '');
});

test('selection from a row, counterparty or graph invalidates a pending search', () => {
  let state = reviewReducer(initial(), { type: 'search-start', value: '123' });
  const version = state.searchVersion;
  state = reviewReducer(state, { type: 'select', gid: '456' });
  state = reviewReducer(state, { type: 'search-found', version, node });
  assert.equal(state.picked, '456');
  assert.equal(state.searching, false);
});

test('global search removes incompatible filters, explains it and reveals the global rank page', () => {
  for (const filters of [
    { role: 'terminal' },
    { cluster: '1' },
    { seed: true },
    { boundary: true },
  ]) {
    let state = reviewReducer(initial(), { type: 'filters', filters });
    state = reviewReducer(state, {
      type: 'search-found',
      version: state.searchVersion,
      node: { ...node, rank: 61 },
    });
    assert.deepEqual(state.filters, emptyFilters);
    assert.equal(state.picked, node.gid);
    assert.equal(state.offset, 60);
    assert.match(state.notice, /Фильтры сняты/);
  }
});

test('matching filters remain; missing-client search keeps the existing card', () => {
  let state = reviewReducer(initial(), {
    type: 'filters',
    filters: { role: 'transit', cluster: '0' },
  });
  state = reviewReducer(state, {
    type: 'search-found',
    version: state.searchVersion,
    node,
  });
  assert.equal(state.filters.role, 'transit');
  assert.equal(state.filters.cluster, '0');
  state = reviewReducer(state, {
    type: 'search-error',
    version: state.searchVersion,
    message: 'Клиент не найден',
  });
  assert.equal(state.picked, node.gid);
  assert.match(state.searchError, /не найден/);
});

test('a shrinking queue clamps an impossible page and never clears a selected client', () => {
  let state = reviewReducer(initial(), { type: 'page', offset: 60 });
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page([], 1),
  });
  assert.equal(state.offset, 0);
  assert.equal(state.picked, node.gid);
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page([], 0),
  });
  assert.equal(state.picked, node.gid);
});

test('empty filtered queue has no selected client', () => {
  let state = reviewReducer(initial(), {
    type: 'filters',
    filters: { role: 'terminal' },
  });
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page([], 0),
  });
  assert.equal(state.picked, '');
});

test('selecting the same cluster again preserves the client and unlocks cancelled search', () => {
  let state = reviewReducer(initial(), {
    type: 'filters',
    filters: { cluster: '0' },
  });
  state = reviewReducer(state, {
    type: 'page-loaded',
    key: reviewQueryKey(state),
    page: page(),
  });
  state = reviewReducer(state, { type: 'search-start', value: '123' });
  state = reviewReducer(state, { type: 'filters', filters: { cluster: '0' } });
  assert.equal(state.picked, node.gid);
  assert.equal(state.searching, false);
});

test('current HTTP adapter sends server pagination and all filters without losing gid precision', async (t) => {
  const urls: string[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string) => {
    urls.push(url);
    return Response.json(page());
  });
  await http.nodes('run', 30, {
    role: 'transit',
    cluster: '0',
    seed: true,
    boundary: true,
  });
  const params = new URL(urls[0]!, 'http://localhost').searchParams;
  assert.deepEqual(Object.fromEntries(params), {
    offset: '30',
    limit: '30',
    role: 'transit',
    cluster_id: '0',
    is_seed: 'true',
    truncated_by_depth: 'true',
  });
  await http.nodes('run', 0, emptyFilters);
  assert.equal(urls[1], '/api/runs/run/nodes?offset=0&limit=30');
});

test('current HTTP adapter rejects wrong runs and clients', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch', async () =>
    Response.json({ ...node, run_id: 'other' }),
  );
  await assert.rejects(http.node('run', node.gid), /другому анализу/);
  fetch.mock.mockImplementation(async () =>
    Response.json({ ...node, run_id: 'run', gid: '123' }),
  );
  await assert.rejects(http.node('run', node.gid), /другому клиенту/);
  fetch.mock.mockImplementation(async () =>
    Response.json({ ...node, run_id: 'run' }),
  );
  assert.equal((await http.node('run', node.gid)).gid, node.gid);
});

test('HTTP failures and HTML instead of JSON produce readable messages', async (t) => {
  const fetch = t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('<!doctype html>', { status: 200 }),
  );
  await assert.rejects(http.runs(), /API запущен/);
  fetch.mock.mockImplementation(async () =>
    Response.json({ detail: { message: 'Клиент не найден' } }, { status: 404 }),
  );
  await assert.rejects(http.node('run', '123'), /Клиент не найден/);
  fetch.mock.mockImplementation(async () => {
    throw new TypeError('network');
  });
  await assert.rejects(http.runs(), /Не удалось подключиться/);
});

test('request gate invalidates out-of-order search responses and propagates cancellation', () => {
  const gate = new RequestGate();
  const first = gate.start();
  const second = gate.start();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  gate.cancel();
  assert.equal(second.isCurrent(), false);
});

test('counterparty money preserves tiyns and copy can fail after an earlier success', async () => {
  assert.equal(formatMoney(1234.56), '1\u00a0234,56 KZT');
  assert.equal(formatMoney(1000.01), '1\u00a0000,01 KZT');
  assert.equal(formatMoney(5000), '5\u00a0000,00 KZT');
  const writes: string[] = [];
  await copyGid(node.gid, {
    writeText: async (gid) => {
      writes.push(gid);
    },
  });
  await assert.rejects(
    copyGid(node.gid, {
      writeText: async () => {
        throw new Error('denied');
      },
    }),
    /Не удалось скопировать/,
  );
  await assert.rejects(copyGid(node.gid, undefined), /Буфер обмена недоступен/);
  assert.deepEqual(writes, [node.gid]);
});
