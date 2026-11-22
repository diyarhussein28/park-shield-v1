import { createSign } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { randomToken } from '../core/crypto';
import type { AppPushMessage, AppPushResult, AppPushSender } from './ports';

export const DEV_APP_PUSH_KEY = 'dev:app-push';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** FCM error codes that mean the token will never work again: the device is removed. */
const GONE = new Set(['UNREGISTERED', 'INVALID_ARGUMENT', 'SENDER_ID_MISMATCH']);

/**
 * The FCM HTTP v1 request body. Exported for tests: the payload must never carry the scanner's message,
 * a photo, the licence plate or a name (only a generic text and ids), because FCM is a Google service.
 */
export function fcmBody(msg: AppPushMessage) {
  const expiry = Math.floor(Date.now() / 1000) + msg.ttlSeconds;
  return {
    message: {
      token: msg.token,
      notification: { title: msg.title, body: msg.body },
      data: msg.data,
      android: {
        priority: msg.urgent ? 'HIGH' : 'NORMAL',
        ttl: `${msg.ttlSeconds}s`,
        ...(msg.collapseKey ? { collapse_key: msg.collapseKey } : {}),
        notification: {
          channel_id: 'alerts',
          ...(msg.collapseKey ? { tag: msg.collapseKey } : {}),
          ...(msg.category ? { click_action: msg.category } : {}),
          ...(msg.badge !== undefined ? { notification_count: msg.badge } : {}),
        },
      },
      apns: {
        headers: {
          'apns-priority': msg.urgent ? '10' : '5',
          'apns-push-type': 'alert',
          'apns-expiration': String(expiry),
          ...(msg.collapseKey ? { 'apns-collapse-id': msg.collapseKey } : {}),
        },
        payload: {
          aps: {
            sound: 'default',
            // Critical Alerts need a special Apple entitlement and are not used.
            'interruption-level': msg.urgent ? 'time-sensitive' : 'active',
            ...(msg.category ? { category: msg.category } : {}),
            ...(msg.collapseKey ? { 'thread-id': msg.collapseKey } : {}),
            ...(msg.badge !== undefined ? { badge: msg.badge } : {}),
          },
          // expo-notifications on iOS reads a remote notification's data only from `body` (the Expo
          // push format), not from the top-level keys FCM puts `data` in. Without it a tap and the
          // „Ich komme" action do not know the alert. The same ids, nothing more.
          body: msg.data,
        },
      },
    },
  };
}

/** Firebase Cloud Messaging HTTP v1 with a service account (OAuth2 JWT bearer, RS256). */
export class FcmSender implements AppPushSender {
  private accessToken: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly clientEmail: string,
    privateKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.privateKey = privateKey.replace(/\\n/g, '\n');
  }

  private readonly privateKey: string;

  private async token(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.clientEmail,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.privateKey, 'base64url');
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${signature}`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!res.ok || !body.access_token) throw new Error(`FCM auth failed with HTTP ${res.status}`);
    this.accessToken = {
      value: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }

  async send(msg: AppPushMessage): Promise<AppPushResult> {
    const res = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.projectId)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.token()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(fcmBody(msg)),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await res.json().catch(() => ({}))) as {
      name?: string;
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    if (res.ok && body.name) return { ok: true, messageId: body.name };
    const code =
      body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status ?? 'unknown';
    return { ok: false, invalidToken: res.status === 404 || GONE.has(code), error: code };
  }
}

/** Local fake: app pushes land in the dev inbox (and tests read them) instead of going to Google. */
export class DevAppPushSender implements AppPushSender {
  constructor(
    private readonly valkey: Redis,
    private readonly logger: Logger,
  ) {}

  async send(msg: AppPushMessage): Promise<AppPushResult> {
    // Tokens starting with "invalid" behave like a device that uninstalled the app (tests, demos).
    if (msg.token.startsWith('invalid')) {
      return { ok: false, invalidToken: true, error: 'UNREGISTERED' };
    }
    const messageId = `projects/dev/messages/${randomToken(12)}`;
    await this.valkey
      .multi()
      .lpush(
        DEV_APP_PUSH_KEY,
        JSON.stringify({ body: fcmBody(msg), messageId, sentAt: new Date().toISOString() }),
      )
      .ltrim(DEV_APP_PUSH_KEY, 0, 99)
      .exec();
    this.logger.info({ kind: msg.data.kind }, 'dev app push stored in local inbox');
    return { ok: true, messageId };
  }
}
