import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { http, messageOf } from '../api/client';
import type { AnalysisRun } from '../api/client';
import { Icon } from './Icon';

const stages: Record<string, string> = {
  queued: 'Ожидание запуска',
  loading: 'Чтение файлов',
  validation: 'Проверка данных',
  validating: 'Проверка данных',
  graph: 'Построение графа',
  features: 'Расчёт признаков',
  metrics: 'Расчёт связей',
  clustering: 'Поиск групп',
  roles: 'Определение ролей',
  scoring: 'Составление рейтинга',
  exports: 'Подготовка CSV',
  exporting: 'Подготовка CSV',
  running: 'Анализ переводов',
  completed: 'Анализ готов',
  failed: 'Анализ не завершён',
};
export function UploadDialog({
  initialJob,
  onClose,
  onComplete,
}: {
  initialJob?: string;
  onClose: () => void;
  onComplete: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uploadController = useRef<AbortController | null>(null);
  const complete = useRef(onComplete);
  const [job, setJob] = useState(initialJob);
  const [run, setRun] = useState<AnalysisRun>();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    complete.current = onComplete;
  }, [onComplete]);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      uploadController.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!job) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await http.run(job!, controller.signal);
        if (controller.signal.aborted) return;
        setRun(result);
        if (result.status === 'completed') {
          complete.current(result.run_id);
          return;
        }
        if (result.status === 'failed') {
          setError(
            result.error?.message ?? 'Проверьте файлы и повторите анализ.',
          );
          return;
        }
        timer = setTimeout(() => void poll(), 1200);
      } catch (failure) {
        if (!controller.signal.aborted) setError(messageOf(failure));
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [job, retry]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    for (const key of ['nodes', 'edges', 'transactions']) {
      const file = data.get(key);
      if (!(file instanceof File) || file.size === 0) {
        setError('Выберите все три файла Parquet.');
        return;
      }
      if (file.size > 128 * 1024 * 1024) {
        setError('Размер каждого файла должен быть не больше 128 МБ.');
        return;
      }
    }
    setError('');
    setSending(true);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const result = await http.upload(data, controller.signal);
      if (!controller.signal.aborted) setJob(result.run_id);
    } catch (failure) {
      if (!controller.signal.aborted) setError(messageOf(failure));
    } finally {
      if (!controller.signal.aborted) setSending(false);
    }
  }
  return (
    <dialog
      className="upload-dialog"
      ref={dialog}
      onCancel={(event) => {
        if (sending) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <div className="section-heading">
        <div>
          <span className="eyebrow">НОВЫЙ АНАЛИЗ</span>
          <h2>Загрузить переводы</h2>
        </div>
        <button
          className="close-button"
          aria-label="Закрыть"
          disabled={sending}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="muted">
        Выберите три файла одной выборки. Готовый результат сохранится отдельно
        от предыдущих анализов.
      </p>
      {error && (
        <div className="error-box" role="alert">
          {error}
        </div>
      )}
      {job ? (
        <div className="upload-progress" aria-live="polite">
          {run?.status !== 'failed' && !error && <span className="spinner" />}
          <h3>
            {run?.status === 'failed'
              ? 'Проверьте исходные данные'
              : (stages[run?.stage ?? 'queued'] ?? 'Анализ переводов')}
          </h3>
          <p className="muted">
            Окно можно закрыть — обработка продолжится на сервере.
          </p>
          {error && run?.status !== 'failed' && (
            <button
              className="button"
              onClick={() => {
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              Проверить статус
            </button>
          )}
          {run?.status === 'failed' && (
            <button
              className="button"
              onClick={() => {
                setJob(undefined);
                setRun(undefined);
                setError('');
              }}
            >
              Выбрать файлы заново
            </button>
          )}
        </div>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          {[
            ['nodes', 'Клиенты', 'nodes.parquet'],
            ['edges', 'Связи', 'edges.parquet'],
            ['transactions', 'Переводы', 'transactions.parquet'],
          ].map(([name, label, file]) => (
            <label className="file-field" key={name}>
              <span>
                <strong>{label}</strong>
                <small>{file}</small>
              </span>
              <input
                name={name}
                type="file"
                accept=".parquet"
                required
                disabled={sending}
              />
            </label>
          ))}
          <p className="fine-print">Формат Parquet · до 128 МБ на файл</p>
          <button
            className="button button-primary full-width"
            disabled={sending}
          >
            {sending ? (
              <>
                <span className="spinner" />
                Загружаем файлы…
              </>
            ) : (
              <>
                <Icon name="upload" size={17} />
                Начать анализ
              </>
            )}
          </button>
        </form>
      )}
    </dialog>
  );
}
