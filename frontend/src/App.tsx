import { useEffect, useReducer, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ApiFailure, http, messageOf, REVIEW_PAGE_SIZE } from './api/client';
import type { AnalysisRun, Filters } from './api/client';
import { useResource } from './hooks/useResource';
import { Icon } from './components/Icon';
import { ClientPanel, ReadState, RoleBadge } from './components/ClientPanel';
import { UploadDialog } from './components/UploadDialog';
import { AssistantPanel } from './components/AssistantPanel';
import { roleLabels } from './utils/roles';
import { formatDate, formatInteger, formatMoney } from './utils/format';
import { isValidGid } from './utils/gid';
import { RequestGate } from './state/requestGate';
import {
  emptyFilters,
  initialReviewState,
  reviewQueryKey,
  reviewReducer,
} from './state/review';
function runLabel(run: AnalysisRun) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(run.created_at));
}
function Exports({ runId }: { runId: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function download(file: string) {
    setError('');
    setBusy(true);
    try {
      const response = await fetch(http.exportUrl(runId, file));
      if (!response.ok)
        throw new Error('Не удалось скачать файл. Повторите попытку.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = file;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (menu.current) menu.current.open = false;
    } catch (failure) {
      setError(messageOf(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="export-menu" ref={menu}>
      <summary className="button">
        <Icon name="download" size={16} />
        Скачать CSV
      </summary>
      <div className="export-popover">
        <strong>Результаты анализа</strong>
        {[
          ['nodes_roles.csv', 'Клиенты и роли'],
          ['clusters.csv', 'Группы клиентов'],
          ['top_nodes.csv', 'Рейтинг проверки'],
        ].map(([file, label]) => (
          <button
            key={file}
            disabled={busy}
            onClick={() => void download(file!)}
          >
            {label}
            <small>{file}</small>
          </button>
        ))}
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
      </div>
    </details>
  );
}
function RunWorkspace({
  runId,
  assistantOpen,
  onAssistantClose,
}: {
  runId: string;
  assistantOpen: boolean;
  onAssistantClose: () => void;
}) {
  const run = useResource(runId, (signal) => http.run(runId, signal));
  const [state, dispatch] = useReducer(reviewReducer, initialReviewState);
  const { filters, offset, picked, search, searchError, searching, notice } =
    state;
  const searchGate = useRef(new RequestGate());
  const queryKey = reviewQueryKey(state);
  const page = useResource(`${runId}/${queryKey}`, async (signal) => {
    const data = await http.nodes(runId, offset, filters, signal);
    if (!signal.aborted)
      dispatch({ type: 'page-loaded', key: queryKey, page: data });
    return data;
  });
  const clusters = useResource(`${runId}/clusters`, (signal) =>
    http.clusters(runId, signal),
  );
  const gid = picked;
  const activeFilters = Object.values(filters).filter(Boolean).length;
  const selectedOnPage = page.data?.items.some((node) => node.gid === gid);
  useEffect(() => {
    const gate = searchGate.current;
    return () => gate.cancel();
  }, []);
  function select(gid: string) {
    searchGate.current.cancel();
    dispatch({ type: 'select', gid });
  }
  function filter(next: Partial<Filters>) {
    searchGate.current.cancel();
    dispatch({ type: 'filters', filters: next });
  }
  function editSearch(value: string) {
    searchGate.current.cancel();
    dispatch({ type: 'edit-search', value });
  }
  function changePage(offset: number) {
    searchGate.current.cancel();
    dispatch({ type: 'page', offset });
  }
  async function find(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (searching) return;
    const value = search.trim();
    if (!value) {
      editSearch('');
      return;
    }
    if (!isValidGid(value)) {
      dispatch({
        type: 'search-error',
        version: state.searchVersion,
        message:
          'Введите полный идентификатор: от 1 до 19 цифр, без пробелов внутри.',
      });
      return;
    }
    const task = searchGate.current.start();
    const version = state.searchVersion;
    dispatch({ type: 'search-start', value });
    try {
      const node = await http.node(runId, value, task.signal);
      if (task.isCurrent()) dispatch({ type: 'search-found', version, node });
    } catch (failure) {
      if (task.isCurrent())
        dispatch({
          type: 'search-error',
          version,
          message:
            failure instanceof ApiFailure && failure.status === 404
              ? 'Клиент не найден в этом анализе. Проверьте полный идентификатор.'
              : messageOf(failure),
        });
    }
  }
  const summary = run.data?.summary;
  return (
    <>
      <section className="dataset-strip" aria-label="Сводка выборки">
        {summary ? (
          <>
            <span className="dataset-period">
              <i className="status-dot" />
              {formatDate(summary.period_start)} —{' '}
              {formatDate(summary.period_end)}
            </span>
            <span>
              <b>{formatInteger(summary.nodes_count)}</b> клиентов
            </span>
            <span>
              <b>{formatInteger(summary.edges_count)}</b> связей
            </span>
            <span>
              <b>{formatInteger(summary.transactions_count)}</b> переводов
            </span>
            <span title={formatMoney(summary.total_amount_kzt)}>
              <b>{formatMoney(summary.total_amount_kzt)}</b>
            </span>
          </>
        ) : (
          <ReadState
            error={run.error}
            onRetry={run.retry}
            label="Загружаем сводку…"
          />
        )}
      </section>
      <main id="workspace" className="analysis-workspace">
        <aside className="queue-panel" aria-label="Очередь проверки">
          <div className="queue-intro">
            <span className="eyebrow">С ЧЕГО НАЧАТЬ</span>
            <h1>
              Очередь проверки{' '}
              <span className="count">
                {page.data ? formatInteger(page.data.total) : '…'}
              </span>
            </h1>
            <p>Клиенты с наиболее выраженными признаками — в начале списка.</p>
          </div>
          <form className="search-form" onSubmit={(event) => void find(event)}>
            <Icon name="search" size={18} />
            <label className="sr-only" htmlFor="client-search">
              Полный идентификатор клиента
            </label>
            <input
              id="client-search"
              value={search}
              onChange={(event) => editSearch(event.target.value)}
              aria-invalid={!!searchError}
              aria-describedby="client-search-feedback"
              placeholder="Найти по полному ID"
              inputMode="numeric"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={searching || !search.trim()}
              aria-label="Найти клиента"
            >
              {searching ? '…' : '↵'}
            </button>
            <button
              type="button"
              aria-label="Очистить поиск"
              title="Очистить поиск"
              disabled={!search}
              onClick={() => editSearch('')}
            >
              ×
            </button>
          </form>
          <p
            id="client-search-feedback"
            className={
              searchError ? 'error-text search-error' : 'search-feedback'
            }
            role="status"
          >
            {searchError || (searching ? 'Ищем клиента…' : notice)}
          </p>
          <details className="filter-disclosure">
            <summary>
              <span>
                Фильтры{' '}
                {activeFilters > 0 && <b className="count">{activeFilters}</b>}
              </span>
              <span className="muted">Настроить</span>
            </summary>
            <div className="filters">
              <label>
                Роль
                <select
                  aria-label="Роль"
                  value={filters.role}
                  onChange={(event) => filter({ role: event.target.value })}
                >
                  <option value="">Все роли</option>
                  {Object.entries(roleLabels).map(([role, label]) => (
                    <option key={role} value={role}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Группа
                <select
                  aria-label="Группа"
                  value={filters.cluster}
                  onChange={(event) => filter({ cluster: event.target.value })}
                >
                  <option value="">Все группы</option>
                  {clusters.data?.items.map((cluster) => (
                    <option key={cluster.cluster_id} value={cluster.cluster_id}>
                      Группа {cluster.cluster_id} · {cluster.n_nodes} клиентов
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.seed}
                  onChange={(event) => filter({ seed: event.target.checked })}
                />
                Только исходные клиенты
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={filters.boundary}
                  onChange={(event) =>
                    filter({ boundary: event.target.checked })
                  }
                />
                На границе выборки
              </label>
              {activeFilters > 0 && (
                <button
                  className="text-button"
                  onClick={() => filter(emptyFilters)}
                >
                  Сбросить фильтры
                </button>
              )}
            </div>
          </details>
          <div className="queue-label">
            <span>Клиент / предполагаемая роль</span>
            <span>Место</span>
          </div>
          <div
            className="queue-list"
            aria-label="Клиенты по убыванию приоритета"
          >
            {!page.data ? (
              <ReadState
                error={page.error}
                onRetry={page.retry}
                label="Готовим очередь…"
              />
            ) : page.data.items.length === 0 ? (
              <div className="read-state">
                <Icon name="search" />
                <p>По этим фильтрам клиентов нет</p>
                <button className="button" onClick={() => filter(emptyFilters)}>
                  Сбросить фильтры
                </button>
              </div>
            ) : (
              page.data.items.map((node) => (
                <button
                  className={`queue-item ${gid === node.gid ? 'is-selected' : ''}`}
                  aria-pressed={gid === node.gid}
                  key={node.gid}
                  onClick={() => select(node.gid)}
                >
                  <div className="queue-item-top">
                    <span className="mono">{node.gid}</span>
                    <span className="queue-rank">#{node.rank}</span>
                  </div>
                  <RoleBadge node={node} />
                  <span className="queue-reason">
                    {node.is_isolated
                      ? 'Нет наблюдаемых связей'
                      : node.role === 'coordinator'
                        ? `Связывает группы: ${node.neighbor_cluster_count} · контрагентов: ${node.neighbor_count}`
                        : `Отправителей: ${node.in_deg} · получателей: ${node.out_deg}`}
                  </span>
                </button>
              ))
            )}
          </div>
          {page.data && page.data.total > 0 && (
            <nav className="pagination" aria-label="Страницы очереди">
              <button
                className="page-button"
                disabled={offset === 0}
                aria-label="Предыдущие клиенты"
                onClick={() => changePage(offset - REVIEW_PAGE_SIZE)}
              >
                ←
              </button>
              <span>
                {offset + 1}–{offset + page.data.items.length} из{' '}
                {formatInteger(page.data.total)}
              </span>
              <button
                className="page-button"
                disabled={offset + page.data.items.length >= page.data.total}
                aria-label="Следующие клиенты"
                onClick={() => changePage(offset + REVIEW_PAGE_SIZE)}
              >
                →
              </button>
            </nav>
          )}
          {picked && !selectedOnPage && page.data && (
            <p className="queue-selection-note">
              Открытый клиент находится вне текущей страницы очереди.
            </p>
          )}
          <details className="cluster-disclosure">
            <summary>
              <Icon name="layers" size={17} />
              <span>Группы клиентов</span>
              <span className="count">
                {clusters.data?.items.length ?? '…'}
              </span>
            </summary>
            <div className="cluster-list">
              {clusters.data ? (
                clusters.data.items.map((cluster) => (
                  <div className="cluster-row" key={cluster.cluster_id}>
                    <button
                      className="text-button"
                      onClick={() =>
                        filter({ cluster: String(cluster.cluster_id) })
                      }
                    >
                      Группа {cluster.cluster_id}{' '}
                      <span className="muted">
                        · {cluster.n_nodes} клиентов
                      </span>
                    </button>
                    <p>{cluster.hypothesis}</p>
                    <small>
                      Исходных: {cluster.n_seed} · внутри группы:{' '}
                      {formatMoney(cluster.sum_kzt_internal)}
                    </small>
                    <div className="cluster-leaders">
                      {cluster.top_gids.slice(0, 3).map((id) => (
                        <button
                          className="text-button mono"
                          key={id}
                          onClick={() => select(id)}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <ReadState error={clusters.error} onRetry={clusters.retry} />
              )}
            </div>
          </details>
        </aside>
        {gid ? (
          <ClientPanel key={gid} runId={runId} gid={gid} onSelect={select} />
        ) : (
          <article className="client-panel empty-client">
            <Icon name="client" size={32} />
            <h2>Выберите клиента</h2>
            <p>Здесь появятся объяснение роли, переводы и граф связей.</p>
          </article>
        )}
      </main>
      <AssistantPanel
        runId={runId}
        selectedGid={gid || null}
        open={assistantOpen}
        onClose={onAssistantClose}
        onSelect={select}
      />
      <footer className="workspace-footer">
        <span>
          Роли и приоритет помогают выбрать, что проверить. Они не подтверждают
          нарушение.
        </span>
        <span title={runId}>Анализ {runId.slice(0, 8)}</span>
      </footer>
    </>
  );
}
export default function App() {
  const runs = useResource('runs', (signal) => http.runs(signal));
  const [chosen, setChosen] = useState('');
  const [upload, setUpload] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const completed = [...(runs.data?.items ?? [])]
    .filter((run) => run.status === 'completed')
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pending = runs.data?.items.find(
    (run) => run.status === 'queued' || run.status === 'running',
  );
  const runId = chosen || completed[0]?.run_id || '';
  return (
    <div className={`app-shell${assistantOpen && runId ? ' chat-open' : ''}`}>
      <a href="#workspace" className="skip-link">
        Перейти к анализу
      </a>
      <header className="app-header">
        <a className="brand" href="/" aria-label="Граф денег — главная">
          <span className="brand-mark">
            <Icon name="network" size={22} />
          </span>
          <span>
            Граф денег<small>HIBEKA / АНАЛИЗ ПЕРЕВОДОВ</small>
          </span>
        </a>
        <div className="header-actions">
          {completed.length > 0 && (
            <label className="run-select">
              <span>Анализ</span>
              <select
                aria-label="Выбрать готовый анализ"
                value={runId}
                onChange={(event) => {
                  setChosen(event.target.value);
                  setAnnouncement('');
                }}
              >
                {completed.map((run) => (
                  <option key={run.run_id} value={run.run_id}>
                    {runLabel(run)} · {run.run_id.slice(0, 6)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {runId && (
            <button
              className="button assistant-toggle"
              aria-expanded={assistantOpen}
              aria-controls="ai-analyst"
              onClick={() => setAssistantOpen((value) => !value)}
            >
              <Icon name="sparkles" size={17} />
              ИИ-аналитик
            </button>
          )}
          {runId && <Exports key={runId} runId={runId} />}
          <button
            className="button button-primary"
            onClick={() => {
              if (runId) setChosen(runId);
              setUpload(true);
            }}
          >
            <Icon name="upload" size={16} />
            {pending ? 'Статус анализа' : 'Загрузить данные'}
          </button>
        </div>
      </header>
      {announcement && (
        <div className="success-note" role="status">
          <span>{announcement}</span>
          <button
            className="text-button"
            aria-label="Скрыть уведомление"
            onClick={() => setAnnouncement('')}
          >
            ×
          </button>
        </div>
      )}
      {runId ? (
        <RunWorkspace
          key={runId}
          runId={runId}
          assistantOpen={assistantOpen}
          onAssistantClose={() => setAssistantOpen(false)}
        />
      ) : runs.loading || runs.error ? (
        <ReadState
          error={runs.error}
          onRetry={runs.retry}
          label="Открываем результаты анализа…"
        />
      ) : (
        <main id="workspace" className="welcome">
          <span className="welcome-icon">
            <Icon name="network" size={38} />
          </span>
          <span className="eyebrow">ОТ ПЕРЕВОДОВ К ПОНЯТНОЙ КАРТИНЕ</span>
          <h1>Начните с вашей выборки</h1>
          <p>
            Загрузите клиентов, связи и переводы. Получите очередь проверки,
            объяснение ролей и граф денежных потоков.
          </p>
          <button
            className="button button-primary"
            onClick={() => {
              if (runId) setChosen(runId);
              setUpload(true);
            }}
          >
            {pending ? 'Посмотреть ход анализа' : 'Загрузить три файла'}
          </button>
          {runs.data?.items.some((run) => run.status === 'failed') && (
            <p className="notice">
              Предыдущий анализ не завершился. Проверьте исходные файлы и
              запустите новый.
            </p>
          )}
        </main>
      )}
      {upload && (
        <UploadDialog
          initialJob={pending?.run_id}
          onClose={() => {
            setUpload(false);
            runs.retry();
          }}
          onComplete={(id) => {
            setChosen(id);
            setUpload(false);
            setAnnouncement('Анализ готов. Открыты результаты новой выборки.');
            runs.retry();
          }}
        />
      )}
    </div>
  );
}
