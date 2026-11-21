import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ViewTokenService } from '../alert-media/view-token.service';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appPushes,
  createHarness,
  mailbox,
  registerAppDevice,
  resetState,
  smsInbox,
  subscribe,
  type Harness,
} from '../test/harness';
import { DispatchService } from './dispatch.service';

let h: Harness;
let crypto: FieldCrypto;

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const OWNER = 'owner@example.de';

async function vehicleWithCode(email = OWNER) {
  const s = await subscribe(h, email);
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
  return { s, v, code: crypto.decrypt(t.code_enc) };
}

let ipCounter = 1;
async function alert(code: string, type = 'lights_on', message?: string) {
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress: `198.51.${100 + (ipCounter++ % 100)}.7`,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type, ...(message ? { message } : {}) },
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { alertId: string; statusToken: string };
}

const status = (a: { alertId: string; statusToken: string }) =>
  h.app
    .inject({
      method: 'GET',
      url: `/v1/alerts/${a.alertId}/status`,
      headers: { 'x-status-token': a.statusToken },
    })
    .then((r) => r.json());

const ownerChannels = (alertId: string) =>
  h.db
    .selectFrom('alert_deliveries')
    .select(['channel', 'status', 'suppressed_reason'])
    .where('alert_id', '=', alertId)
    .where('recipient', '=', 'owner')
    .orderBy('queued_at')
    .execute();

/**
 * The reply token as the owner gets it now: the view page (/v/<token>, linked from the escalation SMS)
 * hands out the armed reply token.
 */
async function replyToken(alertId: string): Promise<string> {
  const view = h.app.get(ViewTokenService).tokenFor(alertId);
  const res = await h.app.inject({ method: 'GET', url: `/v1/alerts/view/${view}` });
  expect(res.statusCode, res.body).toBe(200);
  const token = res.json().replyToken as string | null;
  if (!token) throw new Error('no armed reply token');
  return token;
}
const reply = (token: string, r: string) =>
  h.app.inject({ method: 'POST', url: '/v1/ack', payload: { token, reply: r } });

describe('channel matrix (owner decision 2026-11-21: app push only)', () => {
  it('an alert goes to the app only: no e-mail, no web push, no SMS', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, OWNER);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect((await ownerChannels(a.alertId)).map((d) => `${d.channel}:${d.status}`)).toEqual([
      'native_push:sent',
    ]);
    expect(await smsInbox(h)).toHaveLength(0);
    expect((await mailbox(h)).filter((m) => m.tag.startsWith('alert_'))).toHaveLength(0);
  });

  it('without an app device nothing is sent at once (the SMS follows after 30 minutes)', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(await ownerChannels(a.alertId)).toEqual([]);
    expect(await smsInbox(h)).toHaveLength(0);
    expect((await mailbox(h)).filter((m) => m.tag.startsWith('alert_'))).toHaveLength(0);
    const row = await h.db
      .selectFrom('alerts')
      .select(['status', 'sms_due_at'])
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('dispatched');
    expect(row.sms_due_at).not.toBeNull();
  });

  it('the app push carries a generic text and only the alert id and kind', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, OWNER);
    const a = await alert(code, 'custom', 'Ihr Licht brennt, Herr Meier');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const push = (await appPushes(h))[0]!.body.message;
    expect(push.notification).toEqual({
      title: 'ParkShield',
      body: 'Neue Warnung zu Ihrem Fahrzeug. Tippen Sie für Details.',
    });
    expect(push.data).toEqual({ alertId: a.alertId, kind: 'alert' });
    expect(push.data).not.toHaveProperty('type');
    expect(JSON.stringify(push)).not.toMatch(
      /Meier|Licht|Eigene Nachricht|custom|Der Blaue|K-AB|owner@example|jpg|\/v\//,
    );
    expect(push.apns.headers['apns-push-type']).toBe('alert');
    expect(push.apns.payload.aps.category).toBe('PS_ALERT');
    expect(push.android).toMatchObject({ priority: 'NORMAL' });
  });

  it('removes an app device FCM reports as unregistered', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, OWNER, 'invalid-token-0000000000001');
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    expect(await h.db.selectFrom('user_devices').selectAll().execute()).toHaveLength(0);
    expect((await ownerChannels(a.alertId))[0]).toMatchObject({
      channel: 'native_push',
      status: 'failed',
    });
  });
});

describe('quick replies and „Ich komme" (US-23, NT-02, NT-10)', () => {
  it('records "Ich komme" from the view page link once and shows it to the scanner', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken(a.alertId);

    // Opening the page (preview) changes nothing.
    const preview = await h.app.inject({
      method: 'POST',
      url: '/v1/ack/preview',
      payload: { token },
    });
    expect(preview.json()).toMatchObject({
      nickname: 'Der Blaue',
      answered: false,
      expired: false,
    });
    expect((await status(a)).status).toBe('dispatched');

    const r = await reply(token, 'coming');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ reply: 'coming', escalating: false });
    expect(await status(a)).toMatchObject({
      status: 'acknowledged',
      ownerReply: 'coming',
      acknowledgedBy: 'owner',
    });

    const again = await reply(token, 'not_nearby');
    expect(again.statusCode).toBe(409);
    expect(again.json()).toEqual({ error: 'already_answered', reply: 'coming' });
    expect((await reply('x'.repeat(43), 'coming')).statusCode).toBe(404);
  });

  it('"seen" in the app is not an answer; "Ich komme" in the app is, once', async () => {
    const { code } = await vehicleWithCode();
    const app = await registerAppDevice(h, OWNER);
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken(a.alertId);
    const seen = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/seen`,
      headers: app,
    });
    expect(seen.statusCode).toBe(200);
    expect(await status(a)).toMatchObject({ status: 'delivered', ownerReply: null });
    expect((await status(a)).seenAt).not.toBeNull();
    const ack = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/ack`,
      headers: app,
      payload: {},
    });
    expect(ack.json()).toEqual({ reply: 'coming', escalating: false });
    const twice = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${a.alertId}/ack`,
      headers: app,
      payload: {},
    });
    expect(twice.statusCode).toBe(409);
    // The view page link is spent too.
    expect((await reply(token, 'coming')).statusCode).toBe(409);
  });

  it('stops working when the alert expires', async () => {
    const { code } = await vehicleWithCode();
    const a = await alert(code);
    await h.app.get(DispatchService).dispatch(a.alertId);
    const token = await replyToken(a.alertId);
    await sql`UPDATE alerts SET expires_at = now() - interval '1 minute', ack_token_expires_at = now() - interval '1 minute'`.execute(
      h.db,
    );
    expect((await reply(token, 'coming')).statusCode).toBe(410);
  });

  it('the reminder after "Ich warte noch" is an app push and brings a fresh reply token', async () => {
    const { code } = await vehicleWithCode();
    await registerAppDevice(h, OWNER);
    const a = await alert(code, 'blocking');
    await h.app.get(DispatchService).dispatch(a.alertId);
    const first = await replyToken(a.alertId);
    await reply(first, 'in_30_min');
    await sql`UPDATE alerts SET acknowledged_at = now() - interval '16 minutes'`.execute(h.db);
    const w = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/${a.alertId}/waiting`,
      headers: { 'x-status-token': a.statusToken },
    });
    expect(w.statusCode).toBe(200);
    await h.app.get(DispatchService).followup(a.alertId);
    const pushes = (await appPushes(h)).filter((p) => p.body.message.data.kind === 'followup');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.body.message.data).toEqual({ alertId: a.alertId, kind: 'followup' });
    const fresh = await replyToken(a.alertId);
    expect(fresh).not.toBe(first);
    expect((await reply(fresh, 'coming')).json()).toEqual({ reply: 'coming', escalating: false });
    expect(await smsInbox(h)).toHaveLength(0);
    expect((await mailbox(h)).filter((m) => m.tag.startsWith('alert_'))).toHaveLength(0);
  });
});
