// ParkShield service worker: Web Push only (no offline caching, nothing stored).
'use strict';

const REPLIES = ['coming', 'in_30_min', 'not_nearby'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'ParkShield', body: event.data ? event.data.text() : '' };
  }
  const url =
    typeof data.url === 'string' && data.url.startsWith(self.location.origin) ? data.url : '/konto';
  // OW-16: quick replies as notification actions. Browsers show up to maxActions (often 2); the
  // notification itself opens the reply page with all three.
  const max = (self.Notification && self.Notification.maxActions) || 2;
  const actions = Array.isArray(data.actions)
    ? data.actions.filter((a) => REPLIES.includes(a.action)).slice(0, max)
    : [];
  event.waitUntil(
    self.registration.showNotification(data.title || 'ParkShield', {
      body: data.body || '',
      tag: data.tag,
      renotify: Boolean(data.tag),
      requireInteraction: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: data.lang,
      actions,
      data: { url, token: data.token, replied: data.replied, lang: data.lang },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification;
  const d = n.data || {};
  n.close();
  if (REPLIES.includes(event.action) && d.token) {
    // A tap on a reply button is the explicit tap NT-02 requires; post it without opening a window.
    event.waitUntil(
      fetch('/v1/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        body: JSON.stringify({ token: d.token, reply: event.action }),
      })
        .then((res) =>
          res.ok || res.status === 409
            ? self.registration.showNotification(d.replied || 'ParkShield', {
                tag: n.tag,
                lang: d.lang,
                icon: '/icons/icon-192.png',
              })
            : self.clients.openWindow(d.url || '/konto'),
        )
        .catch(() => self.clients.openWindow(d.url || '/konto')),
    );
    return;
  }
  const url = d.url || '/konto';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (c.url === url && 'focus' in c) return c.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
