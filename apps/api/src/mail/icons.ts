/**
 * The line icons of the e-mails and the contract PDF (24 × 24, stroke 2, round caps), in the style of
 * the app's icons (`apps/mobile/src/components/icons.tsx`; car, card, phone, help, check, mail, globe
 * and shieldCheck are copied from there). E-mails show them as hosted PNGs rendered by
 * `scripts/email-assets.ts` into `apps/web/public/email/icons/<name>.png`; the PDF draws the paths.
 * No brand logos of third parties (Apple, Google): their trademark rules forbid casual use.
 */
export const MAIL_ICONS = {
  layers: 'M12 3 2 8l10 5 10-5-10-5Z M2 12.5l10 5 10-5 M2 17l10 5 10-5',
  tag: 'M3 12V3h9l9 9-9 9-9-9Z M7.5 7.5h.01',
  car: 'M5 17h14v-5l-2-5H7l-2 5v5Z M5 12h14 M7.5 17v2 M16.5 17v2 M8 14.5h.01 M16 14.5h.01',
  calendar: 'M4 5h16v16H4z M4 10h16 M8 3v4 M16 3v4',
  refresh: 'M20 11a8 8 0 0 0-14.3-4.9L4 8 M4 3v5h5 M4 13a8 8 0 0 0 14.3 4.9L20 16 M20 21v-5h-5',
  hash: 'M5 9h14 M5 15h14 M10 3 8 21 M16 3l-2 18',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z M4 21a8 8 0 0 1 16 0',
  card: 'M2 5h20v14H2z M2 10h20 M6 15h4',
  phone: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M11 18h2',
  file: 'M14 3H6v18h12V7l-4-4Z M14 3v4h4 M9 13h6 M9 17h6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 11v6 M12 7.5h.01',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3 M12 17h.01',
  shieldCheck: 'M12 3 4 6v6c0 4.6 3.2 8.4 8 9.6 4.8-1.2 8-5 8-9.6V6l-8-3Z M8.5 12l2.5 2.5 4.5-5',
  check: 'M5 12.5 10 17 19 7',
  gift: 'M3 9h18v4H3z M5 13h14v8H5z M12 9v12 M12 9S10 4 7.5 5.5 9 9 12 9Z M12 9s2-5 4.5-3.5S15 9 12 9Z',
  building: 'M4 21V3h11v18 M15 9h5v12 M8 7h3 M8 11h3 M8 15h3 M2 21h20',
  scale: 'M12 3v18 M7 21h10 M5 7h14 M5 7l-3 7a3 3 0 0 0 6 0L5 7Z M19 7l-3 7a3 3 0 0 0 6 0l-3-7Z',
  pen: 'M4 20h4L19 9l-4-4L4 16v4Z M14 6l4 4',
  mail: 'M3 6h18v12H3z M3 7l9 6 9-6',
  globe:
    'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20',
} as const;

export type MailIcon = keyof typeof MAIL_ICONS;
