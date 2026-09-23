import { isMockScenario, type MockScenario } from '../api/mock';
import { Icon } from './Icon';

interface PreviewControlsProps {
  scenario: MockScenario;
  onScenarioChange: (scenario: MockScenario) => void;
  onReload: () => void;
  loading: boolean;
  enabled: boolean;
}

export function PreviewControls({
  scenario,
  onScenarioChange,
  onReload,
  loading,
  enabled,
}: PreviewControlsProps) {
  return (
    <aside className="preview-banner" aria-label="Режим просмотра">
      <div className="preview-description">
        <span className="preview-tag">
          {enabled ? 'Демонстрационные данные' : 'API не подключён'}
        </span>
        <p>
          {enabled
            ? 'Синтетический пример для проверки интерфейса. Не результат анализа датасета.'
            : 'Выбран режим, который ещё не поддерживается на первом этапе.'}
        </p>
      </div>
      {enabled && (
        <div className="preview-actions">
          <label htmlFor="preview-scenario">Состояние</label>
          <select
            id="preview-scenario"
            value={scenario}
            onChange={(event) => {
              if (isMockScenario(event.target.value))
                onScenarioChange(event.target.value);
            }}
          >
            <option value="success">Готовый результат</option>
            <option value="loading">Загрузка</option>
            <option value="empty">Нет данных</option>
            <option value="error">Ошибка</option>
            <option value="queue-error">Ошибка очереди</option>
            <option value="card-error">Ошибка карточки</option>
            <option value="partial">Неполная карточка</option>
          </select>
          <button
            className="icon-button"
            aria-label="Повторить загрузку примера"
            onClick={onReload}
            disabled={loading}
          >
            <Icon name="refresh" />
          </button>
        </div>
      )}
    </aside>
  );
}
