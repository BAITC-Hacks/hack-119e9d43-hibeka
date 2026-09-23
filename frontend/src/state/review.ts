import type { AnalysisNode, AnalysisPage, Filters } from '../api/client.ts';
import { REVIEW_PAGE_SIZE } from '../api/client.ts';

export const emptyFilters: Filters = {
  role: '',
  cluster: '',
  seed: false,
  boundary: false,
};

export interface ReviewState {
  filters: Filters;
  offset: number;
  picked: string;
  search: string;
  searchError: string;
  searching: boolean;
  searchVersion: number;
  notice: string;
}

export const initialReviewState: ReviewState = {
  filters: emptyFilters,
  offset: 0,
  picked: '',
  search: '',
  searchError: '',
  searching: false,
  searchVersion: 0,
  notice: '',
};

export const reviewQueryKey = (
  state: Pick<ReviewState, 'offset' | 'filters'>,
) => `${state.offset}/${JSON.stringify(state.filters)}`;

type ReviewAction =
  | { type: 'select'; gid: string }
  | { type: 'page'; offset: number }
  | { type: 'filters'; filters: Partial<Filters> }
  | { type: 'edit-search'; value: string }
  | { type: 'search-start'; value: string }
  | { type: 'search-error'; version: number; message: string }
  | { type: 'search-found'; version: number; node: AnalysisNode }
  | { type: 'page-loaded'; key: string; page: AnalysisPage };

export function reviewReducer(
  state: ReviewState,
  action: ReviewAction,
): ReviewState {
  const cancelSearch = {
    searching: false,
    searchError: '',
    searchVersion: state.searchVersion + 1,
    notice: '',
  };
  switch (action.type) {
    case 'select':
      return { ...state, ...cancelSearch, picked: action.gid };
    case 'page':
      return { ...state, ...cancelSearch, offset: Math.max(0, action.offset) };
    case 'filters': {
      const filters = { ...state.filters, ...action.filters };
      if (
        filters.role === state.filters.role &&
        filters.cluster === state.filters.cluster &&
        filters.seed === state.filters.seed &&
        filters.boundary === state.filters.boundary
      )
        return { ...state, ...cancelSearch };
      return {
        ...state,
        ...cancelSearch,
        filters,
        offset: 0,
        picked: '',
        search: '',
      };
    }
    case 'edit-search':
      return { ...state, ...cancelSearch, search: action.value, offset: 0 };
    case 'search-start':
      return {
        ...state,
        search: action.value,
        searchError: '',
        searching: true,
        notice: '',
      };
    case 'search-error':
      return action.version === state.searchVersion
        ? { ...state, searching: false, searchError: action.message }
        : state;
    case 'search-found': {
      if (action.version !== state.searchVersion) return state;
      const node = action.node;
      const filters = state.filters;
      const blocked =
        (!!filters.role && filters.role !== node.role) ||
        (!!filters.cluster && filters.cluster !== String(node.cluster_id)) ||
        (filters.seed && !node.is_seed) ||
        (filters.boundary && !node.truncated_by_depth);
      const nextFilters = blocked ? emptyFilters : filters;
      return {
        ...state,
        picked: node.gid,
        filters: nextFilters,
        searching: false,
        searchError: '',
        offset: Object.values(nextFilters).some(Boolean)
          ? 0
          : Math.floor((node.rank - 1) / REVIEW_PAGE_SIZE) * REVIEW_PAGE_SIZE,
        notice: blocked
          ? 'Фильтры сняты: найденный клиент открыт в общей очереди.'
          : 'Клиент найден. Его карточка открыта.',
      };
    }
    case 'page-loaded': {
      if (action.key !== reviewQueryKey(state)) return state;
      const lastOffset =
        Math.max(0, Math.ceil(action.page.total / REVIEW_PAGE_SIZE) - 1) *
        REVIEW_PAGE_SIZE;
      if (state.offset > lastOffset) return { ...state, offset: lastOffset };
      // Persist the initial choice too: page changes must never derive a new client.
      return state.picked || state.searching
        ? state
        : { ...state, picked: action.page.items[0]?.gid ?? '' };
    }
  }
}
