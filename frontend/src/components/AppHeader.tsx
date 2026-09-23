import { Icon } from './Icon';

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="network" size={25} />
        </span>
        <div>
          <h1>Граф денег</h1>
          <p>Аналитика финансовых связей</p>
        </div>
      </div>
      <div className="header-actions" aria-describedby="header-actions-note">
        <span className="stage-badge">
          Этап 02 <span>/ Клиенты</span>
        </span>
        <button className="button" disabled>
          <Icon name="download" />
          Скачать CSV
        </button>
        <button className="button button-primary" disabled>
          <Icon name="upload" />
          Загрузить данные
        </button>
      </div>
      <p id="header-actions-note" className="sr-only">
        Загрузка и скачивание будут доступны после подключения аналитического
        API на четвёртом этапе.
      </p>
    </header>
  );
}
