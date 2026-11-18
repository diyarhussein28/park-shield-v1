import type { MessageKey, Translate } from '@parkshield/i18n';

type Group =
  | 'role'
  | 'perm'
  | 'user'
  | 'sub'
  | 'plan'
  | 'alert'
  | 'type'
  | 'token'
  | 'delivery'
  | 'channel'
  | 'severity'
  | 'order'
  | 'dsr'
  | 'dsrStatus'
  | 'refund'
  | 'refundStatus'
  | 'recipient'
  | 'letter';

/**
 * German (or English) label for a status or code from the API, so staff never read raw values like
 * "past_due". Unknown codes fall back to the code itself instead of a broken key.
 */
export function label(t: Translate, group: Group, code: string | null | undefined): string {
  if (!code) return '–';
  const key = `opsLabels.${group}_${code.replace(/\./g, '_')}` as MessageKey;
  const text = t(key);
  return text === key ? code : text;
}
