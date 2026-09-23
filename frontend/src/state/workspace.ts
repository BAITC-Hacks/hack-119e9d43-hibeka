import type {
  AnalyticsApi,
  ClientDetails,
  ClusterResponse,
  NodePage,
} from '../types/api.ts';
import {
  buildNodeQuery,
  PAGE_SIZE,
  type QueueFilters,
} from '../api/queries.ts';
import {
  validateClient,
  validateClusters,
  validatePage,
} from '../api/validation.ts';
import { errorMessage } from '../api/errors.ts';
import { isValidGid } from '../utils/gid.ts';
import { RequestGate } from './requestGate.ts';

export type Resource<T> =
  | { status: 'idle' | 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string };
export type SearchState =
  | { status: 'idle' | 'loading' }
  | { status: 'success' | 'error'; message: string };
export interface WorkspaceState {
  runId: string | null;
  selectedGid: string | null;
  page: number;
  filters: QueueFilters;
  searchInput: string;
  search: SearchState;
  notice: string | null;
  queue: Resource<NodePage>;
  card: Resource<ClientDetails>;
  clusters: Resource<ClusterResponse>;
}

const initialState = (): WorkspaceState => ({
  runId: null,
  selectedGid: null,
  page: 1,
  filters: {},
  searchInput: '',
  search: { status: 'idle' },
  notice: null,
  queue: { status: 'idle' },
  card: { status: 'idle' },
  clusters: { status: 'idle' },
});

/** One store per API instance; no duplicate selection state in components. */
export class WorkspaceController {
  private api: AnalyticsApi;
  private state = initialState();
  private listeners = new Set<() => void>();
  private queueGate = new RequestGate();
  private cardGate = new RequestGate();
  private searchGate = new RequestGate();
  private clustersGate = new RequestGate();

  constructor(api: AnalyticsApi) {
    this.api = api;
  }
  getSnapshot = (): WorkspaceState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<WorkspaceState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  dispose() {
    this.queueGate.cancel();
    this.cardGate.cancel();
    this.searchGate.cancel();
    this.clustersGate.cancel();
  }

  async open(runId: string) {
    const changed = this.state.runId !== runId;
    this.dispose();
    if (changed) this.update({ ...initialState(), runId });
    else this.update({ search: { status: 'idle' } });
    const selected = this.state.selectedGid;
    await Promise.all([
      this.loadQueue(!selected),
      this.loadClusters(),
      selected ? this.loadCard(selected) : Promise.resolve(),
    ]);
  }

  async loadQueue(chooseFirst = false) {
    const { runId, page, filters } = this.state;
    if (!runId) return;
    const task = this.queueGate.start();
    this.update({ queue: { status: 'loading' } });
    try {
      const data = validatePage(
        await this.api.listNodes(
          runId,
          buildNodeQuery(page, filters),
          task.signal,
        ),
        runId,
      );
      if (!task.isCurrent()) return;
      const lastPage = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
      if (page > lastPage) {
        this.update({ page: lastPage });
        await this.loadQueue(chooseFirst);
        return;
      }
      this.update({ queue: { status: 'success', data } });
      if (
        chooseFirst &&
        !this.state.selectedGid &&
        this.state.search.status !== 'loading' &&
        !this.state.searchInput.trim() &&
        data.items[0]
      )
        await this.select(data.items[0].gid);
    } catch (error) {
      if (task.isCurrent())
        this.update({
          queue: { status: 'error', message: errorMessage(error) },
        });
    }
  }

  async loadClusters() {
    const runId = this.state.runId;
    if (!runId) return;
    const task = this.clustersGate.start();
    this.update({ clusters: { status: 'loading' } });
    try {
      const data = validateClusters(
        await this.api.listClusters(runId, task.signal),
        runId,
      );
      if (task.isCurrent())
        this.update({ clusters: { status: 'success', data } });
    } catch (error) {
      if (task.isCurrent())
        this.update({
          clusters: { status: 'error', message: errorMessage(error) },
        });
    }
  }

  private async loadCard(gid: string, reveal = false) {
    const runId = this.state.runId;
    if (!runId) return;
    const task = this.cardGate.start();
    this.update({ card: { status: 'loading' } });
    try {
      const data = validateClient(
        await this.api.getNode(runId, gid, task.signal),
        runId,
        gid,
      );
      if (!task.isCurrent() || this.state.selectedGid !== gid) return;
      this.update({ card: { status: 'success', data } });
      if (reveal) await this.reveal(data);
    } catch (error) {
      if (task.isCurrent())
        this.update({
          card: { status: 'error', message: errorMessage(error) },
        });
    }
  }

  async select(gid: string, reveal = false) {
    if (!isValidGid(gid)) return;
    this.searchGate.cancel();
    this.update({ search: { status: 'idle' }, notice: null });
    if (
      gid === this.state.selectedGid &&
      this.state.card.status === 'success'
    ) {
      if (reveal) await this.reveal(this.state.card.data);
      return;
    }
    if (gid === this.state.selectedGid && this.state.card.status === 'loading')
      return;
    this.update({ selectedGid: gid, card: { status: 'loading' } });
    await this.loadCard(gid, reveal);
  }

  async retryCard() {
    if (this.state.selectedGid) await this.loadCard(this.state.selectedGid);
  }

  private async reveal(client: ClientDetails) {
    const page = Math.floor((client.rank - 1) / PAGE_SIZE) + 1;
    const hadFilters = Object.keys(this.state.filters).length > 0;
    const changed = hadFilters || this.state.page !== page;
    this.update({
      page,
      filters: {},
      notice: hadFilters
        ? 'Фильтры сняты: клиент открыт на своей позиции в общей очереди.'
        : null,
    });
    if (changed || this.state.queue.status !== 'success')
      await this.loadQueue();
  }

  async setPage(page: number) {
    if (!Number.isSafeInteger(page) || page < 1 || page === this.state.page)
      return;
    const queue = this.state.queue;
    if (
      queue.status === 'success' &&
      page > Math.max(1, Math.ceil(queue.data.total / PAGE_SIZE))
    )
      return;
    this.searchGate.cancel();
    this.update({ page, search: { status: 'idle' } });
    await this.loadQueue();
  }

  async setFilters(filters: QueueFilters) {
    if (
      filters.role === this.state.filters.role &&
      filters.cluster_id === this.state.filters.cluster_id
    )
      return;
    this.cardGate.cancel();
    this.searchGate.cancel();
    this.update({
      filters,
      page: 1,
      selectedGid: null,
      card: { status: 'idle' },
      searchInput: '',
      search: { status: 'idle' },
      notice: 'Очередь отфильтрована. Выбран первый доступный клиент.',
    });
    await this.loadQueue(true);
    if (
      this.state.queue.status === 'success' &&
      this.state.queue.data.total === 0
    )
      this.update({ notice: 'По выбранным фильтрам клиентов нет.' });
  }

  setSearchInput(value: string) {
    this.searchGate.cancel();
    this.update({ searchInput: value, search: { status: 'idle' } });
    if (this.state.page !== 1) {
      this.update({ page: 1 });
      void this.loadQueue();
    }
  }

  clearSearch() {
    this.setSearchInput('');
  }

  async search() {
    const { runId, searchInput } = this.state;
    if (!runId || this.state.search.status === 'loading') return;
    const gid = searchInput.trim();
    this.update({ searchInput: gid });
    if (!gid) {
      this.clearSearch();
      return;
    }
    if (!isValidGid(gid)) {
      this.update({
        search: {
          status: 'error',
          message: 'Введите полный gid: от 1 до 19 цифр, без пробелов внутри.',
        },
      });
      return;
    }
    if (
      this.state.card.status === 'success' &&
      this.state.card.data.gid === gid
    ) {
      this.update({
        search: { status: 'success', message: `Открыт клиент ${gid}.` },
      });
      await this.reveal(this.state.card.data);
      return;
    }
    const task = this.searchGate.start();
    this.update({ search: { status: 'loading' } });
    try {
      const data = validateClient(
        await this.api.getNode(runId, gid, task.signal),
        runId,
        gid,
      );
      if (!task.isCurrent()) return;
      this.cardGate.cancel();
      this.update({
        selectedGid: gid,
        card: { status: 'success', data },
        search: { status: 'success', message: `Открыт клиент ${gid}.` },
      });
      await this.reveal(data);
    } catch (error) {
      if (task.isCurrent())
        this.update({
          search: { status: 'error', message: errorMessage(error) },
        });
    }
  }
}
