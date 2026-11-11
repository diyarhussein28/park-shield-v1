/** Short texts for push notifications (lock screen). Kept here because they must stay tiny. */
const texts = {
  de: {
    alert: (type: string, nickname: string) => ({
      title: `${type}: ${nickname}`,
      body: 'Jemand hat Ihren ParkShield-Aufkleber gescannt.',
    }),
    test: (_type: string, nickname: string) => ({
      title: `Test erfolgreich: ${nickname}`,
      body: 'So kommen Warnungen bei Ihnen an.',
    }),
    followup: (type: string, nickname: string) => ({
      title: `Erinnerung: ${nickname}`,
      body: `Die Person wartet noch (${type}).`,
    }),
  },
  en: {
    alert: (type: string, nickname: string) => ({
      title: `${type}: ${nickname}`,
      body: 'Someone scanned your ParkShield decal.',
    }),
    test: (_type: string, nickname: string) => ({
      title: `Test successful: ${nickname}`,
      body: 'This is how alerts reach you.',
    }),
    followup: (type: string, nickname: string) => ({
      title: `Reminder: ${nickname}`,
      body: `The person is still waiting (${type}).`,
    }),
  },
};

export type PushKind = keyof (typeof texts)['de'];

/** Quick-reply labels for push actions and e-mail buttons (OW-16). WhatsApp uses its approved template. */
export const REPLY_LABELS = {
  de: { coming: 'Ich komme', in_30_min: 'In ca. 30 Min', not_nearby: 'Bin nicht in der Nähe' },
  en: { coming: 'I’m coming', in_30_min: 'In about 30 min', not_nearby: 'I’m not nearby' },
} as const;

export const REPLY_SENT = { de: 'Antwort gesendet', en: 'Reply sent' } as const;

export function pushText(lang: 'de' | 'en', kind: PushKind, type: string, nickname: string) {
  return texts[lang][kind](type, nickname);
}
