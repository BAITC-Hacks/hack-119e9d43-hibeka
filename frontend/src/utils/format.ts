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

export const formatInteger = (value: number) => integerFormat.format(value);
export const formatMoney = (value: number) =>
  `${moneyFormat.format(value)} KZT`;
export const formatDuration = (value: number) =>
  `${decimalFormat.format(value)} с`;
export const formatScore = (value: number) =>
  `${scoreFormat.format(value * 100)} / 100`;
export function formatDate(value: string | null): string {
  if (value === null) return 'Нет данных';
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? 'Нет данных' : dateFormat.format(date);
}
