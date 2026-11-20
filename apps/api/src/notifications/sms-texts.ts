/**
 * SMS texts (NT-07). Kept short and in the GSM-7 alphabet (no typographic quotes or apostrophes) so a
 * message usually fits one or two segments. SMS has no buttons: the link opens the reply page with the
 * three answers (OW-16).
 */
type Kind = 'alert' | 'test' | 'followup';

const texts = {
  de: {
    alert: (type: string, nickname: string, url: string) =>
      `ParkShield: ${type} (${nickname}). Bitte antworten: ${url}`,
    test: (_type: string, nickname: string, url: string) =>
      `ParkShield: Test erfolgreich (${nickname}). So kommen Warnungen per SMS an. ${url}`,
    followup: (type: string, nickname: string, url: string) =>
      `ParkShield: Erinnerung, die Person wartet noch (${type}, ${nickname}). ${url}`,
    otp: (code: string) =>
      `Ihr ParkShield-Code: ${code}. Gültig 10 Minuten. Geben Sie ihn nicht weiter.`,
    linked: () =>
      'ParkShield: SMS-Benachrichtigungen sind eingerichtet. Abmelden jederzeit im Konto.',
  },
  en: {
    alert: (type: string, nickname: string, url: string) =>
      `ParkShield: ${type} (${nickname}). Please reply: ${url}`,
    test: (_type: string, nickname: string, url: string) =>
      `ParkShield: Test successful (${nickname}). This is how alerts arrive by SMS. ${url}`,
    followup: (type: string, nickname: string, url: string) =>
      `ParkShield: Reminder, the person is still waiting (${type}, ${nickname}). ${url}`,
    otp: (code: string) => `Your ParkShield code: ${code}. Valid for 10 minutes. Do not share it.`,
    linked: () =>
      'ParkShield: SMS notifications are set up. Turn them off any time in your account.',
  },
} as const;

/** Removes line breaks and characters outside the basic range a nickname could bring in. */
const clean = (s: string) =>
  s
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[“”„]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim()
    .slice(0, 40);

const HIDDEN = {
  de: 'Nachricht von nicht bestaetigtem Absender - ansehen in ParkShield.',
  en: 'Message from an unconfirmed sender - view it in ParkShield.',
} as const;

export function smsText(
  lang: 'de' | 'en',
  kind: Kind,
  type: string,
  nickname: string,
  url: string,
  hiddenContent = false,
) {
  const text = texts[lang][kind](clean(type), clean(nickname), url);
  // Abuse protection §4: never the free text of an unconfirmed sender, only that there is one.
  return hiddenContent && kind === 'alert' ? `${text} ${HIDDEN[lang]}` : text;
}

/**
 * OTP text. With a public https origin, the last line follows the WebOTP format
 * (`@host #code`) so Android and iOS offer the code for autofill on that site only.
 */
export function smsOtpText(lang: 'de' | 'en', code: string, webBaseUrl: string) {
  const url = new URL(webBaseUrl);
  const origin = url.protocol === 'https:' ? `\n\n@${url.host} #${code}` : '';
  return `${texts[lang].otp(code)}${origin}`;
}

export const smsLinkedText = (lang: 'de' | 'en') => texts[lang].linked();

// --- Phase 2: alerts with photos, one SMS segment ------------------------------------------------

/** One GSM-7 segment. Longer texts are split and billed per segment (and some carriers mangle them). */
export const SMS_SEGMENT_MAX = 160;

/** The GSM 03.38 basic character set, without the escape table (^{}[]~|€\ cost two characters). */
const GSM7_BASIC =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà';
const GSM7 = new Set(GSM7_BASIC);
const UMLAUTS: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
};

/**
 * Plain GSM-7 text: umlauts transliterated (ä→ae …, safer on every handset and carrier), typographic
 * quotes and dashes mapped, line breaks to spaces, everything else outside the basic set removed.
 */
export function toGsm7(s: string): string {
  return [
    ...s
      .replace(/[äöüßÄÖÜ]/g, (c) => UMLAUTS[c]!)
      .replace(/[“”„«»]/g, '"')
      .replace(/[‘’‚]/g, "'")
      .replace(/[–—]/g, '-')
      .replace(/[\r\n\t]+/g, ' '),
  ]
    .filter((c) => GSM7.has(c))
    .join('')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export const isGsm7 = (s: string) => [...s].every((c) => GSM7.has(c));

/**
 * Every SMS with a link is one GSM-7 segment: `<lead>: <subject> (<label>). <link text>: <host>/<path>`.
 * The kinds below are all SMS the tiered notifications send (owner and emergency contacts).
 * - alert/reminder/followup/test: to the owner, link to the view page /v/<token> (details, photos,
 *   "Ich komme"). No photo, ever.
 * - escalation: to a confirmed emergency contact, link to /k/<token> ("Ich komme", opt-out). Only the
 *   alert type and the vehicle label the owner chose: no plate, no scanner text, no photo.
 * - invite: to a new emergency contact, link to the invitation (accept / decline).
 */
export type LinkSmsKind =
  'alert' | 'photos' | 'reminder' | 'followup' | 'test' | 'escalation' | 'invite';

const LINK_TEXTS = {
  de: {
    alert: { lead: 'ParkShield', link: 'Details' },
    photos: { lead: 'ParkShield', link: 'Fotos & Antwort' },
    reminder: { lead: 'ParkShield Erinnerung', link: 'Details' },
    followup: { lead: 'ParkShield Erinnerung, die Person wartet noch', link: 'Details' },
    test: { lead: 'ParkShield Test erfolgreich', link: 'Details' },
    escalation: { lead: 'ParkShield Vertrauensperson', link: 'Ich komme / Abmelden' },
    invite: { lead: 'ParkShield', link: 'Annehmen/Ablehnen' },
  },
  en: {
    alert: { lead: 'ParkShield', link: 'Details' },
    photos: { lead: 'ParkShield', link: 'Photos & reply' },
    reminder: { lead: 'ParkShield reminder', link: 'Details' },
    followup: { lead: 'ParkShield reminder, the person is still waiting', link: 'Details' },
    test: { lead: 'ParkShield test successful', link: 'Details' },
    escalation: { lead: 'ParkShield trusted contact', link: 'I am coming / Opt out' },
    invite: { lead: 'ParkShield', link: 'Accept/decline' },
  },
} as const;

/**
 * One GSM-7 segment, at most 160 characters including the link. The label (vehicle nickname) is dropped
 * first, then the subject shortened; if even "<lead>: <link text>: <link>" does not fit (a much longer
 * domain), it throws, so a template that cannot work fails in tests, not at runtime.
 */
export function smsLinkText(
  lang: 'de' | 'en',
  kind: LinkSmsKind,
  subject: string,
  label: string,
  url: string,
): string {
  const t = LINK_TEXTS[lang][kind];
  // "https://" costs 8 characters; phones link a bare domain with a path just as well.
  const link = toGsm7(url.replace(/^https:\/\//, ''));
  const tail = ` ${t.link}: ${link}`;
  const lead = toGsm7(t.lead);
  const cleanSubject = toGsm7(subject).slice(0, 80);
  const cleanLabel = toGsm7(label).slice(0, 40);
  const candidates = [
    cleanLabel ? `${lead}: ${cleanSubject} (${cleanLabel}).${tail}` : null,
    `${lead}: ${cleanSubject}.${tail}`,
  ].filter((c): c is string => c !== null);
  for (const c of candidates) if (c.length <= SMS_SEGMENT_MAX) return c;
  const room = SMS_SEGMENT_MAX - `${lead}: .${tail}`.length;
  if (room >= 8) return `${lead}: ${cleanSubject.slice(0, room).trimEnd()}.${tail}`;
  const minimal = `${lead}:${tail}`;
  if (minimal.length > SMS_SEGMENT_MAX) {
    throw new Error(`SMS does not fit one segment (${minimal.length} characters)`);
  }
  return minimal;
}

/** SMS for an alert with photos (kept for callers of the Phase 2 photo feature). */
export const smsPhotoText = (lang: 'de' | 'en', type: string, nickname: string, viewUrl: string) =>
  smsLinkText(lang, 'photos', type, nickname, viewUrl);

/** Invitation SMS to a new emergency contact: "<Vorname> moechte Sie als Vertrauensperson ...". */
export function smsInviteText(lang: 'de' | 'en', ownerFirstName: string, url: string): string {
  const owner = toGsm7(ownerFirstName).slice(0, 20) || (lang === 'de' ? 'Jemand' : 'Someone');
  const subject =
    lang === 'de'
      ? `${owner} moechte Sie als Vertrauensperson hinterlegen`
      : `${owner} would like you as a trusted contact`;
  return smsLinkText(lang, 'invite', subject, '', url);
}
