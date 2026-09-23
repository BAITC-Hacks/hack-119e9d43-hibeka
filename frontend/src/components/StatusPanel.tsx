import { Icon } from './Icon';

interface StatusPanelProps {
  kind: 'empty' | 'error';
  title: string;
  description: string;
  onRetry?: () => void;
}

export function StatusPanel({
  kind,
  title,
  description,
  onRetry,
}: StatusPanelProps) {
  return (
    <div
      className={`status-panel status-${kind}`}
      role={kind === 'error' ? 'alert' : 'status'}
    >
      <span className="status-icon">
        <Icon name={kind === 'error' ? 'alert' : 'layers'} size={26} />
      </span>
      <h2>{title}</h2>
      <p>{description}</p>
      {onRetry && (
        <button className="button" onClick={onRetry}>
          <Icon name="refresh" />
          Повторить загрузку
        </button>
      )}
    </div>
  );
}
