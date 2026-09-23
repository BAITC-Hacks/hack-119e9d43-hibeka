import type { WorkspaceState, WorkspaceController } from '../state/workspace';
import { PAGE_SIZE } from '../api/queries';
import { formatScore, formatText } from '../utils/format';
import { roleLabels } from '../utils/roles';
import { CopyGidButton } from './CopyGidButton';

export function ReviewQueue({
  state,
  controller,
  disabled,
}: {
  state: WorkspaceState;
  controller: WorkspaceController;
  disabled: boolean;
}) {
  const queue = disabled ? { status: 'idle' as const } : state.queue;
  const data = queue.status === 'success' ? queue.data : null;
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  return (
    <section
      className="panel queue-panel"
      aria-labelledby="queue-title"
      aria-busy={queue.status === 'loading'}
    >
      <div className="panel-heading">
        <div>
          <h3 id="queue-title">Очередь проверки</h3>
          <p>Глобальный ранг · приоритет проверки</p>
        </div>
        <span className="count-badge">{data?.total ?? '—'}</span>
      </div>
      {queue.status === 'loading' && (
        <p className="resource-message" role="status">
          Загружаем страницу {state.page}…
        </p>
      )}
      {queue.status === 'error' && (
        <div className="resource-message" role="alert">
          <p>{queue.message}</p>
          <button
            className="button"
            onClick={() => {
              void controller.loadQueue(!state.selectedGid);
            }}
          >
            Повторить загрузку очереди
          </button>
        </div>
      )}
      {queue.status === 'idle' && (
        <p className="resource-message">
          Откройте готовый результат для просмотра очереди.
        </p>
      )}
      {data && (
        <>
          {state.selectedGid &&
            !data.items.some((item) => item.gid === state.selectedGid) && (
              <p className="panel-footnote">
                Выбранный клиент находится на другой странице. Его карточка
                сохранена.
              </p>
            )}
          {data.items.length === 0 ? (
            <div className="panel-empty" role="status">
              <h4>Клиентов не найдено</h4>
              <p>Попробуйте изменить роль или кластер.</p>
              <button
                className="button"
                disabled={Object.keys(state.filters).length === 0}
                onClick={() => {
                  void controller.setFilters({});
                }}
              >
                Сбросить фильтры
              </button>
            </div>
          ) : (
            <div
              className="queue-list-region"
              role="region"
              aria-label="Клиенты очереди"
              tabIndex={0}
            >
              <ol
                className="queue-preview interactive-queue"
                start={(state.page - 1) * PAGE_SIZE + 1}
              >
                {data.items.map((client) => (
                  <li
                    key={client.gid}
                    className={
                      client.gid === state.selectedGid ? 'is-selected' : ''
                    }
                  >
                    <button
                      className="queue-select"
                      aria-pressed={client.gid === state.selectedGid}
                      aria-label={`Открыть клиента ${client.gid}`}
                      onClick={() => {
                        void controller.select(client.gid);
                      }}
                    >
                      <span className="queue-row">
                        <span className="rank">{client.rank}</span>
                        <span className="gid">{client.gid}</span>
                      </span>
                      <span className="queue-badges">
                        <span className={`role-badge role-${client.role}`}>
                          {roleLabels[client.role]}
                        </span>
                        <span className="priority-value">
                          {formatScore(client.priority_score)}
                        </span>
                      </span>
                      <span className="queue-reason">
                        {formatText(client.priority_reason_short)}
                      </span>
                    </button>
                    <CopyGidButton gid={client.gid} />
                  </li>
                ))}
              </ol>
            </div>
          )}
          <nav className="pagination" aria-label="Пагинация очереди">
            <p>
              {data.total === 0
                ? '0 клиентов'
                : `${(state.page - 1) * PAGE_SIZE + 1}–${Math.min(state.page * PAGE_SIZE, data.total)} из ${data.total}`}
            </p>
            <div>
              <button
                className="button"
                disabled={state.page <= 1}
                onClick={() => {
                  void controller.setPage(state.page - 1);
                }}
              >
                Назад
              </button>
              <label>
                <span className="sr-only">Страница очереди</span>
                <select
                  aria-label="Страница очереди"
                  value={state.page}
                  disabled={pages <= 1}
                  onChange={(event) => {
                    void controller.setPage(Number(event.target.value));
                  }}
                >
                  {Array.from({ length: pages }, (_, index) => (
                    <option key={index} value={index + 1}>
                      {index + 1} / {pages}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button"
                disabled={state.page >= pages}
                onClick={() => {
                  void controller.setPage(state.page + 1);
                }}
              >
                Вперёд
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
