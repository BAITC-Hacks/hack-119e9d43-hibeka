export function LoadingOverview() {
  return (
    <section
      className="loading-overview"
      aria-label="Загрузка сводки"
      aria-busy="true"
    >
      <div className="loading-label" role="status">
        <span className="spinner" aria-hidden="true" />
        Загружаем сводку и пример очереди…
      </div>
      <div className="metrics-grid" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <div className="metric" key={index}>
            <span className="skeleton skeleton-label" />
            <span className="skeleton skeleton-number" />
            <span className="skeleton skeleton-label" />
          </div>
        ))}
      </div>
    </section>
  );
}
