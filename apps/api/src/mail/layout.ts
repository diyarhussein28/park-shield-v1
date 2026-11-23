import { COMPANY } from '@parkshield/shared';
import type { MailIcon } from './icons';
import type { MailLocale } from './templates';

/**
 * The one ParkShield e-mail layout (design 2026-11-22): blue header with the shield, „ParkShield“ and
 * the tagline; a white body with headline, text, at most one primary blue button and an optional
 * highlighted box (e.g. the sign-in code with „Gültig für 15 Minuten“); „Hilfe benötigt?“; a footer
 * with logo, tagline, „Hosted in Germany“, the website, links to the help centre and the legal pages,
 * and the company name, address and USt-IdNr. from the company settings; then the „do not reply“ line.
 *
 * Built once, by hand, as table-based HTML with inline styles (what Gmail, Apple Mail and Outlook all
 * render), plus a plain-text part. MJML was considered: its html-minifier dependency has an open
 * advisory that fails `npm audit` in CI. Dark mode: `color-scheme` meta and a `prefers-color-scheme`
 * block for clients that support it; the rest keep the light design, which stays readable.
 *
 * Privacy: the only image is our own hosted logo; no tracking pixel, no tracking parameters, no
 * external fonts (Mailjet open and click tracking are off for every message, see providers/mailer.ts).
 */

export interface MailFrame {
  /** The public website (logo, help centre and legal links). */
  webBaseUrl: string;
  company: {
    name: string;
    street: string;
    postalCode: string;
    city: string;
    country: string;
    /** Support address in the footer. */
    email?: string;
    /** USt-IdNr., shown after the address when set. */
    vatId?: string;
  };
}

export const DEFAULT_FRAME: MailFrame = {
  webBaseUrl: 'https://park-shield.de',
  company: COMPANY,
};

/**
 * Shared building blocks (2026-11-23 redesign): a details table (icon, label, value per row) and an
 * info card (icon, title, text). Every e-mail may use them; rows and cards with an empty value or text
 * are left out, so optional data never leaves an empty line.
 */
export type MailBlock =
  | {
      kind: 'details';
      title?: string;
      rows: { icon?: MailIcon; label: string; value: string }[];
    }
  | { kind: 'card'; icon?: MailIcon; title: string; text: string; tone?: 'soft' | 'plain' };

export interface MailBody {
  locale: MailLocale;
  subject: string;
  /** Success indicator above the headline (e.g. „Abo bestätigt“). */
  badge?: string;
  headline: string;
  lines: string[];
  highlight?: { value: string; note?: string };
  /** Quick replies (NT-02), shown as buttons; the first one primary when there is no action. */
  replies: { label: string; url: string }[];
  action?: { label: string; url: string };
  /** Details tables and info cards under the text. */
  blocks?: MailBlock[];
  /** Small grey text under the button (e.g. „Code und Link funktionieren nur einmal …“). */
  footnote?: string;
  /** Small text links under the button (e.g. „Missbrauch melden“). */
  links: { label: string; url: string }[];
  /**
   * Internal mails that are answered by replying (support requests, reply-to = the customer) leave out
   * the „Bitte antworten Sie nicht“ line. Default: shown.
   */
  replyable?: boolean;
}

const T = {
  de: {
    tagline: 'Smarter QR-Schutz für Ihr Fahrzeug',
    footerTagline:
      'Erreichbar bleiben, ohne Ihre Telefonnummer zu teilen. Smarter QR-Schutz für Ihr Fahrzeug.',
    hosted: 'Hosted in Germany',
    helpTitle: 'Hilfe benötigt?',
    helpText: (link: string) => `Besuchen Sie unser ${link} oder schreiben Sie unserem Support.`,
    helpCenter: 'Hilfe-Center',
    privacy: 'Datenschutz',
    terms: 'AGB',
    withdrawal: 'Widerrufsbelehrung',
    imprint: 'Impressum',
    vatId: 'USt-IdNr.',
    noReply:
      'Dies ist eine automatische Nachricht von ParkShield. Bitte antworten Sie nicht auf diese E-Mail.',
  },
  en: {
    tagline: 'Smart QR Protection for Your Vehicle',
    footerTagline:
      'Stay reachable without sharing your phone number. Smart QR protection for your vehicle.',
    hosted: 'Hosted in Germany',
    helpTitle: 'Need help?',
    helpText: (link: string) => `Visit our ${link} or contact our support team.`,
    helpCenter: 'Help Center',
    privacy: 'Privacy Policy',
    terms: 'Terms & Conditions',
    withdrawal: 'Withdrawal policy',
    imprint: 'Legal notice',
    vatId: 'VAT ID',
    noReply: 'This is an automated message from ParkShield. Please do not reply to this e-mail.',
  },
} as const;

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BLUE = '#1d4ed8';
const NAVY = '#0b2a6b';
const INK = '#0f172a';
const MUTED = '#475569';
const SOFT = '#eef4ff';

const base = (url: string) => url.replace(/\/+$/, '');

function button(a: { label: string; url: string }, primary: boolean) {
  const bg = primary ? BLUE : '#e2e8f0';
  const fg = primary ? '#ffffff' : INK;
  // Bulletproof button: a table cell with the colour (Outlook) and a padded link (everyone else).
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 10px auto"><tr><td bgcolor="${bg}" style="border-radius:10px;background:${bg}" class="${primary ? 'ps-btn' : 'ps-btn2'}"><a href="${escapeHtml(a.url)}" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:17px;font-weight:700;line-height:1.2;color:${fg};text-decoration:none;border-radius:10px">${escapeHtml(a.label)}${primary ? ' &rarr;' : ''}</a></td></tr></table>`;
}

const para = (s: string, style = '') =>
  `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.55;color:${INK};${style}" class="ps-text">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;

const PANEL = '#f5f8ff';
const RULE = '#e2e8f0';
const icon = (web: string, name: string, size: number) =>
  `<img src="${escapeHtml(`${web}/email/icons/${name}.png`)}" width="${size}" height="${size}" alt="" style="display:block;border:0;width:${size}px;height:${size}px">`;

function badge(web: string, label: string) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0"><tr><td valign="middle" style="padding-right:10px">${icon(web, 'success', 28)}</td><td valign="middle" bgcolor="#e8f7ee" class="ps-badge" style="background:#e8f7ee;border-radius:999px;padding:6px 14px;font-family:${FONT};font-size:15px;font-weight:700;line-height:1.3;color:#166534">${escapeHtml(label)}</td></tr></table>`;
}

function details(web: string, b: Extract<MailBlock, { kind: 'details' }>) {
  const rows = b.rows.filter((r) => r.value.trim() !== '');
  if (!rows.length) return '';
  const tr = rows
    .map(
      (r, i) =>
        `<tr><td valign="top" width="28" style="padding:10px 10px 10px 0;${i ? `border-top:1px solid ${RULE};` : ''}" class="ps-rule">${r.icon ? icon(web, r.icon, 20) : ''}</td><td valign="top" width="38%" class="ps-text ps-rule" style="padding:10px 12px 10px 0;${i ? `border-top:1px solid ${RULE};` : ''}font-family:${FONT};font-size:15px;line-height:1.4;font-weight:700;color:${INK}">${escapeHtml(r.label)}</td><td valign="top" class="ps-text ps-rule" style="padding:10px 0;${i ? `border-top:1px solid ${RULE};` : ''}font-family:${FONT};font-size:15px;line-height:1.4;color:${INK};overflow-wrap:anywhere;word-break:break-word">${escapeHtml(r.value).replace(/\n/g, '<br>')}</td></tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 16px 0"><tr><td bgcolor="${PANEL}" class="ps-panel" style="background:${PANEL};border-radius:14px;padding:18px 20px">${
    b.title
      ? `<div class="ps-h1" style="font-family:${FONT};font-size:18px;line-height:1.3;font-weight:800;color:${INK};padding-bottom:6px">${escapeHtml(b.title)}</div>`
      : ''
  }<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${tr}</table></td></tr></table>`;
}

function card(web: string, b: Extract<MailBlock, { kind: 'card' }>) {
  if (b.text.trim() === '') return '';
  const soft = b.tone !== 'plain';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px 0"><tr><td ${soft ? `bgcolor="${PANEL}" class="ps-panel" ` : ''}style="${soft ? `background:${PANEL};` : ''}border-radius:14px;padding:${soft ? '16px 20px' : '4px 0'}"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${
    b.icon
      ? `<td valign="top" width="40" style="padding:2px 14px 0 0"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" valign="middle" width="40" height="40" bgcolor="#e4edff" class="ps-box" style="background:#e4edff;border-radius:20px;width:40px;height:40px">${icon(web, b.icon, 20)}</td></tr></table></td>`
      : ''
  }<td valign="top"><div class="ps-h1" style="font-family:${FONT};font-size:17px;line-height:1.35;font-weight:800;color:${INK};padding-bottom:4px">${escapeHtml(b.title)}</div><div class="ps-muted" style="font-family:${FONT};font-size:15px;line-height:1.55;color:${MUTED}">${escapeHtml(b.text).replace(/\n/g, '<br>')}</div></td></tr></table></td></tr></table>`;
}

const blockText = (b: MailBlock) =>
  b.kind === 'details'
    ? [
        ...(b.title ? [b.title] : []),
        ...b.rows.filter((r) => r.value.trim() !== '').map((r) => `${r.label}: ${r.value}`),
      ].join('\n')
    : b.text.trim() === ''
      ? ''
      : `${b.title}\n${b.text}`;

export function renderLayout(body: MailBody, frame: MailFrame = DEFAULT_FRAME) {
  const t = T[body.locale];
  const web = base(frame.webBaseUrl);
  // The app's mark (shield with the QR finder pattern); on a white tile in the blue header.
  const logo = `${web}/email/parkshield-logo.png`;
  const logoTile = `${web}/email/parkshield-logo-tile.png`;
  const helpUrl = `${web}/hilfe`;
  const legal = [
    { label: t.helpCenter, url: helpUrl },
    { label: t.privacy, url: `${web}/datenschutz` },
    { label: t.terms, url: `${web}/agb` },
    { label: t.imprint, url: `${web}/impressum` },
    { label: t.withdrawal, url: `${web}/widerruf` },
  ];
  const blocks = (body.blocks ?? [])
    .map((b) => (b.kind === 'details' ? details(web, b) : card(web, b)))
    .join('\n  ');
  const c = frame.company;
  const vat = c.vatId?.trim();
  const address = `${c.name} · ${c.street} · ${c.postalCode} ${c.city}${c.country && c.country !== 'DE' ? ` · ${c.country}` : ''}${vat ? ` · ${t.vatId} ${vat}` : ''}`;
  const site = web.replace(/^https?:\/\//, '');
  const replies = body.replies.map((r, i) => button(r, i === 0 && !body.action)).join('');

  const html = `<!doctype html>
<html lang="${body.locale}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(body.subject)}</title>
<style>
  @media (max-width:620px){ .ps-outer{padding:16px 8px!important} .ps-pad{padding-left:20px!important;padding-right:20px!important} .ps-col{display:block!important;width:100%!important} .ps-code{font-size:34px!important;letter-spacing:6px!important} }
  @media (prefers-color-scheme:dark){
    .ps-page{background:#0b1220!important} .ps-card{background:#111a2e!important} .ps-text,.ps-h1{color:#e2e8f0!important}
    .ps-muted{color:#94a3b8!important} .ps-box{background:#172554!important} .ps-code{color:#ffffff!important}
    .ps-foot{background:#0f1b33!important} .ps-panel{background:#16213a!important} .ps-badge{background:#14532d!important;color:#dcfce7!important} .ps-link{color:#93c5fd!important} .ps-rule{border-color:#1e293b!important}
  }
  [data-ogsc] .ps-text,[data-ogsc] .ps-h1{color:#e2e8f0!important}
</style>
</head>
<body style="margin:0;padding:0;background:#f1f5f9" class="ps-page">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(body.lines[0] ?? body.headline)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f1f5f9" class="ps-page" style="background:#f1f5f9">
<tr><td align="center" class="ps-outer" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" class="ps-card" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden">
<tr><td bgcolor="${BLUE}" class="ps-pad" style="padding:28px 36px;background:${BLUE};background-image:linear-gradient(120deg,${NAVY} 0%,${NAVY} 45%,${BLUE} 100%)">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
    <td valign="middle" style="padding-right:14px"><img src="${escapeHtml(logoTile)}" width="48" height="48" alt="" style="display:block;border:0;width:48px;height:48px;border-radius:12px"></td>
    <td valign="middle">
      <div style="font-family:${FONT};font-size:28px;line-height:1.1;font-weight:800;color:#ffffff">Park<span style="color:#93c5fd">Shield</span></div>
      <div style="font-family:${FONT};font-size:15px;line-height:1.4;color:#dbeafe;padding-top:4px">${escapeHtml(t.tagline)}</div>
    </td>
  </tr></table>
</td></tr>
<tr><td class="ps-pad" style="padding:32px 36px 8px 36px">
  ${body.badge ? badge(web, body.badge) : ''}
  <h1 class="ps-h1" style="margin:0 0 16px 0;font-family:${FONT};font-size:26px;line-height:1.25;font-weight:800;color:${INK}">${escapeHtml(body.headline)}</h1>
  ${body.lines.map((l) => para(l)).join('\n  ')}
  ${
    body.highlight
      ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:8px auto 20px auto"><tr><td align="center" bgcolor="${SOFT}" class="ps-box" style="background:${SOFT};border-radius:14px;padding:18px 40px"><div class="ps-code" style="font-family:${FONT};font-size:42px;line-height:1.1;font-weight:800;letter-spacing:8px;color:${INK}">${escapeHtml(body.highlight.value)}</div>${
          body.highlight.note
            ? `<div class="ps-muted" style="font-family:${FONT};font-size:15px;line-height:1.4;color:${MUTED};padding-top:8px">&#9719; ${escapeHtml(body.highlight.note)}</div>`
            : ''
        }</td></tr></table>`
      : ''
  }
  ${blocks}
  ${replies}
  ${body.action ? button(body.action, true) : ''}
  ${body.footnote ? para(body.footnote, `font-size:14px;color:${MUTED};text-align:center`) : ''}
  ${
    body.links.length
      ? `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:14px;text-align:center">${body.links
          .map(
            (l) =>
              `<a href="${escapeHtml(l.url)}" class="ps-link" style="color:${MUTED}">${escapeHtml(l.label)}</a>`,
          )
          .join(' &middot; ')}</p>`
      : ''
  }
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="top" width="30" class="ps-rule" style="border-top:1px solid #e2e8f0;padding:18px 10px 24px 0">${icon(web, 'help', 22)}</td><td class="ps-rule ps-text" style="border-top:1px solid #e2e8f0;padding:18px 0 24px 0;font-family:${FONT};font-size:15px;line-height:1.5;color:${INK}">
    <strong>${escapeHtml(t.helpTitle)}</strong> ${t.helpText(`<a href="${escapeHtml(helpUrl)}" class="ps-link" style="color:${BLUE}">${escapeHtml(t.helpCenter)}</a>`)}
  </td></tr></table>
</td></tr>
<tr><td bgcolor="${SOFT}" class="ps-foot ps-pad" style="background:${SOFT};padding:24px 36px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td class="ps-col" valign="top" width="62%" style="padding:0 16px 12px 0">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="padding-right:10px"><img src="${escapeHtml(logo)}" width="28" height="28" alt="" style="display:block;border:0;width:28px;height:28px"></td>
        <td valign="middle" style="font-family:${FONT};font-size:20px;font-weight:800;color:${INK}" class="ps-text">Park<span style="color:${BLUE}" class="ps-link">Shield</span></td>
      </tr></table>
      <p class="ps-muted" style="margin:10px 0 8px 0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED}">${escapeHtml(t.footerTagline)}</p>
      <p class="ps-muted" style="margin:0;font-family:${FONT};font-size:14px;line-height:1.5;color:${MUTED};overflow-wrap:anywhere;word-break:break-word">&#128274; ${escapeHtml(t.hosted)} &nbsp;|&nbsp; <a href="${escapeHtml(web)}" class="ps-link" style="color:${MUTED}">${escapeHtml(site)}</a>${
        c.email
          ? ` &nbsp;|&nbsp; <a href="mailto:${escapeHtml(c.email)}" class="ps-link" style="color:${MUTED}">${escapeHtml(c.email)}</a>`
          : ''
      }</p>
    </td>
    <td class="ps-col" valign="top" width="38%" style="padding:0 0 12px 0">
      ${legal
        .map(
          (l) =>
            `<p style="margin:0 0 8px 0;font-family:${FONT};font-size:14px;line-height:1.4"><a href="${escapeHtml(l.url)}" class="ps-link" style="color:${INK}">${escapeHtml(l.label)}</a></p>`,
        )
        .join('')}
    </td>
  </tr></table>
  <p class="ps-muted" style="margin:8px 0 0 0;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">${escapeHtml(address)}</p>
</td></tr>
${body.replyable ? '' : `<tr><td align="center" class="ps-pad ps-muted" style="padding:16px 36px 20px 36px;font-family:${FONT};font-size:13px;line-height:1.5;color:${MUTED}">${escapeHtml(t.noReply)}</td></tr>`}
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    ...(body.badge ? [`✓ ${body.badge}`] : []),
    body.headline,
    ...body.lines,
    ...(body.highlight
      ? [[body.highlight.value, body.highlight.note].filter(Boolean).join('\n')]
      : []),
    ...(body.blocks ?? []).map(blockText).filter((b) => b !== ''),
    ...body.replies.map((r) => `${r.label}: ${r.url}`),
    ...(body.action ? [`${body.action.label}: ${body.action.url}`] : []),
    ...(body.footnote ? [body.footnote] : []),
    ...body.links.map((l) => `${l.label}: ${l.url}`),
    `${t.helpTitle} ${t.helpCenter}: ${helpUrl}`,
    '— ParkShield · ' + t.footerTagline,
    `${t.hosted} · ${web}${c.email ? ` · ${c.email}` : ''}`,
    legal
      .slice(1)
      .map((l) => `${l.label}: ${l.url}`)
      .join('\n'),
    address,
    ...(body.replyable ? [] : [t.noReply]),
  ].join('\n\n');

  return { html, text };
}
