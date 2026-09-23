import { useEffect, useRef, useState } from 'react';
import { copyGid } from '../utils/clipboard';
import { isValidGid } from '../utils/gid';
import { Icon } from './Icon';

export function CopyGidButton({ gid }: { gid: string }) {
  return <CopyGidAction key={gid} gid={gid} />;
}

function CopyGidAction({ gid }: { gid: string }) {
  const [status, setStatus] = useState<{
    pending: boolean;
    message: string;
    error: boolean;
  }>({ pending: false, message: '', error: false });
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current += 1;
    },
    [gid],
  );
  const copy = async () => {
    if (status.pending) return;
    const current = ++generation.current;
    setStatus({ pending: true, message: '', error: false });
    try {
      await copyGid(gid, navigator.clipboard);
      if (generation.current === current)
        setStatus({ pending: false, message: 'Gid скопирован', error: false });
    } catch (error) {
      if (generation.current === current)
        setStatus({
          pending: false,
          message:
            error instanceof Error ? error.message : 'Копирование не удалось.',
          error: true,
        });
    }
  };
  return (
    <span className="copy-control">
      <button
        type="button"
        className="icon-button copy-button"
        title={`Скопировать gid ${gid}`}
        aria-label={`Скопировать gid ${gid}`}
        disabled={!isValidGid(gid) || status.pending}
        onClick={(event) => {
          event.stopPropagation();
          void copy();
        }}
      >
        <Icon name="copy" size={16} />
      </button>
      <span
        className={`copy-feedback${status.error ? ' copy-error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {status.message}
      </span>
    </span>
  );
}
