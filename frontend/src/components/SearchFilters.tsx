import type { WorkspaceController, WorkspaceState } from '../state/workspace';
import { isRole, roleLabels } from '../utils/roles';

export function SearchFilters({
  state,
  controller,
  disabled,
}: {
  state: WorkspaceState;
  controller: WorkspaceController;
  disabled: boolean;
}) {
  const { filters, search, clusters } = state;
  const active = filters.role !== undefined || filters.cluster_id !== undefined;
  return (
    <section
      className="workspace-toolbar review-toolbar"
      aria-label="Инструменты исследования"
    >
      <div className="workspace-title">
        <span className="eyebrow">Рабочее пространство</span>
        <h2>Исследование сети</h2>
      </div>
      <form
        className="search-form"
        onSubmit={(event) => {
          event.preventDefault();
          void controller.search();
        }}
      >
        <label htmlFor="client-search">Полный gid клиента</label>
        <div className="search-controls">
          <input
            id="client-search"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="Например, 900000000000000105"
            value={state.searchInput}
            onChange={(event) => controller.setSearchInput(event.target.value)}
            disabled={disabled}
            aria-invalid={search.status === 'error'}
            aria-describedby="search-feedback search-hint"
          />
          <button
            className="button button-primary"
            type="submit"
            disabled={
              disabled ||
              search.status === 'loading' ||
              !state.searchInput.trim()
            }
          >
            {search.status === 'loading' ? 'Поиск…' : 'Найти'}
          </button>
          <button
            className="button"
            type="button"
            disabled={disabled || !state.searchInput}
            onClick={() => controller.clearSearch()}
          >
            Очистить
          </button>
        </div>
        <p id="search-hint" className="field-hint">
          Точный поиск во всём наборе. Результат открывается в общей очереди.
        </p>
        <p
          id="search-feedback"
          className={search.status === 'error' ? 'field-error' : 'field-hint'}
          role="status"
        >
          {'message' in search
            ? search.message
            : search.status === 'loading'
              ? 'Ищем клиента…'
              : ''}
        </p>
      </form>
      <fieldset className="toolbar-fields" disabled={disabled}>
        <legend className="sr-only">Фильтры очереди</legend>
        <label>
          <span>Роль</span>
          <select
            value={filters.role ?? ''}
            onChange={(event) => {
              const role = event.target.value;
              const next = { ...filters };
              delete next.role;
              if (isRole(role)) next.role = role;
              void controller.setFilters(next);
            }}
          >
            <option value="">Все роли</option>
            {Object.entries(roleLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Кластер</span>
          <select
            disabled={clusters.status !== 'success'}
            value={filters.cluster_id ?? ''}
            onChange={(event) => {
              const next = { ...filters };
              delete next.cluster_id;
              if (event.target.value !== '')
                next.cluster_id = Number(event.target.value);
              void controller.setFilters(next);
            }}
          >
            <option value="">Все кластеры</option>
            {clusters.status === 'success' &&
              clusters.data.items.map((cluster) => (
                <option key={cluster.cluster_id} value={cluster.cluster_id}>
                  Кластер {cluster.cluster_id} · {cluster.n_nodes} клиентов
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className="button"
          disabled={!active}
          onClick={() => {
            void controller.setFilters({});
          }}
        >
          Сбросить фильтры
        </button>
      </fieldset>
      <p className="filter-status" role="status">
        {active
          ? `Активные фильтры: ${[filters.role && roleLabels[filters.role], filters.cluster_id !== undefined ? `кластер ${filters.cluster_id}` : null].filter(Boolean).join(', ')}.`
          : 'Показана общая очередь.'}{' '}
        {state.notice}
      </p>
    </section>
  );
}
