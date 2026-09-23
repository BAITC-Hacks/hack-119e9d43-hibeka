import type { WorkspaceController, WorkspaceState } from '../state/workspace';
import type { ClientDetails } from '../types/api';
import {
  formatDate,
  formatDecimal,
  formatInteger,
  formatMoney,
  formatScore,
  formatText,
} from '../utils/format';
import { roleLabels } from '../utils/roles';
import { CopyGidButton } from './CopyGidButton';
import { CounterpartyTable } from './CounterpartyTable';

function ClientContent({
  client,
  onSelect,
}: {
  client: ClientDetails;
  onSelect: (gid: string) => void;
}) {
  return (
    <div className="client-content">
      <div className="client-identity">
        <span className="gid">{client.gid}</span>
        <CopyGidButton gid={client.gid} />
      </div>
      <div className="client-tags">
        <span className={`role-badge role-${client.role}`}>
          {roleLabels[client.role]}
        </span>
        {client.is_seed && <span className="quiet-badge">Исходный клиент</span>}
        {client.truncated_by_depth && (
          <span className="boundary-tag">Граница наблюдения</span>
        )}
      </div>
      <p className="field-hint">
        Ранг {client.rank} · Кластер {client.cluster_id} · Колено {client.depth}
      </p>
      <dl className="client-scores">
        <div>
          <dt>Приоритет проверки</dt>
          <dd>{formatScore(client.priority_score)}</dd>
        </div>
        <div>
          <dt>Сила признаков роли</dt>
          <dd>{formatScore(client.role_score)}</dd>
        </div>
      </dl>
      <p className="field-hint">
        Сила признаков роли — эвристическая оценка, не вероятность нарушения.
      </p>
      <section className="card-section">
        <h4>Почему эта роль</h4>
        <p>{formatText(client.role_explanation)}</p>
        {client.role_selection_reason && (
          <p className="field-hint">{client.role_selection_reason}</p>
        )}
      </section>
      <section className="card-section">
        <h4>Почему такой приоритет</h4>
        <p>{formatText(client.priority_explanation)}</p>
        <details className="factor-details">
          <summary>Вклад факторов в рейтинг</summary>
          {client.priority_factors.length === 0 ? (
            <p className="field-hint">Данные о вкладах не предоставлены.</p>
          ) : (
            <div
              className="table-scroll"
              role="region"
              aria-label="Вклад факторов"
              tabIndex={0}
            >
              <table>
                <caption className="sr-only">
                  Исходное и нормализованное значение, вес и вклад каждого
                  фактора
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Фактор</th>
                    <th scope="col">Значение</th>
                    <th scope="col">Норм.</th>
                    <th scope="col">Вес</th>
                    <th scope="col">Вклад</th>
                  </tr>
                </thead>
                <tbody>
                  {client.priority_factors.map((factor) => (
                    <tr key={factor.name}>
                      <th scope="row">{factor.name}</th>
                      <td>{formatDecimal(factor.raw_value)}</td>
                      <td>{formatDecimal(factor.normalized_value)}</td>
                      <td>{formatDecimal(factor.weight)}</td>
                      <td>{formatDecimal(factor.contribution)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      </section>
      <section className="card-section">
        <h4>Потоки в наблюдаемой выборке</h4>
        <dl className="flow-metrics">
          <div>
            <dt>Получено</dt>
            <dd>{formatMoney(client.in_kzt)}</dd>
          </div>
          <div>
            <dt>Отправлено</dt>
            <dd>{formatMoney(client.out_kzt)}</dd>
          </div>
          <div>
            <dt>Отправителей</dt>
            <dd>{formatInteger(client.in_deg)}</dd>
          </div>
          <div>
            <dt>Получателей</dt>
            <dd>{formatInteger(client.out_deg)}</dd>
          </div>
          <div>
            <dt>Входящих операций</dt>
            <dd>{formatInteger(client.metrics.in_tx)}</dd>
          </div>
          <div>
            <dt>Исходящих операций</dt>
            <dd>{formatInteger(client.metrics.out_tx)}</dd>
          </div>
          <div>
            <dt>Первое поступление</dt>
            <dd>{formatDate(client.metrics.first_in_date)}</dd>
          </div>
          <div>
            <dt>Дней наблюдения после поступления</dt>
            <dd>{formatInteger(client.metrics.days_after_first_in)}</dd>
          </div>
        </dl>
      </section>
      <CounterpartyTable
        title="Отправители"
        items={client.incoming}
        onSelect={onSelect}
      />
      <CounterpartyTable
        title="Получатели"
        items={client.outgoing}
        onSelect={onSelect}
      />
      <section className="card-section client-warnings">
        <h4>Ограничения данных</h4>
        <ul>
          {client.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
        {client.role === 'terminal' && (
          <p>
            Нет исходящих в наблюдаемой выборке; остаток на счёте неизвестен.
            Доступных дней после первого поступления:{' '}
            {formatInteger(client.metrics.days_after_first_in)}.
          </p>
        )}
        <p>
          Роль — гипотеза для проверки. Разность сумм не является остатком на
          счёте.
        </p>
      </section>
    </div>
  );
}

export function ClientCard({
  state,
  controller,
  disabled,
}: {
  state: WorkspaceState;
  controller: WorkspaceController;
  disabled: boolean;
}) {
  const card = disabled ? { status: 'idle' as const } : state.card;
  return (
    <section
      className="panel client-panel"
      aria-labelledby="client-title"
      aria-busy={card.status === 'loading'}
    >
      <div className="panel-heading">
        <div>
          <h3 id="client-title">Карточка клиента</h3>
          <p>Факты и причины проверки</p>
        </div>
        <button
          className="icon-button"
          title="Обновить карточку"
          aria-label="Обновить карточку"
          disabled={disabled || !state.selectedGid || card.status === 'loading'}
          onClick={() => {
            void controller.retryCard();
          }}
        >
          ↻
        </button>
      </div>
      {card.status === 'idle' && (
        <div className="panel-empty">
          <h4>Клиент не выбран</h4>
          <p>Выберите строку очереди или найдите клиента по полному gid.</p>
        </div>
      )}
      {card.status === 'loading' && (
        <div className="resource-message" role="status">
          <p>Загружаем карточку</p>
          <span className="gid">{state.selectedGid}</span>
        </div>
      )}
      {card.status === 'error' && (
        <div className="resource-message" role="alert">
          <span className="gid">{state.selectedGid}</span>
          <p>{card.message}</p>
          <button
            className="button"
            onClick={() => {
              void controller.retryCard();
            }}
          >
            Повторить загрузку карточки
          </button>
        </div>
      )}
      {card.status === 'success' && card.data.gid === state.selectedGid && (
        <ClientContent
          key={`${card.data.run_id}:${card.data.gid}`}
          client={card.data}
          onSelect={(gid) => {
            void controller.select(gid, true);
          }}
        />
      )}
    </section>
  );
}
