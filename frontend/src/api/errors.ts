export class ApiRequestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Не удалось получить данные. Повторите запрос.';
}
