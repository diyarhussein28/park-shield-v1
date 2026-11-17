import { createHash } from 'node:crypto';
import { messages, type Locale } from '@parkshield/i18n';
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
    `script-src ${JS_HASH}${withCaptcha ? ` ${GLUE_HASH} 'self'` : ''}`,
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

function shell(locale: Locale, title: string, body: string, extraHead = ''): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<meta name="theme-color" content="#1d4ed8"><title>${esc(title)} · ParkShield</title>
<style>${SCANNER_CSS}</style>${extraHead}</head><body>${body}</body></html>`;
}

function footer(s: Strings): string {
  return `<footer><p><b>${esc(s.trustDomain)}</b></p><p>${esc(s.trustPayment)}</p>
<p><a href="https://park-shield.de/">${esc(s.protectToo)}</a></p></footer>`;
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

/**
 * Abuse protection §4: optional phone check while the vehicle is in Protected Mode. Never says that the
 * owner blocked anyone. The confirmation lives in page memory only (no cookie, no storage).
 */
/**
 * Phase 2 alert photos. The notice must be confirmed before the camera opens (TODO [LEGAL REVIEW]: the
 * notice and the privacy link target, LEGAL_REVIEW.md §5).
 */
function photoBox(label: (k: keyof Strings) => string): string {
  return `<section id="ph" aria-labelledby="ph-h">
<h2 id="ph-h" ${label('photoTitle')}</h2>
<p class="hint" ${label('photoHint')}</p>
<ul id="ph-list" class="thumbs"></ul>
<button type="button" id="ph-add" class="secondary" ${label('photoAdd')}</button>
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
${data.offerVerification ? verifyBox(label) : ''}
<div class="types">${types}</div>
</section>
<form id="custom" hidden>
<label for="msg" ${label('customLabel')}</label>
<textarea id="msg" maxlength="280" aria-describedby="hint count"></textarea>
<p class="hint" id="hint" ${label('customHint')}</p><p class="hint" id="count" aria-live="polite"></p>
<button type="submit" id="send" class="primary" ${label('sendCustom')}</button>
<button type="button" id="back" class="secondary" ${label('back')}</button>
</form>
${data.photos ? photoBox(label) : ''}
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
${captcha.mode === 'frc' ? `<div id="frc" data-sitekey="${esc(captcha.sitekey)}" data-endpoint="${frcEndpoint()}" hidden></div>` : ''}
${footer(s)}
</main>
<script type="application/json" id="d">${json(payload)}</script>
<script>${SCANNER_JS}</script>
${captcha.mode === 'frc' ? `<script type="module">${FRC_GLUE_JS}</script>` : ''}`;
  return shell(locale, s.title, body);
}
