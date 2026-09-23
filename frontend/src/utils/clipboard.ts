import { isValidGid } from './gid.ts';

export async function copyGid(
  gid: string,
  clipboard: Pick<Clipboard, 'writeText'> | undefined,
): Promise<void> {
  if (!isValidGid(gid)) throw new Error('Нет корректного gid для копирования.');
  if (!clipboard)
    throw new Error(
      'Буфер обмена недоступен. Выделите и скопируйте gid вручную.',
    );
  try {
    await clipboard.writeText(gid);
  } catch {
    throw new Error(
      'Не удалось скопировать. Разрешите доступ к буферу или скопируйте gid вручную.',
    );
  }
}
