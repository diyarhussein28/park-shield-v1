import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appSignIn,
  createHarness,
  mailbox,
  resetState,
  subscribe,
  type Harness,
} from '../test/harness';

let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

async function ownerWithAlert(message?: string) {
  const s = await subscribe(h, OWNER);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: s.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${crypto.decrypt(t.code_enc)}/alerts`,
    remoteAddress: '198.51.100.5',
    payload: {
      captcha: DEV_CAPTCHA_SOLUTION,
      lang: 'de',
      type: message ? 'custom' : 'blocking',
      ...(message ? { message } : {}),
    },
  });
  expect(res.statusCode).toBe(201);
  return { s, alertId: res.json().alertId as string };
}

describe('native app API (/v1/app)', () => {
  it('signs in with a magic link that opens the app and returns a bearer token (no cookie)', async () => {
    await subscribe(h, OWNER);
    const r = await h.app.inject({
      method: 'POST',
      url: '/v1/app/auth/magic-link',
      payload: { email: OWNER, locale: 'de' },
    });
    expect(r.statusCode).toBe(202);
    const mail = (await mailbox(h)).find((m) => m.tag === 'magic_link')!;
    expect(mail.text).toMatch(/\/app\/anmelden#t=[A-Za-z0-9_-]+/);
    const token = /#t=([A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
    const consumed = await h.app.inject({
      method: 'POST',
      url: '/v1/app/auth/consume',
      payload: { token, platform: 'android' },
    });
    expect(consumed.statusCode).toBe(200);
    expect(consumed.cookies).toHaveLength(0);
    expect(consumed.json().token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Single use.
    const again = await h.app.inject({
      method: 'POST',
      url: '/v1/app/auth/consume',
      payload: { token },
    });
    expect(again.statusCode).toBe(401);
    // A bearer request needs no CSRF token; a wrong bearer is refused.
    const me = await h.app.inject({
      method: 'GET',
      url: '/v1/app/alerts',
      headers: { authorization: `Bearer ${consumed.json().token}` },
    });
    expect(me.statusCode).toBe(200);
    const bad = await h.app.inject({
      method: 'GET',
      url: '/v1/app/alerts',
      headers: { authorization: `Bearer ${'x'.repeat(43)}` },
    });
    expect(bad.statusCode).toBe(401);
  });

  it('registers a device (upsert by token, moves between accounts) and removes it on logout', async () => {
    await subscribe(h, OWNER);
    const app = await appSignIn(h, OWNER);
    const reg = (headers: { authorization: string }, platform = 'ios') =>
      h.app.inject({
        method: 'POST',
        url: '/v1/app/devices/register',
        headers,
        payload: { fcmToken: 'fcm-device-token-000000000001', platform, appVersion: '1.2.0' },
      });
    expect((await reg(app)).statusCode).toBe(200);
    expect((await reg(app, 'android')).statusCode).toBe(200);
    const rows = await h.db.selectFrom('user_devices').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ platform: 'android', app_version: '1.2.0' });
    // No fingerprint, no advertising id: only these columns exist.
    expect(Object.keys(rows[0]!).sort()).toEqual(
      [
        'app_version',
        'created_at',
        'failed_count',
        'fcm_token',
        'id',
        'last_seen_at',
        'locale',
        'platform',
        'user_id',
      ].sort(),
    );

    await subscribe(h, 'other@example.de');
    const other = await appSignIn(h, 'other@example.de');
    await reg(other);
    const moved = await h.db.selectFrom('user_devices').select('user_id').executeTakeFirstOrThrow();
    const otherId = await h.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'other@example.de')
      .executeTakeFirstOrThrow();
    expect(moved.user_id).toBe(otherId.id);

    const del = await h.app.inject({
      method: 'DELETE',
      url: '/v1/app/devices/fcm-device-token-000000000001',
      headers: other,
    });
    expect(del.statusCode).toBe(200);
    expect(await h.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(0);
  });

  it('lists alerts and shows the detail with message, seen and push readiness; never another owner’s', async () => {
    const { alertId } = await ownerWithAlert('Bitte Auto wegfahren');
    await h.app.get(DispatchService).dispatch(alertId);
    const app = await appSignIn(h, OWNER);
    const list = (
      await h.app.inject({ method: 'GET', url: '/v1/app/alerts', headers: app })
    ).json();
    expect(list.pushReady).toBe(false);
    expect(list.alerts).toHaveLength(1);
    expect(list.alerts[0]).toMatchObject({
      id: alertId,
      type: { code: 'custom' },
      vehicle: { nickname: 'Der Blaue' },
      chatStatus: 'locked',
      seenAt: null,
    });
    const detail = (
      await h.app.inject({ method: 'GET', url: `/v1/app/alerts/${alertId}`, headers: app })
    ).json();
    expect(detail).toMatchObject({
      message: 'Bitte Auto wegfahren',
      acknowledgedBy: null,
      chat: { status: 'locked', canOpen: true },
    });
    expect(JSON.stringify(detail)).not.toContain('K-AB');

    await subscribe(h, 'other@example.de');
    const other = await appSignIn(h, 'other@example.de');
    for (const [method, url] of [
      ['GET', `/v1/app/alerts/${alertId}`],
      ['POST', `/v1/app/alerts/${alertId}/seen`],
      ['POST', `/v1/app/alerts/${alertId}/ack`],
      ['POST', `/v1/app/alerts/${alertId}/chat/open`],
      ['GET', `/v1/app/alerts/${alertId}/media/00000000-0000-4000-8000-000000000000`],
    ] as const) {
      const r = await h.app.inject({ method, url, headers: other, payload: {} });
      expect(r.statusCode, url).toBe(404);
    }
    expect(
      (await h.app.inject({ method: 'GET', url: '/v1/app/alerts', headers: other })).json().alerts,
    ).toHaveLength(0);
  });

  it('a denied notification permission sends one e-mail hint a day', async () => {
    await subscribe(h, OWNER);
    const app = await appSignIn(h, OWNER);
    const deny = () =>
      h.app.inject({
        method: 'POST',
        url: '/v1/app/push-denied',
        headers: app,
        payload: { platform: 'ios' },
      });
    expect((await deny()).json()).toEqual({ mailed: true });
    expect((await deny()).json()).toEqual({ mailed: false });
    const mails = (await mailbox(h)).filter((m) => m.tag === 'push_denied');
    expect(mails).toHaveLength(1);
    expect(mails[0]!.text).toContain('Ihrem iPhone keine Mitteilungen erlaubt');
  });

  it('requires a session for every app route', async () => {
    for (const [method, url] of [
      ['GET', '/v1/app/alerts'],
      ['POST', '/v1/app/devices/register'],
      ['GET', '/v1/app/escalation'],
      ['GET', '/v1/app/emergency-contacts'],
    ] as const) {
      expect((await h.app.inject({ method, url, payload: {} })).statusCode, url).toBe(401);
    }
  });
});
