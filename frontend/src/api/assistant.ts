export interface AssistantStatus {
  configured: boolean;
  model: string;
}
export interface ChatSource {
  id: string;
  title: string;
  client_ids: string[];
  preview: string;
}
export interface ChatAnswer {
  run_id: string;
  answer: string;
  model: string;
  sources: ChatSource[];
  client_ids: string[];
  limited: boolean;
  tool_calls: number;
}
export interface ChatHistory {
  role: 'user' | 'assistant';
  content: string;
}
async function read<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as {
    detail?: { message?: string } | string;
  } | null;
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(
      typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && detail.message
          ? detail.message
          : 'Не удалось получить ответ. Повторите запрос.',
    );
  }
  return body as T;
}
export async function assistantStatus(
  signal: AbortSignal,
): Promise<AssistantStatus> {
  return read<AssistantStatus>(
    await fetch('/api/assistant/status', { signal }),
  );
}
export async function askAssistant(
  runId: string,
  message: string,
  selectedGid: string | null,
  history: ChatHistory[],
  signal: AbortSignal,
): Promise<ChatAnswer> {
  const response = await fetch(
    `/api/runs/${encodeURIComponent(runId)}/assistant`,
    {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, selected_gid: selectedGid, history }),
    },
  );
  const data = await read<ChatAnswer>(response);
  if (data.run_id !== runId)
    throw new Error('Ответ относится к другому анализу. Начните новый чат.');
  return data;
}
