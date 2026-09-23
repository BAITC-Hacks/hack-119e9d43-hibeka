import { useMemo, useState } from 'react';
import { createApi } from './api';
import { isMockScenario, type MockScenario } from './api/mock';
import type { AnalyticsApi } from './types/api';
import { useOverview } from './hooks/useOverview';
import { AppHeader } from './components/AppHeader';
import { PreviewControls } from './components/PreviewControls';
import { RunSummary } from './components/RunSummary';
import { StatusPanel } from './components/StatusPanel';
import { LoadingOverview } from './components/LoadingOverview';
import { WorkspaceShell } from './components/WorkspaceShell';

function OverviewScreen({
  api,
  scenario,
  onScenarioChange,
  onReload,
  mockEnabled,
  revision,
}: {
  api: AnalyticsApi;
  scenario: MockScenario;
  onScenarioChange: (value: MockScenario) => void;
  onReload: () => void;
  mockEnabled: boolean;
  revision: number;
}) {
  const state = useOverview(api, revision);
  return (
    <>
      <PreviewControls
        scenario={scenario}
        onScenarioChange={onScenarioChange}
        onReload={onReload}
        loading={state.status === 'loading'}
        enabled={mockEnabled}
      />
      <main id="main-content" tabIndex={-1}>
        <div className="page-intro">
          <div>
            <span className="eyebrow">Финансовый мониторинг</span>
            <h2>Деньги связывают. Данные объясняют.</h2>
          </div>
          <span className="local-label">Локальное рабочее пространство</span>
        </div>
        {state.status === 'loading' && <LoadingOverview />}
        {state.status === 'success' && (
          <>
            <RunSummary summary={state.data.run.summary} />
            <p className="demo-provenance">
              {state.data.run.warnings.join(' ')}
            </p>
          </>
        )}
        {state.status === 'empty' && (
          <StatusPanel
            kind="empty"
            title="Готовых расчётов пока нет"
            description="Данных для сводки ещё нет. Для просмотра каркаса выберите состояние «Готовый результат» выше. Загрузка файлов появится на этапе подключения API."
          />
        )}
        {state.status === 'error' && (
          <StatusPanel
            kind="error"
            title="Не удалось открыть результат"
            description={state.message}
            onRetry={onReload}
          />
        )}
        <WorkspaceShell
          nodes={state.status === 'success' ? state.data.nodes : undefined}
          loading={state.status === 'loading'}
        />
        <div className="next-stage-note">
          <span>Дальше</span>
          <p>
            Очередь и карточка клиента → интерактивный граф → подключение API,
            загрузка и экспорт.
          </p>
        </div>
      </main>
      <footer className="app-footer">
        <span>
          HIBEKA <span aria-hidden="true">/</span> HackAlem AI
        </span>
        <span>Этап 1 · Контракт и каркас интерфейса</span>
      </footer>
    </>
  );
}

export default function App() {
  const configuredScenario = import.meta.env.VITE_MOCK_SCENARIO ?? 'success';
  const mode = import.meta.env.VITE_API_MODE ?? 'mock';
  const [scenario, setScenario] = useState<MockScenario>(
    isMockScenario(configuredScenario) ? configuredScenario : 'success',
  );
  const [revision, setRevision] = useState(0);
  const api = useMemo(() => createApi(mode, scenario), [mode, scenario]);
  return (
    <>
      <a href="#main-content" className="skip-link">
        Перейти к рабочему пространству
      </a>
      <AppHeader />
      <OverviewScreen
        api={api}
        scenario={scenario}
        onScenarioChange={setScenario}
        onReload={() => setRevision((value) => value + 1)}
        mockEnabled={mode === 'mock'}
        revision={revision}
      />
    </>
  );
}
