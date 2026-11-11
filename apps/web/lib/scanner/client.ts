// Vanilla client for the scanner page (no framework: the page must load in < 1.5 s on 4G, JS < 90 KB).
// Data arrives in <script type="application/json" id="d">; this script is identical for every request so
// its CSP hash is static. Nothing is stored except the status token in sessionStorage (§25 TDDDG).
export const SCANNER_JS = `(() => {
'use strict';
const d = JSON.parse(document.getElementById('d').textContent);
const $ = (id) => document.getElementById(id);
let lang = d.lang;
const t = (k, v) => (d.strings[lang][k] || k).replace(/\\{(\\w+)\\}/g, (_, n) => (v && v[n] != null ? v[n] : ''));
const time = (iso) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const KEY = 'ps:alert:' + d.code;
let current = null, timer = null, last = null, busy = false;

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('.type').forEach((el) => { el.textContent = el.dataset[lang]; });
  document.querySelectorAll('.lang').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.lang === lang)));
  if (d.backAt) $('backat').textContent = t('backAt', { time: time(d.backAt) });
  counter();
  if (last) render(last);
}
document.querySelectorAll('.lang').forEach((b) => b.addEventListener('click', () => { lang = b.dataset.lang; applyLang(); }));

function counter() { const m = $('msg'); if (m) $('count').textContent = t('counter', { count: m.value.length }); }
function error(text) { const e = $('error'); e.textContent = text || ''; e.hidden = !text; }
function setBusy(on) {
  busy = on;
  document.querySelectorAll('.type, #send').forEach((b) => { b.disabled = on; });
  $('busy').hidden = !on;
}

function captcha() {
  if (d.captcha.mode === 'dev') return Promise.resolve(d.captcha.solution);
  const take = () => { const s = window.__psCaptcha; window.__psCaptcha = null; document.dispatchEvent(new Event('ps:captcha-used')); return s; };
  if (window.__psCaptcha) return Promise.resolve(take());
  return new Promise((resolve) => {
    const done = () => resolve(take());
    document.addEventListener('ps:captcha', done, { once: true });
    setTimeout(done, 15000);
  });
}
const minutes = (body) => Math.max(1, Math.ceil((body.retryAfterSeconds || 60) / 60));
// US-17: say which limit was hit, never just "error".
const RATE = { 'alert.scanner_vehicle': 'rateVehicle', 'alert.scanner_global': 'rateScanner', 'alert.vehicle': 'rateDaily' };

// SC-13 / US-18: who helps when the driver does not come. Office names stay in the local language.
const GUIDE = {
  DE: { office: 'Ordnungsamt', police: '110', sos: ['110', '112'] },
  AT: { office: 'Magistrat / Gemeindeamt', police: '133', sos: ['133', '112'] },
  CH: { office: 'Gemeindepolizei / Police municipale', police: '117', sos: ['117', '144', '112'] },
  NL: { office: 'Gemeente (Handhaving)', police: '0900-8844', sos: ['112'] },
  BE: { office: 'Police locale / Lokale politie', police: '101', sos: ['101', '112'] },
  FR: { office: 'Police municipale', police: '17', sos: ['17', '112'] },
  IT: { office: 'Polizia Locale', police: '113', sos: ['113', '112'] },
  PL: { office: 'Straż Miejska (986)', police: null, sos: ['112'] },
};
function tel(n) { const a = document.createElement('a'); a.href = 'tel:' + n.replace(/[^0-9+]/g, ''); a.textContent = n; return a; }
function guide(country, show) {
  const box = $('guide');
  box.hidden = !show;
  $('emergency-line').hidden = show;
  if (!show) return;
  const g = GUIDE[country] || { office: null, police: null, sos: ['112'] };
  $('g-office').hidden = !g.office;
  $('g-search').parentElement.hidden = !g.office;
  $('g-police').hidden = !g.police;
  if (g.office) {
    $('g-office').textContent = t('guideOffice', { office: g.office });
    $('g-search').textContent = t('guideSearch', { office: g.office });
    $('g-search').href = 'https://www.openstreetmap.org/search?query=' + encodeURIComponent(g.office.split(' / ')[0]);
  }
  if (g.police) { const p = $('g-police'); p.textContent = t('guidePolice', { police: '' }); p.appendChild(tel(g.police)); }
  const e = $('g-emergency');
  e.textContent = t('guideEmergency', { numbers: '' });
  g.sos.forEach((n, i) => { if (i) e.appendChild(document.createTextNode(' / ')); e.appendChild(tel(n)); });
}

async function send(type, message) {
  if (busy) return;
  error('');
  setBusy(true);
  try {
    const res = await fetch('/v1/scan/' + encodeURIComponent(d.code) + '/alerts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ type, message, lang, captcha: await captcha() }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 201) {
      current = { id: body.alertId, token: body.statusToken };
      sessionStorage.setItem(KEY, JSON.stringify(current));
      showStatus();
      return;
    }
    if (body.error === 'message_blocked') error(t('errorBlocked'));
    else if (res.status === 429) error(t(RATE[body.limit] || 'errorRate', { minutes: minutes(body) }));
    else if (body.error === 'captcha_failed') error(t('errorCaptcha'));
    else error(t('errorGeneric'));
  } catch (e) {
    error(t('errorGeneric'));
  } finally {
    setBusy(false);
  }
}

document.querySelectorAll('.type').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.type === 'custom') { $('pick').hidden = true; $('custom').hidden = false; $('msg').focus(); }
  else send(b.dataset.type);
}));
$('msg').addEventListener('input', counter);
$('custom').addEventListener('submit', (e) => { e.preventDefault(); const v = $('msg').value.trim(); if (v) send('custom', v); });
$('back').addEventListener('click', () => { $('custom').hidden = true; $('pick').hidden = false; error(''); });
$('another').addEventListener('click', () => {
  sessionStorage.removeItem(KEY); current = null; last = null; clearTimeout(timer);
  $('status').hidden = true; $('custom').hidden = true; $('pick').hidden = false; $('msg').value = ''; counter();
  $('pick').querySelector('.type').focus();
});

const FINAL = { acknowledged: 'stepAcknowledged', escalated: 'stepEscalated', expired: 'stepExpired' };
function render(s) {
  last = s;
  const delivered = !!s.deliveredAt || s.status === 'delivered' || s.status === 'acknowledged' || s.status === 'escalated';
  const steps = $('steps').children;
  steps[0].className = 'done';
  steps[1].className = delivered ? 'done' : '';
  const finalKey = FINAL[s.status];
  steps[2].textContent = t(finalKey || 'stepAcknowledged');
  steps[2].className = 'final' + (finalKey ? ' done' : '');
  const lines = [];
  let tone = 'info';
  if (s.status === 'acknowledged') {
    tone = 'ok';
    lines.push(s.ownerReply === 'not_nearby' ? t('replyNotNearby') : t('acknowledged'));
    if (s.ownerReply === 'in_30_min') lines.push(t('replyIn30'));
    if (s.acknowledgedAt) lines.push(t('acknowledgedAt', { time: time(s.acknowledgedAt) }));
    if (s.waitingSentAt) lines.push(t('waitingSent'));
  } else if (s.status === 'escalated') { tone = 'warn'; lines.push(t('escalated')); }
  else if (s.status === 'expired') { tone = 'warn'; lines.push(t('expired')); }
  else lines.push(s.isTest ? t('testSent') : delivered ? t('delivered') : t('sent'));
  const box = $('result');
  box.className = 'note ' + tone;
  box.textContent = lines.join(' ');
  const canWait = s.status === 'acknowledged' && !s.waitingSentAt && s.waitingAvailableAt && Date.parse(s.waitingAvailableAt) <= Date.now();
  $('waitbox').hidden = !canWait;
  guide(s.country, !s.isTest && (s.status === 'expired' || (s.status === 'acknowledged' && s.ownerReply === 'not_nearby')));
}

// SC-14: "Ich warte noch" — once per alert; the server enforces both the delay and the single use.
$('wait').addEventListener('click', async () => {
  if (!current) return;
  $('wait').disabled = true;
  try {
    const res = await fetch('/v1/alerts/' + current.id + '/waiting', { method: 'POST', headers: { 'x-status-token': current.token }, credentials: 'omit' });
    if (res.status !== 200 && res.status !== 409) error(t('errorGeneric'));
  } catch (e) {
    error(t('errorGeneric'));
  } finally {
    $('wait').disabled = false;
    clearTimeout(timer);
    poll();
  }
});

// SC-15 / US-19: suspicious decal → abuse centre.
$('report-open').addEventListener('click', () => {
  const f = $('report');
  f.hidden = !f.hidden;
  $('report-open').setAttribute('aria-expanded', String(!f.hidden));
  if (!f.hidden) $('rnote').focus();
});
$('report').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fail = (text) => { $('rerr').textContent = text; $('rerr').hidden = false; };
  $('rerr').hidden = true;
  $('rsend').disabled = true;
  try {
    const note = $('rnote').value.trim();
    const res = await fetch('/v1/scan/' + encodeURIComponent(d.code) + '/report-fake', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'omit',
      body: JSON.stringify({ note: note || undefined, captcha: await captcha() }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.status === 202) {
      $('report').hidden = true; $('report-open').hidden = true; $('rdone').hidden = false;
    } else if (res.status === 429) fail(t('errorRate', { minutes: minutes(body) }));
    else if (body.error === 'captcha_failed') fail(t('errorCaptcha'));
    else fail(t('errorGeneric'));
  } catch (err) {
    fail(t('errorGeneric'));
  } finally {
    $('rsend').disabled = false;
  }
});

async function poll() {
  if (!current) return;
  try {
    const res = await fetch('/v1/alerts/' + current.id + '/status', { headers: { 'x-status-token': current.token }, credentials: 'omit' });
    if (res.status === 404) { sessionStorage.removeItem(KEY); return; }
    const s = await res.json();
    $('offline').hidden = true;
    render(s);
    if (s.status === 'expired' || Date.parse(s.expiresAt) < Date.now()) return;
    timer = setTimeout(poll, 3000);
  } catch (e) {
    $('offline').hidden = false;
    timer = setTimeout(poll, 6000);
  }
}

function showStatus() {
  $('pick').hidden = true; $('custom').hidden = true; $('status').hidden = false;
  render(last || { status: 'dispatched' });
  $('status').focus();
  clearTimeout(timer);
  poll();
}

try { current = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { current = null; }
applyLang();
if (current) showStatus();
})();`;

/** Glue for the real Friendly Captcha widget (only used when a sitekey is configured). */
export const FRC_GLUE_JS = `import { FriendlyCaptchaSDK } from '/scanner-assets/frc-sdk.js';
const el = document.getElementById('frc');
const w = new FriendlyCaptchaSDK({ apiEndpoint: 'eu' }).createWidget({ element: el, sitekey: el.dataset.sitekey, startMode: 'auto' });
w.addEventListener('frc:widget.complete', (e) => { window.__psCaptcha = e.detail.response; document.dispatchEvent(new Event('ps:captcha')); });
// A solution is single-use: solve a fresh one for the next alert or report.
document.addEventListener('ps:captcha-used', () => w.reset());`;
