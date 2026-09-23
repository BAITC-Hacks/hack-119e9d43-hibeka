import type { Role } from '../types/api';

export const roleLabels: Record<Role, string> = {
  consolidator: 'Сбор средств',
  transit: 'Транзит',
  distributor: 'Распределение средств',
  terminal: 'Возможный конечный получатель',
  coordinator: 'Связующий узел',
  peripheral: 'Недостаточно признаков',
};
