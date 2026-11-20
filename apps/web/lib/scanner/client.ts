// Vanilla client for the scanner page (no framework: the page must load in < 1.5 s on 4G, JS < 90 KB).
// Data arrives in <script type="application/json" id="d">; this script is identical for every request so
// its CSP hash is static. Nothing is read from or stored on the device (§25 TDDDG): no cookies, no Web
// Storage, no IndexedDB. The status token of the own alert lives in memory and in the URL fragment
// (never sent to a server), so a reload keeps the status; a phone confirmation lives in memory only.
// The live chat token travels the same way (third part of the fragment) and is sent only in the
// Socket.io handshake's auth payload, never in a URL.
export const SCANNER_JS = `(() => {
'use strict';
const d = JSON.parse(document.getElementById('d').textContent);
const $ = (id) => document.getElementById(id);
let lang = d.lang;
const t = (k, v) => (d.strings[lang][k] || k).replace(/\\{(\\w+)\\}/g, (_, n) => (v && v[n] != null ? v[n] : ''));
const time = (iso) => new Intl.DateTimeFormat(lang, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
let current = null, timer = null, last = null, busy = false, verification = null;
const FRAG = /^#a=([0-9a-f-]{36})\\.([A-Za-z0-9_-]{20,100})(?:\\.([A-Za-z0-9_-]{20,100}))?$/;
function remember(c) { history.replaceState(null, '', c ? '#a=' + c.id + '.' + c.token + (c.chat ? '.' + c.chat : '') : location.pathname); }

function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-t]').forEach((el) => { el.textContent = t(el.dataset.t); });
  document.querySelectorAll('.type').forEach((el) => { el.textContent = el.dataset[lang]; });
  document.querySelectorAll('.lang').forEach((el) => el.setAttribute('aria-pressed', String(el.dataset.lang === lang)));
  if (d.backAt) $('backat').textContent = t('backAt', { time: time(d.backAt) });
  if ($('ph')) phRender();
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
const RATE = { 'alert.scanner_vehicle': 'rateVehicle', 'alert.scanner_vehicle_day': 'rateVehicle', 'alert.phone_vehicle': 'rateVehicle', 'alert.phone_vehicle_day': 'rateVehicle', 'alert.scanner_global': 'rateScanner', 'alert.vehicle': 'rateDaily' };

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

// Phase 2 alert photos: one multipart request with upload progress (XHR; fetch cannot report it).
function upload(url, form) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.withCredentials = false;
    x.timeout = 60000;
    x.upload.onprogress = (e) => { if (e.lengthComputable) phStatus(t('photoUploading', { percent: Math.round((e.loaded / e.total) * 100) })); };
    x.onload = () => { let b = {}; try { b = JSON.parse(x.responseText); } catch (e) {} resolve({ status: x.status, body: b }); };
    x.onerror = () => reject(new Error('network'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send(form);
  });
}

async function send(type, message, withoutPhotos) {
  if (busy) return;
  error('');
  $('ph-without') && ($('ph-without').hidden = true);
  setBusy(true);
  const url = '/v1/scan/' + encodeURIComponent(d.code) + '/alerts';
  const usePhotos = !withoutPhotos && photos.length > 0;
  try {
    const alert = { type, message, lang, captcha: await captcha(), verification: verification || undefined };
    let res;
    if (usePhotos) {
      const form = new FormData();
      form.append('alert', JSON.stringify(alert));
      photos.forEach((p, i) => form.append('photos', p.blob, 'foto-' + (i + 1) + '.jpg'));
      try {
        res = await upload(url, form);
      } catch (e) {
        res = null;
      }
      // A photo problem never blocks the alert: offer to send it without photos.
      if (!res || res.status === 413 || res.status === 0) {
        phStatus('');
        error(t('photoFailed'));
        $('ph-without').hidden = false;
        $('ph-without').onclick = () => send(type, message, true);
        return;
      }
    } else {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify(alert),
      });
      res = { status: r.status, body: await r.json().catch(() => ({})) };
    }
    const body = res.body;
    if (res.status === 201) {
      current = { id: body.alertId, token: body.statusToken, chat: body.chatToken };
      remember(current);
      const ph = body.photos;
      const note = ph && ph.rejected ? (ph.stored ? t('photoPartly') : t('photoDropped')) : '';
      phClear();
      phStatus(note);
      showStatus();
      if (note) error(note);
      return;
    }
    if (body.error === 'message_blocked') error(t('errorBlocked'));
    else if (body.error === 'not_deliverable') error(t('notDeliverable'));
    else if (res.status === 429) error(t(RATE[body.limit] || 'errorRate', { minutes: minutes(body) }));
    else if (body.error === 'captcha_failed') error(t('errorCaptcha'));
    else error(t('errorGeneric'));
  } catch (e) {
    error(t('errorGeneric'));
  } finally {
    setBusy(false);
    if (usePhotos) phStatus(photos.length ? t('photoCount', { count: photos.length }) : '');
  }
}

// --- Phase 2: optional photos (max. 2), live camera first ------------------------------------------
// The live camera (getUserMedia) is the preferred path, NOT a guarantee: the browser cannot prove a
// photo is live. The fallback's capture="environment" is only a hint, and virtual cameras exist. The
// server treats every upload as untrusted (magic bytes, decode, re-encode, no metadata).
const photos = [];
let retake = -1, stream = null, noticeOk = false;
const MAXP = 2, MAX_SIDE = 1600, TARGET = 300 * 1024, HARD = 500 * 1024;
function phStatus(text) { const s = $('ph-status'); if (s) s.textContent = text || ''; }
function phClear() { photos.splice(0).forEach((p) => URL.revokeObjectURL(p.url)); phRender(); }
function phRender() {
  const list = $('ph-list');
  if (!list) return;
  list.textContent = '';
  photos.forEach((p, i) => {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.src = p.url; img.alt = t('photoAlt', { n: i + 1 });
    const again = document.createElement('button');
    again.type = 'button'; again.className = 'secondary'; again.textContent = t('photoRetake');
    again.setAttribute('aria-label', t('photoRetake') + ' – ' + img.alt);
    again.addEventListener('click', () => phAdd(i));
    const del = document.createElement('button');
    del.type = 'button'; del.className = 'secondary'; del.textContent = t('photoDelete');
    del.setAttribute('aria-label', t('photoDelete') + ' – ' + img.alt);
    del.addEventListener('click', () => { URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); phRender(); $('ph-add').focus(); });
    li.append(img, again, del);
    list.appendChild(li);
  });
  $('ph-add').disabled = photos.length >= MAXP;
  phStatus(photos.length ? t('photoCount', { count: photos.length }) : '');
}
function phAdd(i) {
  retake = i;
  if (noticeOk) { openCamera(); return; }
  $('ph-notice').hidden = false;
  $('ph-ok').focus();
}
function stopCamera() {
  if (stream) stream.getTracks().forEach((tr) => tr.stop());
  stream = null;
  const v = $('ph-video'); if (v) v.srcObject = null;
  if ($('ph-cam')) $('ph-cam').hidden = true;
}
function fallback() { const f = $('ph-file'); f.value = ''; f.click(); }
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { fallback(); return; }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  } catch (e) {
    stream = null; fallback(); return; // permission denied, no camera, old browser
  }
  const v = $('ph-video');
  v.srcObject = stream;
  $('ph-cam').hidden = false;
  try { await v.play(); } catch (e) {}
  $('ph-shot').focus();
}
function draw(src, w, h) {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}
// Re-encoding through a canvas also drops EXIF (GPS, device) on the phone already.
async function compress(c) {
  let blob = null;
  for (let q = 0.8; q >= 0.5 - 1e-9; q -= 0.1) {
    blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
    if (blob && blob.size < TARGET) break;
  }
  return blob && blob.size <= HARD ? blob : null;
}
function keep(blob) {
  if (!blob) { phStatus(t('photoError')); return; }
  const p = { blob, url: URL.createObjectURL(blob) };
  if (retake >= 0 && photos[retake]) { URL.revokeObjectURL(photos[retake].url); photos[retake] = p; }
  else if (photos.length < MAXP) photos.push(p);
  retake = -1;
  phRender();
  $('ph-add').disabled ? $('ph-list').querySelector('button').focus() : $('ph-add').focus();
}
if ($('ph')) {
  $('ph-add').addEventListener('click', () => phAdd(-1));
  $('ph-ok').addEventListener('click', () => { noticeOk = true; $('ph-notice').hidden = true; openCamera(); });
  $('ph-cancel').addEventListener('click', () => { $('ph-notice').hidden = true; $('ph-add').focus(); });
  $('ph-shot').addEventListener('click', async () => {
    const v = $('ph-video');
    if (!v.videoWidth) return;
    const c = draw(v, v.videoWidth, v.videoHeight);
    stopCamera();
    keep(await compress(c));
  });
  $('ph-close').addEventListener('click', () => { stopCamera(); $('ph-add').focus(); });
  $('ph-cam').addEventListener('keydown', (e) => { if (e.key === 'Escape') { stopCamera(); $('ph-add').focus(); } });
  $('ph-file').addEventListener('change', async () => {
    const f = $('ph-file').files[0];
    if (!f) return;
    try {
      const bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
      const c = draw(bmp, bmp.width, bmp.height);
      bmp.close && bmp.close();
      keep(await compress(c));
    } catch (e) {
      phStatus(t('photoError'));
    }
  });
  // Never leave the camera running in the background.
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);
}

document.querySelectorAll('.type').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.type === 'custom') { $('pick').hidden = true; $('custom').hidden = false; $('msg').focus(); }
  else send(b.dataset.type);
}));
$('msg').addEventListener('input', counter);
$('custom').addEventListener('submit', (e) => { e.preventDefault(); const v = $('msg').value.trim(); if (v) send('custom', v); });
$('back').addEventListener('click', () => { $('custom').hidden = true; $('pick').hidden = false; error(''); });
$('another').addEventListener('click', () => {
  remember(null); current = null; last = null; clearTimeout(timer); chatStop();
  $('status').hidden = true; $('custom').hidden = true; $('pick').hidden = false; $('msg').value = ''; counter();
  if ($('ph')) { phClear(); $('ph').hidden = false; }
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
    lines.push(s.ownerReply === 'not_nearby' ? t('replyNotNearby') : s.acknowledgedBy === 'contact' ? t('contactOnTheWay') : t('acknowledged'));
    if (s.ownerReply === 'in_30_min') lines.push(t('replyIn30'));
    if (s.acknowledgedAt) lines.push(t('acknowledgedAt', { time: time(s.acknowledgedAt) }));
    if (s.waitingSentAt) lines.push(t('waitingSent'));
  } else if (s.status === 'escalated') { tone = 'warn'; lines.push(t('escalated')); }
  else if (s.status === 'expired') { tone = 'warn'; lines.push(t('expired')); }
  else lines.push(s.isTest ? t('testSent') : s.seenAt ? t('seen') : delivered ? t('delivered') : t('sent'));
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
    if (res.status === 404) { remember(null); return; }
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

// --- Owner-initiated live chat (Socket.io, loaded only now). No storage: the token is in memory and in
// the fragment. Wake Lock keeps the screen on while waiting; the socket reconnects when the page is
// visible again or the network returns.
let io = null, sock = null, chatState = 'locked', wake = null, ioLoading = null, typingTimer = null, closedShown = false;
function loadIo() {
  if (window.io) return Promise.resolve(window.io);
  if (ioLoading) return ioLoading;
  ioLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/scanner-assets/socket.io.min.js';
    s.onload = () => resolve(window.io);
    s.onerror = () => { ioLoading = null; reject(new Error('io')); };
    document.head.appendChild(s);
  });
  return ioLoading;
}
async function wakeOn() {
  if (wake || document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
  try { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } catch (e) { wake = null; }
}
function wakeOff() { if (wake) { wake.release().catch(() => {}); wake = null; } }
function chatErr(k) { const e = $('chat-err'); e.textContent = k ? t(k) : ''; e.hidden = !k; }
function chatCount() { $('chat-count').textContent = t('chatCounter', { count: $('chat-msg').value.length }); }
function addMsg(m) {
  if (document.getElementById('m-' + m.id)) return;
  const li = document.createElement('li');
  li.id = 'm-' + m.id;
  li.className = m.from;
  const who = document.createElement('small');
  who.textContent = (m.from === 'scanner' ? t('chatYou') : t('chatOwner')) + ' · ' + time(m.at);
  li.appendChild(who);
  li.appendChild(document.createTextNode(m.text));
  $('chat-log').appendChild(li);
  li.scrollIntoView({ block: 'nearest' });
}
function chatShow(st) {
  chatState = st.status;
  if (st.status === 'locked') { $('chat').hidden = true; return; }
  if (st.status === 'closed') { chatClosed(); (st.messages || []).forEach(addMsg); if ((st.messages || []).length) $('chat').hidden = false; $('chat-form').hidden = true; return; }
  $('chat').hidden = false;
  $('chat-form').hidden = false;
  (st.messages || []).forEach(addMsg);
}
function alertUser() {
  // The chat opened: sound, vibration and the tab title, so a phone in a pocket notices.
  document.title = t('chatPageTitle');
  try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) {}
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (A) { const ctx = new A(); const o = ctx.createOscillator(); const g = ctx.createGain(); o.frequency.value = 880; g.gain.value = 0.08; o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.25); }
  } catch (e) {}
}
function chatClosed() {
  chatState = 'closed';
  $('chat-form').hidden = true;
  $('keep').hidden = true;
  $('chat-typing').hidden = true;
  wakeOff();
  if (!closedShown) { closedShown = true; $('chat-closed').hidden = false; }
}
async function chatStart() {
  if (!current || !current.chat || sock) return;
  try { io = await loadIo(); } catch (e) { return; }
  if (!current || sock) return;
  sock = io('/chat', { path: '/v1/socket.io', addTrailingSlash: false, auth: { role: 'scanner', alertId: current.id, token: current.chat, lang }, transports: ['websocket', 'polling'], reconnection: true, reconnectionDelayMax: 10000 });
  sock.on('chat:state', (st) => { chatShow(st); if (st.status !== 'closed') wakeOn(); });
  sock.on('chat:opened', (st) => { chatShow(st); alertUser(); wakeOn(); $('chat-msg').focus(); });
  sock.on('chat:message', (m) => { addMsg(m); if (m.from === 'owner') { $('chat-typing').hidden = true; if (document.visibilityState === 'visible') sock.emit('chat:seen'); } });
  sock.on('chat:typing', (x) => { if (x.from !== 'owner') return; $('chat-typing').hidden = !x.typing; clearTimeout(typingTimer); if (x.typing) typingTimer = setTimeout(() => { $('chat-typing').hidden = true; }, 6000); });
  sock.on('chat:closed', () => chatClosed());
  sock.on('chat:error', (x) => chatErr({ filtered: 'chatFiltered', limit_reached: 'chatLimit', too_long: 'chatTooLong', chat_not_active: 'chatNotActive', rate_limited: 'chatRate' }[x.error] || 'chatError'));
  sock.on('alert:changed', () => { clearTimeout(timer); poll(); });
  sock.on('connect_error', () => {});
}
function chatStop() { if (sock) { sock.disconnect(); sock = null; } wakeOff(); }
$('chat-msg').addEventListener('input', () => {
  chatCount();
  if (sock && chatState === 'active') sock.emit('chat:typing', { typing: $('chat-msg').value.length > 0 });
});
$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('chat-msg').value.trim();
  if (!v || !sock || chatState !== 'active') return;
  chatErr(null);
  $('chat-send').disabled = true;
  sock.timeout(10000).emit('chat:message', { text: v }, (err, r) => {
    $('chat-send').disabled = false;
    if (err) return chatErr('chatError');
    if (r && r.ok) { $('chat-msg').value = ''; chatCount(); sock.emit('chat:typing', { typing: false }); }
  });
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    document.title = t('title');
    if (sock && !sock.connected) sock.connect();
    if (chatState !== 'closed' && current) wakeOn();
    if (sock && chatState === 'active') sock.emit('chat:seen');
  } else wakeOff();
});
window.addEventListener('online', () => { if (sock && !sock.connected) sock.connect(); });

function showStatus() {
  $('pick').hidden = true; $('custom').hidden = true; $('status').hidden = false;
  if ($('ph')) { stopCamera(); $('ph').hidden = true; }
  render(last || { status: 'dispatched' });
  $('status').focus();
  clearTimeout(timer);
  poll();
  chatCount();
  chatStart();
  wakeOn();
}

// Abuse protection §4: optional phone check (number -> SMS code -> confirmed), Protected Mode only.
if ($('verify')) {
  const vErr = (k) => { const e = $('v-err'); e.textContent = k ? t(k) : ''; e.hidden = !k; };
  const V_ERR = { phone_not_mobile: 'verifyErrMobile', phone_country: 'verifyErrCountry', phone_invalid: 'verifyErrInvalid', code_invalid: 'verifyErrCode', not_deliverable: 'notDeliverable', captcha_failed: 'errorCaptcha' };
  const post = (path, payload) => fetch('/v1/scan/' + encodeURIComponent(d.code) + '/verify/' + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, credentials: 'omit', body: JSON.stringify(payload),
  });
  const fail = async (res) => {
    const b = await res.json().catch(() => ({}));
    if (res.status === 429) { const e = $('v-err'); e.textContent = t('errorRate', { minutes: minutes(b) }); e.hidden = false; }
    else vErr(V_ERR[b.error] || 'errorGeneric');
  };
  $('v-open').addEventListener('click', () => {
    const f = $('v-form'); f.hidden = !f.hidden;
    $('v-open').setAttribute('aria-expanded', String(!f.hidden));
    if (!f.hidden) $('v-phone').focus();
  });
  $('v-form').addEventListener('submit', async (e) => {
    e.preventDefault(); vErr(null);
    const phone = $('v-phone').value.trim(); if (!phone) return;
    $('v-send').disabled = true;
    try {
      const res = await post('start', { phone, lang, captcha: await captcha() });
      if (res.status === 202) { $('v-step2').hidden = false; $('v-code').focus(); } else await fail(res);
    } catch (err) { vErr('errorGeneric'); } finally { $('v-send').disabled = false; }
  });
  $('v-check').addEventListener('click', async () => {
    vErr(null);
    const code = $('v-code').value.replace(/\\D/g, ''); if (!code) return;
    $('v-check').disabled = true;
    try {
      const res = await post('check', { phone: $('v-phone').value.trim(), code });
      if (res.status === 200) {
        verification = (await res.json()).verification;
        $('v-form').hidden = true; $('v-open').hidden = true; $('v-done').hidden = false; $('v-done').focus();
      } else await fail(res);
    } catch (err) { vErr('errorGeneric'); } finally { $('v-check').disabled = false; }
  });
}

const frag = FRAG.exec(location.hash);
current = frag ? { id: frag[1], token: frag[2], chat: frag[3] || null } : null;
applyLang();
if (current) showStatus();
})();`;

/** Glue for the real Friendly Captcha widget (only used when a sitekey is configured). */
export const FRC_GLUE_JS = `import { FriendlyCaptchaSDK } from '/scanner-assets/frc-sdk.js';
const el = document.getElementById('frc');
const w = new FriendlyCaptchaSDK({ apiEndpoint: el.dataset.endpoint }).createWidget({ element: el, sitekey: el.dataset.sitekey, startMode: 'auto' });
w.addEventListener('frc:widget.complete', (e) => { window.__psCaptcha = e.detail.response; document.dispatchEvent(new Event('ps:captcha')); });
// A solution is single-use: solve a fresh one for the next alert or report.
document.addEventListener('ps:captcha-used', () => w.reset());`;
