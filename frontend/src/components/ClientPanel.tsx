import { lazy, Suspense } from 'react';
import { http } from '../api/client';
import type { AnalysisNode, AnalysisDetail } from '../api/client';
import type { Counterparty } from '../types/api';
import { useResource } from '../hooks/useResource';
import { roleLabels } from '../utils/roles';
import { formatDate, formatMoney, formatScore } from '../utils/format';
const LocalGraph = lazy(() =>
  import('./LocalGraph').then((module) => ({ default: module.LocalGraph })),
);
import { Icon } from './Icon';
import { CopyGidButton } from './CopyGidButton';

export function RoleBadge({ node }: { node: AnalysisNode }) {
  return (
    <span className={`role-badge role-${node.role}`}>
      <i />
      {roleLabels[node.role]}
    </span>
  );
}
export function ReadState({
  error,
  onRetry,
  label = 'Загружаем данные…',
}: {
  error?: string;
  onRetry: () => void;
  label?: string;
}) {
  return (
    <div
      className={`read-state ${error ? 'read-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      {error ? (
        <>
          <Icon name="alert" />
          <p>{error}</p>
          <button className="button" onClick={onRetry}>
            Повторить
          </button>
        </>
      ) : (
        <>
          <span className="spinner" />
          <p>{label}</p>
        </>
      )}
    </div>
  );
}
function Counterparties({
  title,
  rows,
  onSelect,
}: {
  title: string;
  rows: Counterparty[];
  onSelect: (gid: string) => void;
}) {
  return (
    <div className="counterparties">
      <h4>
        {title} <span className="count">{rows.length}</span>
      </h4>
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Клиент</th>
                <th>Сумма</th>
                <th>Переводов</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => b.sum_kzt - a.sum_kzt)
                .map((row) => (
                  <tr key={row.gid}>
                    <td>
                      <button
                        className="text-button mono"
                        onClick={() => onSelect(row.gid)}
                      >
                        {row.gid}
                      </button>
                    </td>
                    <td>{formatMoney(row.sum_kzt)}</td>
                    <td>{row.n_tx}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Нет наблюдаемых переводов</p>
      )}
    </div>
  );
}
const factors: Record<string, string> = {
  betweenness: 'Посредничество в цепочках',
  pagerank: 'Значимость связей',
  activity_kzt: 'Объём переводов',
  n_seed_upstream: 'Связь с исходными клиентами',
  neighbor_count: 'Количество контрагентов',
};

function shortExplanation(node: AnalysisDetail): string {
  if (node.is_isolated)
    return 'В этой выборке у клиента нет наблюдаемых переводов. Данных для определения роли недостаточно.';
  switch (node.role) {
    case 'coordinator':
      return `Связан с клиентами из ${node.neighbor_cluster_count} групп и часто находится на путях между другими участниками. Всего контрагентов: ${node.neighbor_count}.`;
    case 'consolidator':
      return `Получает переводы от ${node.in_deg} клиентов. Входящие потоки дают основания проверить гипотезу о сборе средств.`;
    case 'distributor':
      return `Отправляет переводы ${node.out_deg} клиентам. Исходящие потоки дают основания проверить гипотезу о распределении средств.`;
    case 'transit':
      return 'У клиента наблюдаются и входящие, и исходящие переводы. Соотношение потоков соответствует признакам транзита; это не доказывает пересылку тех же денег.';
    case 'terminal':
      return 'Есть входящие переводы, а исходящие в доступный период не наблюдаются. Это возможный конечный получатель в пределах выборки.';
    case 'peripheral':
      return `Наблюдаемых признаков недостаточно для уверенного выбора роли. Отправителей: ${node.in_deg}, получателей: ${node.out_deg}.`;
  }
}

function Details({
  node,
  onSelect,
}: {
  node: AnalysisDetail;
  onSelect: (gid: string) => void;
}) {
  const graph = useResource(`${node.run_id}/${node.gid}/graph`, (signal) =>
    http.graph(node.run_id, node.gid, signal),
  );
  const strongest = [...node.priority_factors]
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 2);
  return (
    <>
      <div className="client-header">
        <div>
          <span className="eyebrow">ВЫБРАННЫЙ КЛИЕНТ</span>
          <div className="client-id">
            <h2>{node.gid}</h2>
            <CopyGidButton gid={node.gid} />
          </div>
        </div>
        <div className="priority-heading">
          <strong>#{node.rank}</strong>
          <span>в очереди проверки</span>
        </div>
      </div>
      <div className="client-badges">
        <span className="role-caption">Предполагаемая роль</span>
        <RoleBadge node={node} />
        <span className="plain-badge">Группа {node.cluster_id}</span>
        {node.is_seed && <span className="plain-badge">Исходный клиент</span>}
        {node.truncated_by_depth && (
          <span className="plain-badge">Граница выборки</span>
        )}
      </div>
      <section className="explanation">
        <h3>Почему стоит посмотреть</h3>
        <p>{shortExplanation(node)}</p>
        {node.priority_score > 0 && (
          <p className="muted">
            Основной вклад в приоритет:{' '}
            {strongest
              .map((factor) =>
                (factors[factor.name] ?? factor.name).toLocaleLowerCase('ru'),
              )
              .join(' и ')}
            .
          </p>
        )}
      </section>
      <div className="flow-facts">
        <div>
          <span>↙ Получено</span>
          <strong>{formatMoney(node.in_kzt)}</strong>
          <small>
            От клиентов: {node.in_deg} · переводов: {node.in_tx}
          </small>
        </div>
        <div>
          <span>↗ Отправлено</span>
          <strong>{formatMoney(node.out_kzt)}</strong>
          <small>
            Клиентам: {node.out_deg} · переводов: {node.out_tx}
          </small>
        </div>
      </div>
      <div className="observation">
        <Icon name="info" size={17} />
        <div>
          <strong>Данные ограничены выборкой</strong>
          <p>
            Показаны только переводы из датасета. Другие поступления и остаток
            на счёте неизвестны. Предполагаемая роль требует проверки.
          </p>
          {node.truncated_by_depth && (
            <p>
              Граница выборки: исходящие связи этого клиента исследованы не
              полностью.
            </p>
          )}
        </div>
      </div>
      {graph.data ? (
        <Suspense
          fallback={<ReadState onRetry={graph.retry} label="Открываем граф…" />}
        >
          <LocalGraph
            key={`${node.run_id}/${node.gid}`}
            graph={graph.data}
            onSelect={onSelect}
          />
        </Suspense>
      ) : (
        <ReadState
          error={graph.error}
          onRetry={graph.retry}
          label="Строим граф связей…"
        />
      )}
      <details className="disclosure">
        <summary>
          <span>Контрагенты и суммы</span>
          <span className="muted">
            Входящие {node.incoming.length} · исходящие {node.outgoing.length}
          </span>
        </summary>
        <div className="disclosure-body">
          <p className="fine-print">
            Суммы агрегированы за период анализа. Нажмите на идентификатор,
            чтобы открыть клиента.
          </p>
          <Counterparties
            title="Входящие"
            rows={node.incoming}
            onSelect={onSelect}
          />
          <Counterparties
            title="Исходящие"
            rows={node.outgoing}
            onSelect={onSelect}
          />
        </div>
      </details>
      <details className="disclosure">
        <summary>
          <span>Как рассчитаны роль и приоритет</span>
          <span className="muted">
            Приоритет {formatScore(node.priority_score)}
          </span>
        </summary>
        <div className="disclosure-body">
          <p className="fine-print">
            Приоритет показывает порядок проверки. Оценка роли отражает силу
            признаков; ни одна оценка не является вероятностью нарушения.
          </p>
          <h4>Вклад в приоритет</h4>
          {node.priority_factors.map((factor) => (
            <div className="factor" key={factor.name}>
              <span>{factors[factor.name] ?? factor.name}</span>
              <div className="factor-track">
                <i
                  style={{
                    width: `${Math.min(100, Math.max(0, factor.contribution * 100))}%`,
                  }}
                />
              </div>
              <b>{(factor.contribution * 100).toFixed(1)} / 100</b>
            </div>
          ))}
          <h4>Роль: {roleLabels[node.role]}</h4>
          <p>
            Сила признаков: {formatScore(node.role_score)}.{' '}
            {node.role_selection_reason}
          </p>
          <p className="technical-text">{node.role_explanation}</p>
          <dl className="detail-facts">
            <div>
              <dt>Первый входящий перевод</dt>
              <dd>{formatDate(node.first_in_date)}</dd>
            </div>
            <div>
              <dt>Дней до конца периода после первого входящего</dt>
              <dd>{node.days_after_first_in ?? 'Нет данных'}</dd>
            </div>
            <div>
              <dt>Прямые переводы от исходных клиентов</dt>
              <dd>{node.seed_in_direct}</dd>
            </div>
            <div>
              <dt>Исходные клиенты выше по цепочке</dt>
              <dd>{node.n_seed_upstream}</dd>
            </div>
            <div>
              <dt>Шаг обхода</dt>
              <dd>{node.depth}</dd>
            </div>
          </dl>
          <h4>Ограничения наблюдения</h4>
          <ul className="limitations">
            {node.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      </details>
    </>
  );
}
export function ClientPanel({
  runId,
  gid,
  onSelect,
}: {
  runId: string;
  gid: string;
  onSelect: (gid: string) => void;
}) {
  const result = useResource(`${runId}/${gid}`, (signal) =>
    http.node(runId, gid, signal),
  );
  return (
    <article className="client-panel" aria-label="Карточка клиента">
      {result.data ? (
        <Details
          key={`${runId}/${gid}`}
          node={result.data}
          onSelect={onSelect}
        />
      ) : (
        <ReadState
          error={result.error}
          onRetry={result.retry}
          label="Открываем клиента…"
        />
      )}
    </article>
  );
}
