import { createHash } from 'node:crypto';
import { messages, type Locale } from '@parkshield/i18n';
import { markSvgBody } from '../brand-mark';
import { frcEndpoint, frcHosts } from '../frc-hosts';
import { FRC_GLUE_JS, SCANNER_JS } from './client';
import { SCANNER_CSS } from './styles';

export interface ScanPageData {
  /** Protected Mode is on and a phone check is available (abuse protection §4). */
  offerVerification?: boolean;
  /** Phase 2: "Foto hinzufügen" (ALERT_PHOTOS_ENABLED and the owner's plan). */
  photos?: boolean;
  nickname: string;
  color: string | null;
  testMode: boolean;
  backAt: string | null;
  alertTypes: { code: string; severity: string; de: string; en: string }[];
}

type Strings = (typeof messages)['de']['scanner'];

const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
const CSS_HASH = hash(SCANNER_CSS);
const JS_HASH = hash(SCANNER_JS);
const GLUE_HASH = hash(FRC_GLUE_JS);

const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
/** JSON inside <script type="application/json">: "<" must never close the element. */
const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c');

export function scannerCsp(withCaptcha: boolean): string {
  return [
    "default-src 'none'",
    // 'self': the Socket.io client for the live chat (/scanner-assets, loaded after an alert is sent).
    `script-src ${JS_HASH} 'self'${withCaptcha ? ` ${GLUE_HASH}` : ''}`,
    `style-src ${CSS_HASH}`,
    // blob: for the photo thumbnails (Phase 2); the camera stream itself is not a fetched resource.
    "img-src 'self' data: blob:",
    `connect-src 'self'${withCaptcha ? ` ${frcHosts()}` : ''}`,
    ...(withCaptcha ? [`frame-src ${frcHosts()}`, 'worker-src blob:'] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

// Inline line icons (24 × 24, stroke = currentColor via CSS). No icon font, no image request.
const svg = (d: string) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${d}</svg>`;
const CAR =
  '<path d="M3 16v-3.5l2.2-4.9A2 2 0 0 1 7 6.5h10a2 2 0 0 1 1.8 1.1l2.2 4.9V16a1 1 0 0 1-1 1h-1M5 17H4a1 1 0 0 1-1-1m0-3.5h18M9 17h6"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>';
const I = {
  car: svg(CAR),
  lights: svg('<path d="M11 5C6.5 5 4 8.5 4 12s2.5 7 7 7z"/><path d="m15 8 5-1m-5 5h5m-5 4 5 1"/>'),
  window: svg('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v7m-3-3 3 3 3-3"/>'),
  damage: svg(`${CAR}<path d="m20 .5-2 2.5h3l-2 2.5"/>`),
  alarm: svg(
    '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zm4 4a2 2 0 0 0 4 0M2.5 8A9 9 0 0 1 5 3.5M21.5 8A9 9 0 0 0 19 3.5"/>',
  ),
  tow: svg(
    '<path d="M4 17H2v-4h10V8h5l3 4.5V17h-2M8 17h6M2 13l6-7v4.5a1 1 0 0 1-2 0"/><circle cx="6" cy="17" r="2"/><circle cx="16" cy="17" r="2"/>',
  ),
  alert: svg(
    '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4m0 4h.01"/>',
  ),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  chat: svg(
    '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/><circle cx="20" cy="5" r="2.5" class="acc"/>',
  ),
  image: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  ),
  shield: svg(
    '<path d="M12 2 4 5.5v6c0 5 3.5 9 8 10.5 4.5-1.5 8-5.5 8-10.5v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  ),
  send: svg('<path d="M21 3 10.5 13.5M21 3l-6.5 18-4-7.5L3 9.5z"/>'),
  flask: svg(
    '<path d="M9 3h6m-5 0v6l-5.5 9.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10"/>',
  ),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  out: svg('<path d="M7 17 17 7M8 7h9v9"/>'),
};
const TYPE_ICON: Record<string, string> = {
  blocking: I.car,
  lights_on: I.lights,
  window_open: I.window,
  damage: I.damage,
  alarm: I.alarm,
  towing_risk: I.tow,
};
const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false">${markSvgBody('lg')}</svg>`;

function shell(locale: Locale, title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#1d4ed8"><title>${esc(title)} · ParkShield</title>
<style>${SCANNER_CSS}</style>${extraHead}</head><body><div class="wrap">${body}</div></body></html>`;
}

function header(langs = ''): string {
  return `<header class="top"><span class="brand">${LOGO}<span>ParkShield</span></span>${langs}</header>`;
}

/** The authenticity notice (owner decision 9: „Nur echt auf park-shield.de“). */
function footer(label: (k: keyof Strings) => string): string {
  return `<footer><p class="trust">${I.shield}<span><b ${label('trustDomain')}</b><br><span ${label('trustPayment')}</span></span></p>
<p><a href="https://park-shield.de/"><span ${label('protectToo')}</span> ${I.out}</a></p></footer>`;
}

/** German emergency numbers in a text, as `tel:` links (the client does the same after a language switch). */
const telLinks = (html: string) => html.replace(/\b(11[02])\b/g, '<a href="tel:$1">$1</a>');

/** „In echter Gefahr: 110 … 112 …“ with both numbers tappable (`data-tt` = text with tel links). */
const emergencyRow = (s: Strings, attrs = '') =>
  `<p class="danger"${attrs}>${I.alert}<span data-tt="emergency">${telLinks(esc(s.emergency))}</span></p>`;

function simplePage(
  locale: Locale,
  titleKey: keyof Strings,
  inner: (label: (k: keyof Strings) => string) => string,
) {
  const s = messages[locale].scanner;
  const label = (k: keyof Strings) => `data-t="${k}">${esc(s[k])}`;
  return shell(
    locale,
    s[titleKey],
    `${header()}<main><h1 ${label(titleKey)}</h1>${inner(label)}${emergencyRow(s)}</main>${footer(label)}`,
  );
}

/** SC-07: reveals nothing about why (unknown, revoked, unpaid all look the same). */
export function renderInactive(locale: Locale): string {
  return simplePage(
    locale,
    'inactiveTitle',
    (label) => `<p class="muted" ${label('inactiveText')}</p>`,
  );
}

/**
 * AD-07: a pre-printed partner decal nobody has set up. The owner sets it up in the app (2026-11-24:
 * `/app/aktivieren` is a universal / app link; without the app its page offers the app); a stranger
 * learns that this decal cannot reach anyone yet. The code goes in the fragment, so no server log
 * ever sees it.
 */
export function renderUnclaimed(locale: Locale, code: string): string {
  return simplePage(
    locale,
    'unclaimedTitle',
    (label) => `<p class="muted" ${label('unclaimedText')}</p>
<p><a class="primary" href="/app/aktivieren#c=${encodeURIComponent(code)}" ${label('unclaimedButton')}</a></p>
<p class="note info inote">${I.info}<span ${label('unclaimedStranger')}</span></p>`,
  );
}

export function renderRateLimited(locale: Locale): string {
  return simplePage(locale, 'rateTitle', (label) => `<p class="muted" ${label('rateText')}</p>`);
}

/**
 * Phase 2 alert photos. The notice must be confirmed before the camera opens (TODO [LEGAL REVIEW]: the
 * notice and the privacy link target, LEGAL_REVIEW.md §5). The two slots („+ Foto 1/2 hinzufügen“)
 * are rendered by the client (phRender).
 */
function photoBox(label: (k: keyof Strings) => string): string {
  return `<section id="ph" aria-labelledby="ph-h">
<h2 id="ph-h" class="h-ic">${I.image}<span ${label('photoTitle')}</span></h2>
<p class="hint" ${label('photoHint')}</p>
<ul id="ph-list" class="slots"></ul>
<div id="ph-notice" class="note info" role="group" aria-labelledby="ph-nt" hidden>
<p id="ph-nt" ${label('photoNotice')}</p>
<p><a href="https://park-shield.de/datenschutz#warnfotos" target="_blank" rel="noopener noreferrer" ${label('photoPrivacy')}</a></p>
<button type="button" id="ph-ok" class="primary" ${label('photoOk')}</button>
<button type="button" id="ph-cancel" class="secondary" ${label('photoCancel')}</button>
</div>
<div id="ph-cam" role="dialog" aria-modal="true" aria-labelledby="ph-ch" aria-describedby="ph-cd" hidden>
<h3 id="ph-ch" ${label('photoCamera')}</h3>
<p id="ph-cd" class="sr" ${label('photoCameraSr')}</p>
<video id="ph-video" playsinline muted aria-hidden="true"></video>
<button type="button" id="ph-shot" class="primary" ${label('photoShutter')}</button>
<button type="button" id="ph-close" class="secondary" ${label('photoClose')}</button>
</div>
<input type="file" id="ph-file" accept="image/*" capture="environment" hidden tabindex="-1" aria-hidden="true">
<p id="ph-status" class="hint" role="status" aria-live="polite"></p>
<button type="button" id="ph-without" class="secondary" hidden ${label('photoWithout')}</button>
</section>`;
}

/**
 * Abuse protection §4: optional phone check while the vehicle is in Protected Mode. Never says that the
 * owner blocked anyone. The confirmation lives in page memory only (no cookie, no storage).
 */
function verifyBox(label: (k: keyof Strings) => string): string {
  return `<div id="verify" class="note info">
<p ${label('verifyPrompt')}</p>
<button type="button" id="v-open" class="linkbtn" aria-expanded="false" aria-controls="v-form" ${label('verifyOpen')}</button>
<form id="v-form" hidden>
<label for="v-phone" ${label('verifyPhone')}</label>
<input id="v-phone" type="tel" inputmode="tel" autocomplete="off" maxlength="30">
<button type="submit" id="v-send" class="secondary" ${label('verifySend')}</button>
<div id="v-step2" hidden>
<label for="v-code" ${label('verifyCode')}</label>
<input id="v-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10">
<button type="button" id="v-check" class="secondary" ${label('verifyCheck')}</button>
</div>
<p class="hint" ${label('verifyPrivacy')}</p>
<p id="v-err" class="note err" role="alert" hidden></p>
</form>
<p id="v-done" class="note ok" role="status" tabindex="-1" hidden ${label('verifyDone')}</p>
</div>`;
}

export function renderScanner(
  locale: Locale,
  code: string,
  data: ScanPageData,
  captcha: { mode: 'dev'; solution: string } | { mode: 'frc'; sitekey: string },
): string {
  const s = messages[locale].scanner;
  const label = (k: keyof Strings) => `data-t="${k}">${esc(s[k])}`;
  const typeLabel = (a: ScanPageData['alertTypes'][number]) =>
    `data-de="${esc(a.de)}" data-en="${esc(a.en)}">${esc(locale === 'en' ? a.en : a.de)}`;
  const custom = data.alertTypes.find((a) => a.code === 'custom');
  const types = data.alertTypes
    .filter((a) => a.code !== 'custom')
    .map(
      (a) =>
        `<button type="button" class="type${a.severity === 'urgent' ? ' urgent' : ''}" aria-pressed="false" data-type="${esc(a.code)}"><span class="ic">${TYPE_ICON[a.code] ?? I.alert}</span><span class="lbl" ${typeLabel(a)}</span><span class="chk">${I.check}</span></button>`,
    )
    .join('');
  const langs = (['de', 'en'] as const)
    .map(
      (l) =>
        `<button type="button" class="lang" lang="${l}" data-lang="${l}" aria-pressed="${l === locale}">${l.toUpperCase()}<span class="sr"> – ${l === 'de' ? 'Deutsch' : 'English'}</span></button>`,
    )
    .join('');
  const step = (k: keyof Strings, cls = '') =>
    `<li${cls ? ` class="${cls}"` : ''}><span class="dot">${I.check}</span><span class="lbl" ${label(k)}</span> <span class="sr st" hidden ${label('stepDoneSr')}</span></li>`;
  const payload = {
    code,
    lang: locale,
    backAt: data.backAt,
    strings: { de: messages.de.scanner, en: messages.en.scanner },
    captcha: captcha.mode === 'dev' ? captcha : { mode: 'frc' },
  };
  const body = `${header(`<div class="langs" role="group" aria-label="${esc(s.language)}">${langs}</div>`)}
<main>
${data.testMode ? `<p class="note info inote" role="status">${I.flask}<span><b ${label('testLabel')}</b> <span ${label('testBanner')}</span></span></p>` : ''}
<section id="pick" aria-labelledby="h">
<h1 id="h" ${label('choose')}</h1>
<p class="muted" ${label('intro')}</p>
<div class="vehicle">${I.car}<span class="sr" ${label('vehicle')}</span><b>„${esc(data.nickname)}“</b>${data.color ? `<span class="muted">${esc(data.color)}</span>` : ''}</div>
${data.backAt ? '<p class="note info" id="backat"></p>' : ''}
${data.offerVerification ? verifyBox(label) : ''}
<label for="note" class="small" ${label('noteLabel')}</label>
<div class="field">${I.car}<input id="note" maxlength="280" autocomplete="off" placeholder="${esc(s.notePlaceholder)}" data-tp="notePlaceholder"></div>
<div class="types" role="group" aria-labelledby="h">${types}</div>
${custom ? `<button type="button" id="custom-open" class="custom"><span class="bubble">${I.chat}</span><span class="grow"><b ${typeLabel(custom)}</b><small ${label('customSub')}</small></span>${I.chevron}</button>` : ''}
</section>
<form id="custom" hidden>
<label for="msg" ${label('customLabel')}</label>
<textarea id="msg" maxlength="280" aria-describedby="hint count"></textarea>
<p class="hint" id="hint" ${label('customHint')}</p><p class="hint" id="count" aria-live="polite"></p>
<button type="submit" id="send" class="primary">${I.send}<span ${label('sendCustom')}</span></button>
<button type="button" id="back" class="secondary" ${label('back')}</button>
</form>
${data.photos ? photoBox(label) : ''}
<section id="status" hidden tabindex="-1" aria-labelledby="sh">
<div class="card">
<h2 id="sh" ${label('statusTitle')}</h2>
<ol class="steps" id="steps">${step('stepSent')}${step('stepDelivered')}${step('stepAcknowledged', 'final')}</ol>
<p id="result" class="note info inote" role="status" aria-live="polite">${I.info}<span id="result-text"></span></p>
</div>
<p class="hint" id="keep" ${label('chatKeepOpen')}</p>
<section id="chat" class="card" hidden aria-labelledby="ch">
<h3 id="ch" ${label('chatTitle')}</h3>
<p id="chat-intro" class="sys" ${label('chatOpened')}</p>
<div role="log" aria-live="polite" aria-relevant="additions"><ol id="chat-log" class="chat"></ol></div>
<p id="chat-typing" class="hint" aria-live="polite" hidden ${label('chatTyping')}</p>
<form id="chat-form" class="chatin">
<label for="chat-msg" class="sr" ${label('chatLabel')}</label>
<input id="chat-msg" maxlength="500" autocomplete="off" placeholder="${esc(s.chatPlaceholder)}" data-tp="chatPlaceholder" aria-describedby="chat-hint chat-count">
<button type="submit" id="chat-send" class="round" aria-label="${esc(s.chatSend)}" data-ta="chatSend">${I.send}</button>
</form>
<div id="chat-rules"><p class="hint" id="chat-hint" ${label('chatHint')}</p><p class="hint" id="chat-count" aria-live="polite"></p></div>
<p id="chat-err" class="note err" role="alert" hidden></p>
<p id="chat-closed" class="note closed" role="status" tabindex="-1" hidden ${label('chatClosed')}</p>
</section>
<template id="tpl-av"><span class="av" aria-hidden="true">${I.car}</span></template>
<div id="waitbox" hidden><button type="button" id="wait" class="primary" ${label('waitingButton')}</button><p class="hint" ${label('waitingHint')}</p></div>
<div id="guide" class="note warn" hidden><h3 ${label('guideTitle')}</h3><p id="g-office"></p><p><a id="g-search" rel="noopener noreferrer" target="_blank"></a></p><p id="g-police"></p><p id="g-emergency"></p></div>
<p id="offline" class="note warn" hidden ${label('offline')}</p>
<button type="button" id="another" class="secondary">${I.plus}<span ${label('another')}</span></button>
</section>
<button type="button" id="report-open" class="row" aria-expanded="false" aria-controls="report">${I.shield}<span class="grow" ${label('reportLink')}</span>${I.chevron}</button>
<form id="report" class="card" hidden aria-labelledby="rh">
<h2 id="rh" ${label('reportTitle')}</h2>
<p class="muted" ${label('reportText')}</p>
<label for="rnote" ${label('reportLabel')}</label>
<textarea id="rnote" maxlength="500"></textarea>
<p id="rerr" class="note err" role="alert" hidden></p>
<button type="submit" id="rsend" class="primary" ${label('reportSend')}</button>
</form>
<p id="rdone" class="note ok" role="status" hidden ${label('reportThanks')}</p>
<p id="busy" class="note info" role="status" hidden ${label('sending')}</p>
<p id="error" class="note err" role="alert" hidden></p>
<button type="button" id="go" class="primary big">${I.send}<span ${label('sendAlert')}</span></button>
${emergencyRow(s, ' id="emergency-line" hidden')}
${captcha.mode === 'frc' ? `<div id="frc" data-sitekey="${esc(captcha.sitekey)}" data-endpoint="${frcEndpoint()}" hidden></div>` : ''}
</main>
${footer(label)}
<script type="application/json" id="d">${json(payload)}</script>
<script>${SCANNER_JS}</script>
${captcha.mode === 'frc' ? `<script type="module">${FRC_GLUE_JS}</script>` : ''}`;
  return shell(locale, s.title, body);
}
