import type { WorkspaceState, WorkspaceController } from '../state/workspace';
import { formatMoney } from '../utils/format';

export function ClusterTable({
  state,
  controller,
}: {
  state: WorkspaceState;
  controller: WorkspaceController;
}) {
  const clusters = state.clusters;
  return (
    <details className="cluster-details">
      <summary>
        Кластеры сети
        {clusters.status === 'success'
          ? ` · ${clusters.data.items.length}`
          : ''}
      </summary>
      {clusters.status === 'loading' && (
        <p role="status">Загружаем кластеры…</p>
      )}
      {clusters.status === 'error' && (
        <div role="alert">
          <p>{clusters.message}</p>
          <button
            className="button"
            onClick={() => {
              void controller.loadClusters();
            }}
          >
            Повторить загрузку кластеров
          </button>
        </div>
      )}
      {clusters.status === 'success' &&
        (clusters.data.items.length === 0 ? (
          <p>Кластеры не найдены.</p>
        ) : (
          <div
            className="table-scroll"
            role="region"
            aria-label="Таблица кластеров"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Кластер</th>
                  <th scope="col">Клиенты / исходные</th>
                  <th scope="col">Внутренний оборот</th>
                  <th scope="col">Главные клиенты</th>
                  <th scope="col">Гипотеза</th>
                </tr>
              </thead>
              <tbody>
                {clusters.data.items.map((cluster) => (
                  <tr key={cluster.cluster_id}>
                    <td>
                      <button
                        className="text-button"
                        onClick={() => {
                          void controller.setFilters({
                            cluster_id: cluster.cluster_id,
                          });
                        }}
                      >
                        Кластер {cluster.cluster_id}
                      </button>
                    </td>
                    <td>
                      {cluster.n_nodes} / {cluster.n_seed}
                    </td>
                    <td>{formatMoney(cluster.sum_kzt_internal)}</td>
                    <td>
                      {cluster.top_gids.map((gid) => (
                        <button
                          className="text-button gid"
                          key={gid}
                          onClick={() => {
                            void controller.select(gid, true);
                          }}
                        >
                          {gid}
                        </button>
                      ))}
                    </td>
                    <td>{cluster.hypothesis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </details>
  );
}
