import type { NodePage } from '../types/api';
import { roleLabels } from '../utils/roles';
import { formatScore } from '../utils/format';
import { Icon } from './Icon';

export function WorkspaceShell({
  nodes,
  loading,
}: {
  nodes?: NodePage;
  loading: boolean;
}) {
  return (
    <>
      <section
        className="workspace-toolbar"
        aria-label="Инструменты исследования"
      >
        <div className="workspace-title">
          <span className="eyebrow">Рабочее пространство</span>
          <h2>Исследование сети</h2>
        </div>
        <fieldset
          disabled
          aria-describedby="tools-note"
          className="toolbar-fields"
        >
          <legend className="sr-only">Поиск и фильтры — следующий этап</legend>
          <label className="search-field">
            <span>Идентификатор клиента</span>
            <div>
              <Icon name="search" />
              <input type="text" placeholder="Полный gid" />
            </div>
          </label>
          <label>
            <span>Роль</span>
            <select defaultValue="all">
              <option value="all">Все роли</option>
            </select>
          </label>
          <label>
            <span>Кластер</span>
            <select defaultValue="all">
              <option value="all">Все кластеры</option>
            </select>
          </label>
        </fieldset>
        <p id="tools-note" className="tools-note">
          Поиск, фильтры и выбор клиента будут доступны на этапе 2.
        </p>
      </section>

      <div className="workspace-grid">
        <section
          className="panel queue-panel"
          aria-labelledby="queue-title"
          aria-busy={loading}
        >
          <div className="panel-heading">
            <div>
              <h3 id="queue-title">Очередь проверки</h3>
              <p>По приоритету · пример отображения</p>
            </div>
            <span className="count-badge">{nodes ? nodes.total : '—'}</span>
          </div>
          {loading ? (
            <div className="queue-skeleton" aria-hidden="true">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index}>
                  <span className="skeleton" />
                  <span className="skeleton skeleton-label" />
                </div>
              ))}
            </div>
          ) : nodes && nodes.items.length > 0 ? (
            <>
              <div className="queue-caption">
                <span>Ранг / клиент</span>
                <span>Приоритет</span>
              </div>
              <ol
                className="queue-preview"
                aria-label="Демонстрационная очередь без выбора клиента"
              >
                {nodes.items.map((client) => (
                  <li key={client.gid}>
                    <div className="queue-row">
                      <span className="rank">
                        {String(client.rank).padStart(2, '0')}
                      </span>
                      <span className="gid">{client.gid}</span>
                      <span className="priority-value">
                        {formatScore(client.priority_score)}
                      </span>
                    </div>
                    <div className="queue-body">
                      <span className={`role-badge role-${client.role}`}>
                        {roleLabels[client.role]}
                      </span>
                      <p>{client.priority_reason_short}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="panel-footnote">
                Показано {nodes.items.length} из {nodes.total}. Выбор клиента и
                пагинация — этап 2.
              </p>
            </>
          ) : (
            <div className="panel-empty">
              <Icon name="layers" size={28} />
              <h4>Очередь пока пуста</h4>
              <p>
                Здесь появятся клиенты и основания их приоритета после загрузки
                результата.
              </p>
            </div>
          )}
        </section>

        <section className="panel graph-panel" aria-labelledby="graph-title">
          <div className="panel-heading">
            <div>
              <h3 id="graph-title">Связи клиента</h3>
              <p>Направление движения денег</p>
            </div>
            <span className="quiet-badge">Этап 3</span>
          </div>
          <div className="graph-canvas">
            <div className="graph-placeholder">
              <span className="graph-symbol">
                <Icon name="network" size={42} />
              </span>
              <h4>От клиента — к его связям</h4>
              <p>
                Здесь будет направленная схема отправителей и получателей
                выбранного клиента.
              </p>
              <span className="placeholder-note">
                Интерактивный граф — на третьем этапе
              </span>
            </div>
          </div>
          <div className="graph-footer">
            <Icon name="info" size={16} />
            <span>Текущее окружение ещё не загружено</span>
          </div>
        </section>

        <section className="panel client-panel" aria-labelledby="client-title">
          <div className="panel-heading">
            <div>
              <h3 id="client-title">Карточка клиента</h3>
              <p>Факты и причины проверки</p>
            </div>
            <Icon name="client" />
          </div>
          <div className="panel-empty client-empty">
            <span className="client-symbol">
              <Icon name="client" size={30} />
            </span>
            <h4>Клиент не выбран</h4>
            <p>
              Карточка покажет роль, движение средств и объяснение приоритета.
            </p>
            <span className="placeholder-note">
              Выбор клиента — на втором этапе
            </span>
          </div>
          <div className="card-outline" aria-label="Состав будущей карточки">
            <div>
              <span>01</span>Почему эта роль
            </div>
            <div>
              <span>02</span>Почему такой приоритет
            </div>
            <div>
              <span>03</span>Отправители и получатели
            </div>
            <div>
              <span>04</span>Ограничения данных
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
