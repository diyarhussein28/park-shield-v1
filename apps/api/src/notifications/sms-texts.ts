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

export function smsText(
  lang: 'de' | 'en',
  kind: Kind,
  type: string,
  nickname: string,
  url: string,
) {
  return texts[lang][kind](clean(type), clean(nickname), url);
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
