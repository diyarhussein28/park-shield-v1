import { generateRequestDetails, sendNotification, setVapidDetails, WebPushError } from 'web-push';
import type { PushSender, PushTarget } from './ports';

/** Push services browsers actually use. Endpoints come from clients, so anything else is refused (SSRF). */
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)push\.apple\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function allowedPushEndpoint(endpoint: string, allowLocal: boolean): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (
    allowLocal &&
    url.protocol === 'http:' &&
    (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  ) {
    return true;
  }
  return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname));
}

export class VapidPushSender implements PushSender {
  constructor(
    subject: string,
    publicKey: string,
    privateKey: string,
    /** Local dev/test only: allow the plain-HTTP push receiver on loopback. */
    private readonly allowLocal = false,
  ) {
    setVapidDetails(subject, publicKey, privateKey);
  }

  async send(
    target: PushTarget,
    payload: string,
    opts: { ttlSeconds: number; urgency: 'normal' | 'high' },
  ): Promise<{ statusCode: number }> {
    if (!allowedPushEndpoint(target.endpoint, this.allowLocal)) return { statusCode: 400 };
    const subscription = {
      endpoint: target.endpoint,
      keys: { p256dh: target.p256dh, auth: target.auth },
    };
    if (target.endpoint.startsWith('http:')) {
      // web-push only speaks HTTPS; the encrypted request is built the same way and sent with fetch.
      const req = generateRequestDetails(subscription, payload, {
        TTL: opts.ttlSeconds,
        urgency: opts.urgency,
      });
      try {
        const res = await fetch(req.endpoint, {
          method: req.method,
          headers: req.headers as Record<string, string>,
          body: req.body as Buffer,
          signal: AbortSignal.timeout(10_000),
        });
        return { statusCode: res.status };
      } catch {
        return { statusCode: 0 };
      }
    }
    try {
      const r = await sendNotification(subscription, payload, {
        TTL: opts.ttlSeconds,
        urgency: opts.urgency,
        timeout: 10_000,
      });
      return { statusCode: r.statusCode };
    } catch (err) {
      if (err instanceof WebPushError) return { statusCode: err.statusCode };
      return { statusCode: 0 }; // network error: counts as a failure, not as an expired subscription
    }
  }
}
