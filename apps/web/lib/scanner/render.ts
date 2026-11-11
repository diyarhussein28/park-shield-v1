import { createHash } from 'node:crypto';
import { messages, type Locale } from '@parkshield/i18n';
import { FRC_GLUE_JS, SCANNER_JS } from './client';
import { SCANNER_CSS } from './styles';

export interface ScanPageData {
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
    `script-src ${JS_HASH}${withCaptcha ? ` ${GLUE_HASH} 'self'` : ''}`,
    `style-src ${CSS_HASH}`,
    "img-src 'self' data:",
    `connect-src 'self'${withCaptcha ? ' https://eu.frcapi.com https://eu1.frcapi.com' : ''}`,
    ...(withCaptcha ? ['worker-src blob:'] : []),
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

function shell(locale: Locale, title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#1d4ed8"><title>${esc(title)} · ParkShield</title>
<style>${SCANNER_CSS}</style>${extraHead}</head><body>${body}</body></html>`;
}

function footer(s: Strings): string {
  return `<footer><p><b>${esc(s.trustDomain)}</b></p><p>${esc(s.trustPayment)}</p>
<p><a href="https://parkshield.de/">${esc(s.protectToo)}</a></p></footer>`;
}

/** SC-07: reveals nothing about why (unknown, revoked, unpaid all look the same). */
export function renderInactive(locale: Locale): string {
  const s = messages[locale].scanner;
  return shell(
    locale,
    s.inactiveTitle,
    `<main><div class="top"><span class="brand">ParkShield</span></div><h1>${esc(s.inactiveTitle)}</h1>
<p>${esc(s.inactiveText)}</p><p class="note warn">${esc(s.emergency)}</p>${footer(s)}</main>`,
  );
}

/**
 * AD-07: a pre-printed partner decal nobody has set up. The owner sets it up; a stranger learns that
 * this decal cannot reach anyone yet. The code goes in the fragment, so no server log ever sees it.
 */
export function renderUnclaimed(locale: Locale, code: string): string {
  const s = messages[locale].scanner;
  return shell(
    locale,
    s.unclaimedTitle,
    `<main><div class="top"><span class="brand">ParkShield</span></div><h1>${esc(s.unclaimedTitle)}</h1>
<p>${esc(s.unclaimedText)}</p><p><a class="primary" href="/aktivieren#c=${encodeURIComponent(code)}">${esc(s.unclaimedButton)}</a></p>
<p class="note info">${esc(s.unclaimedStranger)}</p><p class="note warn">${esc(s.emergency)}</p>${footer(s)}</main>`,
  );
}

export function renderRateLimited(locale: Locale): string {
  const s = messages[locale].scanner;
  return shell(
    locale,
    s.rateTitle,
    `<main><div class="top"><span class="brand">ParkShield</span></div><h1>${esc(s.rateTitle)}</h1>
<p>${esc(s.rateText)}</p><p class="note warn">${esc(s.emergency)}</p>${footer(s)}</main>`,
  );
}

export function renderScanner(
  locale: Locale,
  code: string,
  data: ScanPageData,
  captcha: { mode: 'dev'; solution: string } | { mode: 'frc'; sitekey: string },
): string {
  const s = messages[locale].scanner;
  const label = (k: keyof Strings) => `data-t="${k}">${esc(s[k])}`;
  const types = data.alertTypes
    .map(
      (a) =>
        `<button type="button" class="type${a.severity === 'urgent' ? ' urgent' : ''}" data-type="${esc(a.code)}" data-de="${esc(a.de)}" data-en="${esc(a.en)}">${esc(locale === 'en' ? a.en : a.de)}</button>`,
    )
    .join('');
  const langs = (['de', 'en'] as const)
    .map(
      (l) =>
        `<button type="button" class="lang" lang="${l}" data-lang="${l}" aria-pressed="${l === locale}">${l.toUpperCase()}<span class="sr"> – ${l === 'de' ? 'Deutsch' : 'English'}</span></button>`,
    )
    .join('');
  const payload = {
    code,
    lang: locale,
    backAt: data.backAt,
    strings: { de: messages.de.scanner, en: messages.en.scanner },
    captcha: captcha.mode === 'dev' ? captcha : { mode: 'frc' },
  };
  const body = `<main>
<div class="top"><span class="brand">ParkShield</span><div class="langs" role="group" aria-label="${esc(s.language)}">${langs}</div></div>
${data.testMode ? `<p class="note info" role="status" ${label('testBanner')}</p>` : ''}
<section id="pick" aria-labelledby="h">
<h1 id="h" ${label('choose')}</h1>
<p class="muted" ${label('intro')}</p>
<div class="vehicle"><span class="sr" ${label('vehicle')}</span><b>„${esc(data.nickname)}“</b>${data.color ? `<span class="muted">${esc(data.color)}</span>` : ''}</div>
${data.backAt ? '<p class="note info" id="backat"></p>' : ''}
<div class="types">${types}</div>
</section>
<form id="custom" hidden>
<label for="msg" ${label('customLabel')}</label>
<textarea id="msg" maxlength="280" aria-describedby="hint count"></textarea>
<p class="hint" id="hint" ${label('customHint')}</p><p class="hint" id="count" aria-live="polite"></p>
<button type="submit" id="send" class="primary" ${label('sendCustom')}</button>
<button type="button" id="back" class="secondary" ${label('back')}</button>
</form>
<p id="busy" class="note info" role="status" hidden ${label('sending')}</p>
<p id="error" class="note err" role="alert" hidden></p>
<section id="status" hidden tabindex="-1" aria-labelledby="sh">
<h2 id="sh" ${label('statusTitle')}</h2>
<ol class="steps" id="steps"><li ${label('stepSent')}</li><li ${label('stepDelivered')}</li><li class="final" ${label('stepAcknowledged')}</li></ol>
<p id="result" class="note info" role="status" aria-live="polite"></p>
<div id="waitbox" hidden><button type="button" id="wait" class="primary" ${label('waitingButton')}</button><p class="hint" ${label('waitingHint')}</p></div>
<div id="guide" class="note warn" hidden><h3 ${label('guideTitle')}</h3><p id="g-office"></p><p><a id="g-search" rel="noopener noreferrer" target="_blank"></a></p><p id="g-police"></p><p id="g-emergency"></p></div>
<p id="offline" class="note warn" hidden ${label('offline')}</p>
<p class="muted" id="emergency-line" ${label('emergency')}</p>
<button type="button" id="another" class="secondary" ${label('another')}</button>
</section>
<p><button type="button" id="report-open" class="linkbtn" aria-expanded="false" aria-controls="report" ${label('reportLink')}</button></p>
<form id="report" hidden aria-labelledby="rh">
<h2 id="rh" ${label('reportTitle')}</h2>
<p class="muted" ${label('reportText')}</p>
<label for="rnote" ${label('reportLabel')}</label>
<textarea id="rnote" maxlength="500"></textarea>
<p id="rerr" class="note err" role="alert" hidden></p>
<button type="submit" id="rsend" class="primary" ${label('reportSend')}</button>
</form>
<p id="rdone" class="note ok" role="status" hidden ${label('reportThanks')}</p>
${captcha.mode === 'frc' ? `<div id="frc" data-sitekey="${esc(captcha.sitekey)}" hidden></div>` : ''}
${footer(s)}
</main>
<script type="application/json" id="d">${json(payload)}</script>
<script>${SCANNER_JS}</script>
${captcha.mode === 'frc' ? `<script type="module">${FRC_GLUE_JS}</script>` : ''}`;
  return shell(locale, s.title, body);
}
