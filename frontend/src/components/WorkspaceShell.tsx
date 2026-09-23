import { useSyncExternalStore } from 'react';
import type { WorkspaceController } from '../state/workspace';
import { SearchFilters } from './SearchFilters';
import { ReviewQueue } from './ReviewQueue';
import { ClientCard } from './ClientCard';
import { ClusterTable } from './ClusterTable';
import { Icon } from './Icon';

export function WorkspaceShell({
  controller,
  disabled,
  runId,
}: {
  controller: WorkspaceController;
  disabled: boolean;
  runId: string | null;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
  );
  const unavailable = disabled || state.runId !== runId;
  return (
    <>
      <SearchFilters
        state={state}
        controller={controller}
        disabled={unavailable}
      />
      <div className="workspace-grid review-grid">
        <ReviewQueue
          state={state}
          controller={controller}
          disabled={unavailable}
        />
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
              <h4>Окружение клиента</h4>
              <p className="gid">
                {!unavailable && state.selectedGid
                  ? state.selectedGid
                  : 'Клиент не выбран'}
              </p>
              <p>
                Отправители и получатели доступны в карточке. Интерактивная
                схема появится на следующем этапе.
              </p>
            </div>
          </div>
          <div className="graph-footer">
            <Icon name="info" size={16} />
            <span>Выбор синхронизирован с карточкой</span>
          </div>
        </section>
        <ClientCard
          state={state}
          controller={controller}
          disabled={unavailable}
        />
      </div>
      {!unavailable && <ClusterTable state={state} controller={controller} />}
    </>
  );
}
