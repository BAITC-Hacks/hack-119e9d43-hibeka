import { Children, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { assistantStatus, askAssistant } from '../api/assistant';
import type { ChatAnswer, ChatHistory } from '../api/assistant';
import { messageOf } from '../api/client';
import { useResource } from '../hooks/useResource';
import { Icon } from './Icon';
import '../styles/assistant.css';

type Entry = ChatHistory & {
  id: string;
  response?: ChatAnswer;
  selectedGid?: string | null;
};
type Question = { text: string; selectedGid: string | null };

function Answer({
  answer,
  onSelect,
}: {
  answer: ChatAnswer;
  onSelect: (gid: string) => void;
}) {
  const sources = useRef<HTMLDetailsElement>(null);
  const validIds = new Set(answer.client_ids);
  const sourceIds = new Set(answer.sources.map((source) => source.id));
  function linkify(children: ReactNode) {
    return Children.map(children, (child) =>
      typeof child !== 'string'
        ? child
        : child.split(/(\b\d{10,20}\b|\[S\d+\])/g).map((part, index) => {
            if (validIds.has(part))
              return (
                <button
                  className="chat-client-link mono"
                  key={index}
                  onClick={() => onSelect(part)}
                  title="Открыть клиента"
                >
                  {part}
                </button>
              );
            const sourceId = part.slice(1, -1);
            if (sourceIds.has(sourceId) && part.startsWith('['))
              return (
                <button
                  key={index}
                  className="chat-citation"
                  aria-label={`Открыть источник ${sourceId}`}
                  onClick={() => {
                    if (sources.current) {
                      sources.current.open = true;
                      sources.current
                        .querySelector(`[data-source="${sourceId}"]`)
                        ?.scrollIntoView({ block: 'nearest' });
                    }
                  }}
                >
                  {part}
                </button>
              );
            return part;
          }),
    );
  }
  return (
    <>
      <div className="chat-answer">
        <ReactMarkdown
          skipHtml
          urlTransform={() => ''}
          components={{
            p: ({ children }) => <p>{linkify(children)}</p>,
            li: ({ children }) => <li>{linkify(children)}</li>,
            strong: ({ children }) => <strong>{linkify(children)}</strong>,
            em: ({ children }) => <em>{linkify(children)}</em>,
            code: ({ children }) => <code>{linkify(children)}</code>,
            h1: ({ children }) => <h3>{linkify(children)}</h3>,
            h2: ({ children }) => <h3>{linkify(children)}</h3>,
            h3: ({ children }) => <h3>{linkify(children)}</h3>,
            a: ({ children }) => <span>{linkify(children)}</span>,
            img: () => null,
          }}
        >
          {answer.answer}
        </ReactMarkdown>
      </div>
      {answer.limited && (
        <p className="chat-small-note">
          Достигнут лимит исследования для одного ответа. Оставшиеся вопросы
          можно уточнить следующим сообщением.
        </p>
      )}
      <details className="chat-sources" ref={sources}>
        <summary>Источники из анализа · {answer.sources.length}</summary>
        {answer.sources.map((source) => (
          <div className="chat-source" key={source.id} data-source={source.id}>
            <strong>
              [{source.id}] {source.title}
            </strong>
            <p>{source.preview}</p>
            {source.client_ids.length > 0 && (
              <div className="chat-source-clients">
                {source.client_ids.map((gid) => (
                  <button
                    className="chat-client-link mono"
                    key={gid}
                    onClick={() => onSelect(gid)}
                  >
                    {gid}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </details>
    </>
  );
}

export function AssistantPanel({
  runId,
  selectedGid,
  open,
  onClose,
  onSelect,
}: {
  runId: string;
  selectedGid: string | null;
  open: boolean;
  onClose: () => void;
  onSelect: (gid: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<Question>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const status = useResource(
    open ? `assistant-status/${runId}` : '',
    assistantStatus,
  );
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  useEffect(() => {
    if (open) end.current?.scrollIntoView({ block: 'nearest' });
  }, [entries, pending, busy, open]);
  function navigate(gid: string) {
    onSelect(gid);
    if (window.matchMedia('(max-width: 1199px)').matches) onClose();
  }
  async function send(question: Question) {
    if (!question.text.trim() || busy || !status.data?.configured) return;
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    const history: ChatHistory[] = entries
      .slice(-8)
      .map((entry) => ({
        role: entry.role,
        content: `${entry.content.slice(0, 5500)}${entry.role === 'user' && entry.selectedGid ? `\n[Выбранный клиент на момент вопроса: ${entry.selectedGid}]` : ''}`,
      }));
    setPending(question);
    setBusy(true);
    setError('');
    setDraft('');
    try {
      const response = await askAssistant(
        runId,
        question.text,
        question.selectedGid,
        history,
        active.signal,
      );
      if (active.signal.aborted) return;
      setEntries((previous) => [
        ...previous,
        {
          id: crypto.randomUUID(),
          role: 'user',
          content: question.text,
          selectedGid: question.selectedGid,
        },
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: response.answer,
          response,
        },
      ]);
      setPending(undefined);
    } catch (failure) {
      if (!active.signal.aborted) setError(messageOf(failure));
    } finally {
      if (!active.signal.aborted) {
        setBusy(false);
        controller.current = null;
      }
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send({ text: draft.trim(), selectedGid });
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setError('Запрос остановлен. Можно повторить или задать другой вопрос.');
  }
  function reset() {
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setEntries([]);
    setPending(undefined);
    setError('');
    setDraft('');
    input.current?.focus();
  }
  if (!open) return null;
  return (
    <aside
      id="ai-analyst"
      ref={panel}
      className="assistant-panel"
      aria-label="ИИ-аналитик"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="assistant-header">
        <div className="assistant-identity">
          <span className="assistant-icon">
            <Icon name="sparkles" size={21} />
          </span>
          <div>
            <h2>ИИ-аналитик</h2>
            <p>Помощник по текущему анализу</p>
          </div>
        </div>
        <button
          className="close-button"
          onClick={onClose}
          aria-label="Закрыть ИИ-аналитика"
        >
          ×
        </button>
      </header>
      <div className="assistant-context">
        <span>
          Анализ <b>{runId.slice(0, 8)}</b>
        </span>
        <button
          className="text-button"
          onClick={reset}
          disabled={!entries.length && !pending && !draft}
        >
          Новый чат
        </button>
        {selectedGid && (
          <span className="assistant-selected">
            Сейчас выбран{' '}
            <button
              className="chat-client-link mono"
              onClick={() => navigate(selectedGid)}
            >
              {selectedGid}
            </button>
          </span>
        )}
      </div>
      <div
        className="assistant-messages"
        role="log"
        aria-label="Диалог с ИИ-аналитиком"
        aria-live="polite"
        aria-relevant="additions"
      >
        {entries.length === 0 && !pending && (
          <div className="assistant-welcome">
            <h3>Что хотите узнать?</h3>
            <p>
              Я могу найти клиентов, объяснить рейтинг, разобрать переводы и
              связи. Использую данные выбранного анализа.
            </p>
            <div className="assistant-suggestions">
              {[
                'С кого начать проверку и почему?',
                ...(selectedGid
                  ? [
                      'Объясни роль выбранного клиента',
                      'Кто переводил ему больше всего?',
                    ]
                  : []),
                'Какие группы стоит изучить?',
              ].map((question) => (
                <button
                  key={question}
                  disabled={!status.data?.configured || busy}
                  onClick={() => void send({ text: question, selectedGid })}
                >
                  {question}
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {status.loading && (
          <p className="chat-small-note">Проверяю подключение…</p>
        )}
        {status.error && (
          <div className="chat-error" role="alert">
            <p>Не удалось узнать статус ИИ: {status.error}</p>
            <button className="text-button" onClick={status.retry}>
              Повторить
            </button>
          </div>
        )}
        {status.data && !status.data.configured && (
          <div className="assistant-setup">
            <Icon name="info" size={18} />
            <div>
              <strong>Подключите OpenAI</strong>
              <p>
                Добавьте <code>OPENAI_API_KEY</code> в файл <code>.env</code> в
                корне проекта. Ключ вводится только на сервере.
              </p>
              <button className="text-button" onClick={status.retry}>
                Обновить статус
              </button>
            </div>
          </div>
        )}
        {entries.map((entry) => (
          <article className={`chat-message chat-${entry.role}`} key={entry.id}>
            <span className="chat-author">
              {entry.role === 'user' ? 'Вы' : 'ИИ-аналитик'}
            </span>
            {entry.response ? (
              <Answer answer={entry.response} onSelect={navigate} />
            ) : (
              <>
                <p className="chat-user-text">{entry.content}</p>
                {entry.selectedGid && (
                  <small>Контекст: {entry.selectedGid}</small>
                )}
              </>
            )}
          </article>
        ))}
        {pending && (
          <article className="chat-message chat-user">
            <span className="chat-author">Вы</span>
            <p className="chat-user-text">{pending.text}</p>
            {pending.selectedGid && (
              <small>Контекст: {pending.selectedGid}</small>
            )}
          </article>
        )}
        {busy && (
          <div className="assistant-working" role="status">
            <span className="spinner" />
            <span>Ищу данные и готовлю ответ…</span>
          </div>
        )}
        {error && (
          <div className="chat-error" role="alert">
            <p>{error}</p>
            {pending && (
              <button
                className="text-button"
                disabled={busy || !status.data?.configured}
                onClick={() => void send(pending)}
              >
                Повторить вопрос
              </button>
            )}
            <button className="text-button" onClick={status.retry}>
              Обновить статус
            </button>
          </div>
        )}
        <div ref={end} />
      </div>
      <form className="assistant-compose" onSubmit={submit}>
        <label className="sr-only" htmlFor="analyst-question">
          Вопрос ИИ-аналитику
        </label>
        <textarea
          ref={input}
          id="analyst-question"
          value={draft}
          maxLength={4000}
          rows={3}
          placeholder="Спросите о клиентах, переводах или группах…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              if (draft.trim()) void send({ text: draft.trim(), selectedGid });
            }
          }}
        />
        <div className="assistant-compose-actions">
          <span>
            {draft.length > 3000
              ? `${draft.length} / 4000`
              : 'Enter — отправить'}
          </span>
          {busy ? (
            <button type="button" className="button" onClick={cancel}>
              Остановить
            </button>
          ) : (
            <button
              className="button button-primary"
              type="submit"
              disabled={!draft.trim() || !status.data?.configured}
            >
              Отправить ↑
            </button>
          )}
        </div>
        <p className="assistant-footnote">
          Для ответа OpenAI получает ваш вопрос и необходимые данные анализа.
          Выводы ИИ требуют проверки.
        </p>
      </form>
    </aside>
  );
}
