const integerFormat = new Intl.NumberFormat('ru-RU');
const moneyFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const decimalFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 2,
});
const scoreFormat = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 1,
});
const dateFormat = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'UTC',
});

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
export const formatInteger = (value: unknown) =>
  isNumber(value) ? integerFormat.format(value) : 'Нет данных';
export const formatMoney = (value: unknown) =>
  isNumber(value) ? `${moneyFormat.format(value)} KZT` : 'Нет данных';
export const formatDuration = (value: unknown) =>
  isNumber(value) ? `${decimalFormat.format(value)} с` : 'Нет данных';
export const formatScore = (value: unknown) =>
  isNumber(value) ? `${scoreFormat.format(value * 100)} / 100` : 'Нет данных';
export const formatDecimal = (value: unknown) =>
  isNumber(value) ? decimalFormat.format(value) : 'Нет данных';
export const formatText = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value : 'Нет данных';
export function formatDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return 'Нет данных';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? 'Нет данных'
    : dateFormat.format(date);
}
