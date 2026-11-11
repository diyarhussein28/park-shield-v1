import { randomBytes } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import { createHarness, resetState, subscribe, type Harness } from '../test/harness';

/** US-33: one test per rule of run_retention() (04-operations retention schedule). */
let h: Harness;
let crypto: FieldCrypto;
beforeAll(async () => {
  h = await createHarness();
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const run = () => sql`SELECT run_retention()`.execute(h.db);
const ago = (spec: string) => sql<Date>`now() - ${spec}::interval`;
const count = async (table: string) =>
  Number(
    (await sql<{ n: string }>`SELECT count(*) AS n FROM ${sql.table(table)}`.execute(h.db)).rows[0]!
      .n,
  );

let ip = 1;
async function fixture() {
  const s = await subscribe(h, `owner${ip}@example.de`);
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
  const code = crypto.decrypt(t.code_enc);
  const alert = async (message?: string) => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/v1/scan/${code}/alerts`,
      remoteAddress: `198.51.${100 + (ip++ % 100)}.7`,
      payload: {
        captcha: DEV_CAPTCHA_SOLUTION,
        lang: 'de',
        type: message ? 'custom' : 'lights_on',
        message,
      },
    });
    return res.json().alertId as string;
  };
  const user = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', `owner${ip}@example.de`)
    .executeTakeFirstOrThrow();
  ip++;
  return { userId: user.id, vehicleId: v.id as string, tokenId: v.decal.tokenId as string, alert };
}
const alertRow = (id: string) =>
  h.db.selectFrom('alerts').selectAll().where('id', '=', id).executeTakeFirst();

describe('run_retention() (US-33)', () => {
  it('nulls scanner_ref and country after 24 h, not before', async () => {
    const f = await fixture();
    const fresh = await f.alert();
    const old = await f.alert();
    await h.db
      .updateTable('alerts')
      .set({ scanner_country: 'DE', created_at: ago('25 hours') })
      .where('id', '=', old)
      .execute();
    await run();
    expect(await alertRow(old)).toMatchObject({ scanner_ref: null, scanner_country: null });
    expect((await alertRow(fresh))!.scanner_ref).not.toBeNull();
  });

  it('nulls block_ref after 30 days', async () => {
    const f = await fixture();
    const a = await f.alert();
    await h.db
      .updateTable('alerts')
      .set({ created_at: ago('29 days') })
      .where('id', '=', a)
      .execute();
    await run();
    expect((await alertRow(a))!.block_ref).not.toBeNull();
    await h.db
      .updateTable('alerts')
      .set({ created_at: ago('31 days') })
      .where('id', '=', a)
      .execute();
    await run();
    expect((await alertRow(a))!.block_ref).toBeNull();
  });

  it('removes free text after 7 days, and chat messages too', async () => {
    const f = await fixture();
    const a = await f.alert('Ihr Kofferraum steht offen');
    await h.db
      .insertInto('alert_messages')
      .values({
        alert_id: a,
        sender: 'scanner',
        body_enc: crypto.encrypt('x'),
        created_at: ago('8 days'),
      })
      .execute();
    await h.db
      .updateTable('alerts')
      .set({ created_at: ago('8 days') })
      .where('id', '=', a)
      .execute();
    await run();
    expect((await alertRow(a))!.custom_message_enc).toBeNull();
    expect(await count('alert_messages')).toBe(0);
  });

  it('deletes moderation samples after 30 days', async () => {
    const f = await fixture();
    const a = await f.alert();
    await h.db
      .insertInto('moderation_reviews')
      .values([
        { alert_id: a, rule_hit: 'phone', created_at: ago('31 days') },
        { alert_id: a, rule_hit: 'phone', created_at: ago('2 days') },
      ])
      .execute();
    await run();
    expect(await count('moderation_reviews')).toBe(1);
  });

  it('marks open alerts expired after their 2 h window', async () => {
    const f = await fixture();
    const a = await f.alert();
    await h.db
      .updateTable('alerts')
      .set({ expires_at: ago('1 minute') })
      .where('id', '=', a)
      .execute();
    await run();
    expect((await alertRow(a))!.status).toBe('expired');
  });

  it('deletes alerts after 90 days, with their deliveries', async () => {
    const f = await fixture();
    const a = await f.alert();
    await h.db
      .insertInto('alert_deliveries')
      .values({ alert_id: a, recipient: 'owner', channel: 'email', provider: 'dev' })
      .execute();
    await h.db
      .updateTable('alerts')
      .set({ created_at: ago('91 days') })
      .where('id', '=', a)
      .execute();
    await run();
    expect(await alertRow(a)).toBeUndefined();
    expect(await count('alert_deliveries')).toBe(0);
  });

  it('deletes fake-decal reports after 90 days', async () => {
    const f = await fixture();
    await h.db
      .insertInto('abuse_reports')
      .values([
        {
          kind: 'fake_decal',
          qr_token_id: f.tokenId,
          reason: 'fake_decal',
          created_at: ago('91 days'),
        },
        {
          kind: 'fake_decal',
          qr_token_id: f.tokenId,
          reason: 'fake_decal',
          created_at: ago('10 days'),
        },
      ])
      .execute();
    await run();
    expect(await count('abuse_reports')).toBe(1);
  });

  it('nulls parking locations 24 h after the session ended', async () => {
    const f = await fixture();
    await h.db
      .insertInto('parking_sessions')
      .values([
        {
          user_id: f.userId,
          location_enc: crypto.encrypt('50.94,6.95'),
          ended_at: ago('25 hours'),
        },
        { user_id: f.userId, location_enc: crypto.encrypt('50.94,6.95'), ended_at: ago('1 hour') },
      ])
      .execute();
    await run();
    const rows = await h.db
      .selectFrom('parking_sessions')
      .select('location_enc')
      .orderBy('ended_at')
      .execute();
    expect(rows.map((r) => r.location_enc === null)).toEqual([true, false]);
  });

  it('blanks shipping addresses 90 days after delivery', async () => {
    const f = await fixture();
    const order = await h.db
      .insertInto('decal_orders')
      .values({
        user_id: f.userId,
        shipping_address_enc: crypto.encrypt('{"city":"Köln"}'),
        total_gross_cents: 0,
        status: 'delivered',
        delivered_at: ago('91 days'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await run();
    const row = await h.db
      .selectFrom('decal_orders')
      .select('shipping_address_enc')
      .where('id', '=', order.id)
      .executeTakeFirstOrThrow();
    expect(row.shipping_address_enc.length).toBe(0);
  });

  it('deletes expired magic links (after 1 day) and sessions (after 7 days)', async () => {
    const f = await fixture();
    await h.db
      .insertInto('magic_link_tokens')
      .values([
        { user_id: f.userId, token_hash: randomBytes(32), expires_at: ago('2 days') },
        { user_id: f.userId, token_hash: randomBytes(32), expires_at: ago('1 hour') },
      ])
      .execute();
    const before = await count('magic_link_tokens');
    await h.db
      .insertInto('sessions')
      .values({ user_id: f.userId, token_hash: randomBytes(32), expires_at: ago('8 days') })
      .execute();
    const sessions = await count('sessions');
    await run();
    expect(await count('magic_link_tokens')).toBe(before - 1);
    expect(await count('sessions')).toBe(sessions - 1);
  });

  it('deletes expired scanner blocks and temporary modes', async () => {
    const f = await fixture();
    await h.db
      .insertInto('scanner_blocks')
      .values({
        ref: randomBytes(32),
        qr_token_id: f.tokenId,
        reason: 'owner_report',
        created_at: ago('31 days'),
        expires_at: ago('1 day'),
      })
      .execute();
    await h.db
      .insertInto('vehicle_modes')
      .values({
        vehicle_id: f.vehicleId,
        mode: 'short_stop',
        starts_at: ago('50 hours'),
        ends_at: ago('2 days'),
      })
      .execute();
    await run();
    expect(await count('scanner_blocks')).toBe(0);
    expect(await count('vehicle_modes')).toBe(0);
  });

  it('expires open vehicle transfers and deletes them after 90 days', async () => {
    const f = await fixture();
    await h.db
      .insertInto('vehicle_transfers')
      .values([
        {
          vehicle_id: f.vehicleId,
          from_user_id: f.userId,
          to_email_bidx: randomBytes(32),
          token_hash: randomBytes(32),
          expires_at: ago('1 day'),
        },
        {
          vehicle_id: f.vehicleId,
          from_user_id: f.userId,
          to_email_bidx: randomBytes(32),
          token_hash: randomBytes(32),
          status: 'accepted',
          created_at: ago('91 days'),
        },
      ])
      .execute();
    await run();
    const rows = await h.db.selectFrom('vehicle_transfers').select('status').execute();
    expect(rows).toEqual([{ status: 'expired' }]);
  });

  it('expires break-glass grants after their validity', async () => {
    const f = await fixture();
    await h.db
      .insertInto('break_glass_requests')
      .values({
        requester_id: f.userId,
        target_entity: 'vehicles.plate',
        target_id: f.vehicleId,
        reason: 'test',
        status: 'approved',
        valid_until: ago('1 minute'),
      })
      .execute();
    await run();
    expect(
      (await h.db.selectFrom('break_glass_requests').select('status').executeTakeFirstOrThrow())
        .status,
    ).toBe('expired');
  });

  it('deletes unanswered invitations of contacts and co-drivers after 14 days', async () => {
    const f = await fixture();
    const other = await subscribe(h, 'codriver@example.de');
    void other;
    const co = await h.db
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'codriver@example.de')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('emergency_contacts')
      .values({
        user_id: f.userId,
        display_name: 'Kim',
        channel: 'email',
        address_enc: crypto.encrypt('k@example.de'),
        address_bidx: randomBytes(32),
        consent_requested_at: ago('15 days'),
      })
      .execute();
    await h.db
      .insertInto('vehicle_members')
      .values({ vehicle_id: f.vehicleId, user_id: co.id, invited_at: ago('15 days') })
      .execute();
    await run();
    expect(await count('emergency_contacts')).toBe(0);
    expect(await count('vehicle_members')).toBe(0);
  });

  it('deletes unconfirmed business waitlist entries after 30 days', async () => {
    await h.db
      .insertInto('business_waitlist')
      .values([
        { company_name: 'A', contact_email: 'a@firma.de', created_at: ago('31 days') },
        {
          company_name: 'B',
          contact_email: 'b@firma.de',
          created_at: ago('31 days'),
          confirmed_at: ago('30 days'),
        },
      ])
      .execute();
    await run();
    expect(
      (await h.db.selectFrom('business_waitlist').select('company_name').execute()).map(
        (r) => r.company_name,
      ),
    ).toEqual(['B']);
  });

  it('deletes never-verified sign-ups after 24 h', async () => {
    await h.db
      .insertInto('users')
      .values([
        { email: 'old@example.de', created_at: ago('25 hours') },
        { email: 'new@example.de', created_at: ago('1 hour') },
      ])
      .execute();
    await run();
    const left = await h.db
      .selectFrom('users')
      .select('email')
      .where('email', 'in', ['old@example.de', 'new@example.de'])
      .execute();
    expect(left.map((u) => u.email)).toEqual(['new@example.de']);
  });

  it('deletes provider health events after 90 days and processed outbox events after 7 days', async () => {
    // Not reset between tests: tag the rows of this test.
    const marker = `retention-${randomBytes(4).toString('hex')}`;
    await h.db
      .insertInto('provider_status_events')
      .values([
        { provider: 'brevo', metric: marker, value: '0.1', captured_at: ago('91 days') },
        { provider: 'brevo', metric: marker, value: '0.1' },
      ])
      .execute();
    await h.db
      .insertInto('outbox_events')
      .values([
        { topic: 't', payload: '{}', processed_at: ago('8 days') },
        { topic: 't', payload: '{}', processed_at: ago('1 day') },
        { topic: 't', payload: '{}', available_at: ago('30 days') }, // never processed: kept
      ])
      .execute();
    await run();
    const events = await h.db
      .selectFrom('provider_status_events')
      .select('id')
      .where('metric', '=', marker)
      .execute();
    expect(events).toHaveLength(1);
    expect(await count('outbox_events')).toBe(2);
  });

  it('deletes audit entries after 12 months, never younger ones', async () => {
    const marker = `retention-${randomBytes(4).toString('hex')}`;
    await h.db
      .insertInto('audit_logs')
      .values([
        { action: marker, entity: 'test', created_at: ago('13 months') },
        { action: marker, entity: 'test', created_at: ago('11 months') },
      ])
      .execute();
    // Only rows already copied to the locked bucket may go (US-42): mark everything as streamed.
    const { cursor } = await h.db
      .selectFrom('audit_stream_state')
      .select((eb) => eb.ref('last_id').as('cursor'))
      .executeTakeFirstOrThrow();
    await sql`UPDATE audit_stream_state SET last_id = (SELECT max(id) FROM audit_logs)`.execute(
      h.db,
    );
    await run();
    await sql`UPDATE audit_stream_state SET last_id = ${cursor}`.execute(h.db);
    const rows = await h.db
      .selectFrom('audit_logs')
      .select('created_at')
      .where('action', '=', marker)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('removes accounts due for deletion only once automated processor steps are done', async () => {
    const f = await fixture();
    await h.db
      .updateTable('users')
      .set({ status: 'pending_deletion', deletion_due_at: ago('1 hour') })
      .where('id', '=', f.userId)
      .execute();
    const dsr = await h.db
      .insertInto('data_subject_requests')
      .values({ user_id: f.userId, type: 'erasure', status: 'in_progress' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await h.db
      .insertInto('dsr_processor_steps')
      .values([
        { dsr_id: dsr.id, processor: 'parkshield_db', automated: true },
        { dsr_id: dsr.id, processor: 'stripe', automated: true },
        { dsr_id: dsr.id, processor: 'zammad', automated: false },
      ])
      .execute();
    await run();
    expect(
      await h.db.selectFrom('users').select('id').where('id', '=', f.userId).executeTakeFirst(),
    ).toBeDefined();
    await h.db
      .updateTable('dsr_processor_steps')
      .set({ status: 'done' })
      .where('processor', '=', 'stripe')
      .execute();
    await run();
    expect(
      await h.db.selectFrom('users').select('id').where('id', '=', f.userId).executeTakeFirst(),
    ).toBeUndefined();
    // The request itself stays (accountability), open until the manual Zammad step is done.
    expect(
      await h.db
        .selectFrom('data_subject_requests')
        .select(['user_id', 'status'])
        .executeTakeFirstOrThrow(),
    ).toEqual({ user_id: null, status: 'in_progress' });
  });
});
