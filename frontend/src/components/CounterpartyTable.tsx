import type { Counterparty } from '../types/api';
import { formatInteger, formatMoney } from '../utils/format';
import { CopyGidButton } from './CopyGidButton';

export function CounterpartyTable({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: Counterparty[];
  onSelect: (gid: string) => void;
}) {
  return (
    <section className="card-section">
      <h4>
        {title} <span className="count-badge">{items.length}</span>
      </h4>
      {items.length === 0 ? (
        <p className="field-hint">Таких переводов в выборке нет.</p>
      ) : (
        <div
          className="table-scroll counterpart-scroll"
          role="region"
          aria-label={title}
          tabIndex={0}
        >
          <table>
            <caption className="sr-only">
              {title}: клиент, сумма, количество операций
            </caption>
            <thead>
              <tr>
                <th scope="col">Клиент</th>
                <th scope="col">Сумма / операции</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.gid}>
                  <td>
                    <button
                      className="text-button gid"
                      onClick={() => onSelect(item.gid)}
                      aria-label={`Открыть контрагента ${item.gid}`}
                    >
                      {item.gid}
                    </button>
                    <CopyGidButton gid={item.gid} />
                  </td>
                  <td>
                    {formatMoney(item.sum_kzt)}
                    <span className="table-subline">
                      Операций: {formatInteger(item.n_tx)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
