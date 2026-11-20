import { t } from './i18n';

/** „vor 2 Min.“: how long ago an alert came in, for the urgent cards (P1). */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return t('agoNow');
  if (minutes < 60) return t('agoMinutes', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('agoHours', { count: hours });
  return t('agoDays', { count: Math.floor(hours / 24) });
}
