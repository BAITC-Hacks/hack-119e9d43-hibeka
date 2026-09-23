export function isValidGid(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,19}$/.test(value);
}
