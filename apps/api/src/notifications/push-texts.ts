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

/**
 * Abuse protection §4: in Protected Mode a notification never carries the free text (or photos) of an
 * unconfirmed sender, only this hint. Shared by push, SMS (GSM-7 safe) and the e-mail template.
 */
export const HIDDEN_CONTENT_HINT = {
  de: 'Nachricht von nicht bestätigtem Absender – ansehen in ParkShield',
  en: 'Message from an unconfirmed sender – view it in ParkShield',
} as const;

export function pushText(
  lang: 'de' | 'en',
  kind: PushKind,
  type: string,
  nickname: string,
  hiddenContent = false,
) {
  const t = texts[lang][kind](type, nickname);
  return hiddenContent && kind === 'alert'
    ? { ...t, body: `${t.body} ${HIDDEN_CONTENT_HINT[lang]}.` }
    : t;
}
