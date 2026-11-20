import type { AddressInfo } from 'node:net';
import { sql } from 'kysely';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import {
  appPushes,
  appSignIn,
  createHarness,
  resetState,
  setSetting,
  subscribe,
  type Harness,
} from '../test/harness';
import { CHAT_PATH } from './chat.gateway';
import { ChatService, looksPersonal } from './chat.service';

let h: Harness;
let crypto: FieldCrypto;
let base = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
  await h.app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(h.app.getHttpServer().address() as AddressInfo).port}`;
});
afterAll(() => h.close());
beforeEach(() => resetState(h));
afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  // Let the server finish its disconnect handlers (presence) before the next reset.
  await new Promise((r) => setTimeout(r, 250));
});

const OWNER = 'owner@example.de';

async function setup() {
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
    remoteAddress: '198.51.100.21',
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'blocking' },
  });
  expect(res.statusCode).toBe(201);
  const alert = res.json() as { alertId: string; statusToken: string; chatToken: string };
  const app = await appSignIn(h, OWNER);
  return { alert, app, session: app.authorization.slice('Bearer '.length) };
}

/** A socket and a recorder of every event it receives. */
function client(auth: Record<string, unknown>) {
  const socket = connect(`${base}/chat`, {
    path: CHAT_PATH,
    addTrailingSlash: false,
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
  sockets.push(socket);
  const events: { name: string; data: unknown }[] = [];
  socket.onAny((name: string, data: unknown) => events.push({ name, data }));
  const next = (name: string, timeoutMs = 3000) =>
    new Promise<unknown>((resolve, reject) => {
      const seen = events.find((e) => e.name === name);
      if (seen) {
        events.splice(events.indexOf(seen), 1);
        return resolve(seen.data);
      }
      const t = setTimeout(() => reject(new Error(`no ${name} within ${timeoutMs} ms`)), timeoutMs);
      socket.once(name, (data: unknown) => {
        clearTimeout(t);
        const i = events.findIndex((e) => e.name === name && e.data === data);
        if (i >= 0) events.splice(i, 1);
        resolve(data);
      });
    });
  const send = (text: string) =>
    new Promise<{ ok: boolean; error?: string }>((resolve) =>
      socket.emit('chat:message', { text }, resolve),
    );
  return { socket, events, next, send };
}

const scanner = (a: { alertId: string; chatToken: string }) =>
  client({ role: 'scanner', alertId: a.alertId, token: a.chatToken, lang: 'de' });
const owner = (alertId: string, session: string) => client({ role: 'owner', alertId, session });

const openChat = (alertId: string, app: { authorization: string }) =>
  h.app.inject({ method: 'POST', url: `/v1/app/alerts/${alertId}/chat/open`, headers: app });

describe('owner-initiated live chat (Socket.io /chat)', () => {
  it('refuses a wrong token, a foreign owner and the query string', async () => {
    const { alert } = await setup();
    const refused = (c: ReturnType<typeof client>) =>
      new Promise<Error>((r) => c.socket.once('connect_error', r));
    const bad = client({ role: 'scanner', alertId: alert.alertId, token: 'x'.repeat(43) });
    expect((await refused(bad)).message).toBe('unauthorized');

    await subscribe(h, 'other@example.de');
    const otherApp = await appSignIn(h, 'other@example.de');
    const foreign = owner(alert.alertId, otherApp.authorization.slice(7));
    expect((await refused(foreign)).message).toBe('unauthorized');

    // Credentials only count in the handshake's auth payload, never in the query string.
    const query = connect(`${base}/chat`, {
      path: CHAT_PATH,
      addTrailingSlash: false,
      query: { role: 'scanner', alertId: alert.alertId, token: alert.chatToken },
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
    });
    sockets.push(query);
    expect((await new Promise<Error>((r) => query.once('connect_error', r))).message).toBe(
      'unauthorized',
    );
  });

  it('is locked until the owner opens it; then text both ways, typing and seen', async () => {
    const { alert, app, session } = await setup();
    const sc = scanner(alert);
    const state = (await sc.next('chat:state')) as { status: string; messages: unknown[] };
    expect(state).toMatchObject({ status: 'locked', messages: [] });
    expect(await sc.send('Hallo?')).toEqual({ ok: false, error: 'chat_not_active' });

    const opened = await openChat(alert.alertId, app);
    expect(opened.statusCode).toBe(200);
    expect(opened.json()).toMatchObject({ status: 'active', remaining: 20 });
    expect(await sc.next('chat:opened')).toMatchObject({ status: 'active' });

    const ow = owner(alert.alertId, session);
    const ownerState = (await ow.next('chat:state')) as { quickReplies: string[] };
    expect(ownerState.quickReplies).toContain('Ich bin in 2 Minuten am Fahrzeug.');

    expect((await ow.send('Ich bin in 2 Minuten am Fahrzeug.')).ok).toBe(true);
    expect(await sc.next('chat:message')).toMatchObject({
      from: 'owner',
      text: 'Ich bin in 2 Minuten am Fahrzeug.',
    });
    // Everyone in the room gets every message, the sender too (its own copy confirms it).
    expect(await ow.next('chat:message')).toMatchObject({ from: 'owner' });
    expect((await sc.send('Danke, ich warte.')).ok).toBe(true);
    expect(await ow.next('chat:message')).toMatchObject({
      from: 'scanner',
      text: 'Danke, ich warte.',
    });

    sc.socket.emit('chat:typing', { typing: true });
    expect(await ow.next('chat:typing')).toEqual({ from: 'scanner', typing: true });
    ow.socket.emit('chat:seen');
    expect(await sc.next('chat:seen')).toMatchObject({ by: 'owner' });

    // Stored encrypted, never in clear.
    const rows = await h.db.selectFrom('alert_messages').select(['sender', 'body_enc']).execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => !r.body_enc.toString('latin1').includes('warte'))).toBe(true);
  });

  it('filters scanner text (links, numbers, addresses); owner text only gets a warning in the app', async () => {
    const { alert, app, session } = await setup();
    await openChat(alert.alertId, app);
    const sc = scanner(alert);
    await sc.next('chat:state');
    const ow = owner(alert.alertId, session);
    await ow.next('chat:state');
    expect(await sc.send('Ruf mich an: 0151 23456789')).toEqual({ ok: false, error: 'filtered' });
    expect(await sc.send('Schau hier www.example.com')).toEqual({ ok: false, error: 'filtered' });
    expect(await sc.next('chat:error')).toEqual({ error: 'filtered' });
    expect((await ow.send('Meine Nummer: 0151 23456789')).ok).toBe(true);
    expect(looksPersonal('Meine Nummer: 0151 23456789')).toBe(true);
    expect(looksPersonal('Hauptstraße 12')).toBe(true);
    expect(looksPersonal('Ich komme sofort.')).toBe(false);
    const stored = await h.db.selectFrom('alert_messages').select('sender').execute();
    expect(stored.map((r) => r.sender)).toEqual(['owner']);
  });

  it('enforces 500 characters and N messages per side', async () => {
    await setSetting(h, 'chat.max_messages_per_side', 2);
    const { alert, app } = await setup();
    await openChat(alert.alertId, app);
    const sc = scanner(alert);
    await sc.next('chat:state');
    expect(await sc.send('x'.repeat(501))).toEqual({ ok: false, error: 'too_long' });
    expect((await sc.send('eins')).ok).toBe(true);
    expect((await sc.send('zwei')).ok).toBe(true);
    expect(await sc.send('drei')).toEqual({ ok: false, error: 'limit_reached' });
  });

  it('a blocked sender: the chat cannot be opened', async () => {
    const { alert, app } = await setup();
    const a = await h.db
      .selectFrom('alerts')
      .select(['block_ref', 'qr_token_id'])
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('scanner_blocks')
      .values({
        ref: a.block_ref!,
        qr_token_id: a.qr_token_id,
        reason: 'owner_block',
        expires_at: new Date(Date.now() + 86_400_000),
      })
      .execute();
    const r = await openChat(alert.alertId, app);
    expect(r.statusCode).toBe(403);
    expect(r.json().error).toBe('sender_blocked');
    const detail = (
      await h.app.inject({ method: 'GET', url: `/v1/app/alerts/${alert.alertId}`, headers: app })
    ).json();
    expect(detail.chat).toMatchObject({ status: 'locked', canOpen: false, senderBlocked: true });
  });

  it('shows presence to the owner and pushes new scanner messages without their text', async () => {
    const { alert, app } = await setup();
    await h.app.inject({
      method: 'POST',
      url: '/v1/app/devices/register',
      headers: app,
      payload: { fcmToken: 'fcm-token-chat-000000000001', platform: 'android' },
    });
    const detail = async () =>
      (
        await h.app.inject({ method: 'GET', url: `/v1/app/alerts/${alert.alertId}`, headers: app })
      ).json();
    expect((await detail()).chat.scanner.online).toBe(false);
    const sc = scanner(alert);
    await sc.next('chat:state');
    expect((await detail()).chat.scanner.online).toBe(true);
    await openChat(alert.alertId, app);
    expect((await sc.send('Bin noch am Auto')).ok).toBe(true);
    // The push goes out right after the message (the owner's app is not connected).
    let push: Awaited<ReturnType<typeof appPushes>>[number] | undefined;
    for (let i = 0; i < 20 && !push; i++) {
      push = (await appPushes(h)).find((p) => p.body.message.data.kind === 'chat');
      if (!push) await new Promise((r) => setTimeout(r, 100));
    }
    if (!push) throw new Error('no chat push');
    expect(push.body.message.notification.body).toBe('Neue Nachricht im Chat zu Ihrem Alarm');
    expect(JSON.stringify(push)).not.toContain('Auto');
    sc.socket.disconnect();
    await new Promise((r) => setTimeout(r, 300));
    const after = (await detail()).chat.scanner;
    expect(after.online).toBe(false);
    expect(after.lastSeenAt).not.toBeNull();
  });

  it('closes on the owner’s „Erledigt", after 20 minutes without a message, or 3 hours after opening', async () => {
    const { alert, app } = await setup();
    await openChat(alert.alertId, app);
    const sc = scanner(alert);
    await sc.next('chat:state');
    const closed = await h.app.inject({
      method: 'POST',
      url: `/v1/app/alerts/${alert.alertId}/chat/close`,
      headers: app,
    });
    expect(closed.json()).toMatchObject({ status: 'closed', closeReason: 'owner' });
    expect(await sc.next('chat:closed')).toEqual({ reason: 'owner' });
    expect(await sc.send('Hallo?')).toEqual({ ok: false, error: 'chat_not_active' });
    expect((await openChat(alert.alertId, app)).statusCode).toBe(409);

    // Timeouts, through the sweeper.
    const chat = h.app.get(ChatService);
    const second = await setupAnother();
    await openChat(second.alertId, app);
    await sql`UPDATE chat_sessions SET last_message_at = now() - interval '21 minutes'
      WHERE alert_id = ${second.alertId}`.execute(h.db);
    const third = await setupAnother();
    await openChat(third.alertId, app);
    await sql`UPDATE chat_sessions SET opened_at = now() - interval '181 minutes'
      WHERE alert_id = ${third.alertId}`.execute(h.db);
    const swept = await chat.sweep();
    expect(
      swept.map((x) => `${x.alertId === second.alertId ? 'second' : 'third'}:${x.reason}`).sort(),
    ).toEqual(['second:inactivity', 'third:max_duration']);
    expect(await chat.sweep()).toEqual([]);
  });
});

let extra = 0;
/** Another alert on the owner's vehicle (same app session). */
async function setupAnother() {
  const t = await h.db.selectFrom('qr_tokens').select('code_enc').executeTakeFirstOrThrow();
  const res = await h.app.inject({
    method: 'POST',
    url: `/v1/scan/${crypto.decrypt(t.code_enc)}/alerts`,
    remoteAddress: `192.0.2.${10 + extra++}`,
    payload: { captcha: DEV_CAPTCHA_SOLUTION, lang: 'de', type: 'blocking' },
  });
  expect(res.statusCode).toBe(201);
  return res.json() as { alertId: string; chatToken: string };
}
