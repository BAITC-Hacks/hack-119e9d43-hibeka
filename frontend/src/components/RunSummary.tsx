import type { RunSummary as Summary } from '../types/api';
import {
  formatDate,
  formatDuration,
  formatInteger,
  formatMoney,
} from '../utils/format';
import { Icon } from './Icon';

export function RunSummary({ summary }: { summary: Summary }) {
  const metrics = [
    {
      label: 'Клиенты',
      value: formatInteger(summary.n_nodes),
      caption: `${formatInteger(summary.n_seed)} исходных`,
    },
    {
      label: 'Связи',
      value: formatInteger(summary.n_edges),
      caption: 'направленные переводы',
    },
    {
      label: 'Операции',
      value: formatInteger(summary.n_transactions),
      caption: 'в наблюдаемой выборке',
    },
    {
      label: 'Наблюдаемый оборот',
      value: formatMoney(summary.sum_kzt),
      caption: 'сумма операций',
      wide: true,
    },
    {
      label: 'Кластеры',
      value: formatInteger(summary.n_clusters),
      caption: `расчёт за ${formatDuration(summary.elapsed_seconds)}`,
    },
  ];
  return (
    <section className="summary-section" aria-labelledby="summary-title">
      <div className="section-heading">
        <h2 id="summary-title">Обзор выборки</h2>
        <p>
          {formatDate(summary.period_start)} — {formatDate(summary.period_end)}
        </p>
      </div>
      <dl className="metrics-grid">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className={`metric${metric.wide ? ' metric-wide' : ''}`}
          >
            <dt>{metric.label}</dt>
            <dd>{metric.value}</dd>
            <dd className="metric-caption">{metric.caption}</dd>
          </div>
        ))}
      </dl>
      <div className="data-notice">
        <Icon name="info" />
        <div>
          <p>
            Роли — гипотезы для проверки. Полное движение денег и остатки на
            счетах неизвестны.
          </p>
          <span>
            Изолированных клиентов: {summary.n_isolated} · На границе четвёртого
            колена: {summary.n_truncated}
          </span>
        </div>
      </div>
    </section>
  );
}
