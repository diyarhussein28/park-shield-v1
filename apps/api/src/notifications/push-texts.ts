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
    reminder: (type: string, nickname: string) => ({
      title: `Erinnerung: ${type}`,
      body: `Bitte reagieren Sie (${nickname}).`,
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
    reminder: (type: string, nickname: string) => ({
      title: `Reminder: ${type}`,
      body: `Please respond (${nickname}).`,
    }),
  },
};

/**
 * Native app push (FCM is a Google service): a generic title and the alert type only. Never the
 * scanner's message, a photo, the licence plate, the vehicle nickname or any name. The app loads the
 * details from our API after opening.
 */
const APP_TEXTS = {
  de: {
    alert: () => 'Neue Warnung zu Ihrem Fahrzeug. Tippen Sie für Details.',
    test: () => 'Testwarnung angekommen. So erreichen Sie Warnungen.',
    reminder: () => 'Erinnerung: Eine Warnung wartet auf Ihre Reaktion.',
    followup: () => 'Die Person am Fahrzeug wartet noch auf Sie.',
    chat: () => 'Neue Nachricht im Chat zu Ihrer Warnung.',
  },
  en: {
    alert: () => 'New alert for your vehicle. Tap for details.',
    test: () => 'Test alert received. This is how alerts reach you.',
    reminder: () => 'Reminder: an alert is waiting for your reaction.',
    followup: () => 'The person at the vehicle is still waiting for you.',
    chat: () => 'New message in the chat about your alert.',
  },
} as const;

export type AppPushKind = keyof (typeof APP_TEXTS)['de'];

/**
 * Generic text only (owner decision 2026-11-21): not even the alert type. The payload's data carries the
 * alert id and the kind of message (for routing in the app), nothing else.
 */
export function appPushText(lang: 'de' | 'en', kind: AppPushKind, _type = '') {
  return { title: 'ParkShield', body: APP_TEXTS[lang][kind]() };
}

/** iOS notification category (Android click action) with the "Ich komme" action button. */
export const APP_ALERT_CATEGORY = 'PS_ALERT';

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
