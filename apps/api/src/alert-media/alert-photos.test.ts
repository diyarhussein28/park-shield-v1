import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FieldCrypto } from '../core/crypto';
import { CRYPTO } from '../core/tokens';
import { DispatchService } from '../notifications/dispatch.service';
import { DEV_CAPTCHA_SOLUTION } from '../providers/captcha';
import { DEV_SMS_KEY } from '../providers/twilio-sms';
import {
  createHarness,
  makePremium,
  lastMail,
  resetState,
  setSetting,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import { AlertMediaService } from './alert-media.service';
import { ViewTokenService } from './view-token.service';

/**
 * Phase 2 alert photos, end to end through the public API: scan with 2 photos, the same view link in
 * every channel, the view page and photo stream, "Missbrauch melden", and the 30-day retention rule.
 */
const MEDIA_DIR = join(tmpdir(), `ps-alert-media-${process.pid}`);
let h: Harness;
let crypto: FieldCrypto;
let ip = 1;
const nextIp = () => `203.0.${(ip++ % 200) + 10}.9`;

beforeAll(async () => {
  h = await createHarness({ ALERT_PHOTOS_ENABLED: 'true', ALERT_MEDIA_DIR: MEDIA_DIR });
  crypto = h.app.get<FieldCrypto>(CRYPTO);
});
afterAll(async () => {
  await h.close();
  await rm(MEDIA_DIR, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetState(h);
  await rm(MEDIA_DIR, { recursive: true, force: true });
  // The test owner buys Plus; photos are a per-plan setting (default Premium only).
  await setSetting(h, 'photos.plans', ['premium']);
});

const jpeg = (color = '#3366cc') =>
  sharp({ create: { width: 2400, height: 1600, channels: 3, background: color } })
    .jpeg({ quality: 70 })
    .withExif({
      IFD0: { Make: 'LeakyCam' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '50/1 57/1 0/1' },
    })
    .toBuffer();
const webp = () =>
  sharp({ create: { width: 900, height: 600, channels: 3, background: '#0a0' } })
    .webp()
    .toBuffer();

function multipart(alert: object, files: { name: string; type: string; data: Buffer }[]) {
  const boundary = `----ps${randomUUID()}`;
  const parts: Buffer[] = [
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="alert"\r\n\r\n${JSON.stringify(alert)}\r\n`,
    ),
  ];
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="photos"; filename="${f.name}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
      f.data,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

interface Owner {
  session: Session;
  userId: string;
  vehicleId: string;
  code: string;
}

let n = 0;
async function owner(): Promise<Owner> {
  const email = `photos${n++}@example.de`;
  const session = await subscribe(h, email);
  await makePremium(h, email);
  const v = (
    await h.app.inject({
      method: 'POST',
      url: '/v1/vehicles',
      headers: session.headers,
      payload: { nickname: 'Der Blaue', plate: 'K-PS 2027' },
    })
  ).json();
  const t = await h.db
    .selectFrom('qr_tokens')
    .select('code_enc')
    .where('id', '=', v.decal.tokenId)
    .executeTakeFirstOrThrow();
  const user = await h.db
    .selectFrom('users')
    .select('id')
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  return { session, userId: user.id, vehicleId: v.id, code: crypto.decrypt(t.code_enc) };
}

async function phoneChannels(userId: string) {
  for (const type of ['sms'] as const) {
    const number = '+4915199988877';
    await h.db
      .insertInto('contact_channels')
      .values({
        user_id: userId,
        type,
        address_enc: crypto.encrypt(number),
        address_bidx: crypto.blindIndex(number),
        is_enabled: true,
        verified_at: new Date(),
        opted_in_at: new Date(),
      } as never)
      .execute();
  }
}

const scan = (
  code: string,
  files: { name: string; type: string; data: Buffer }[],
  remoteAddress = nextIp(),
  type = 'damage',
) => {
  const m = multipart({ type, lang: 'de', captcha: DEV_CAPTCHA_SOLUTION }, files);
  return h.app.inject({
    method: 'POST',
    url: `/v1/scan/${code}/alerts`,
    remoteAddress,
    headers: { ...m.headers, 'user-agent': 'PhotoTest/1.0' },
    payload: m.payload,
  });
};

const files = async () => (existsSync(MEDIA_DIR) ? await readdir(MEDIA_DIR) : []);
const VIEW = /\/v\/([A-Za-z0-9_-]{43})/;

describe('alert photos (Phase 2)', () => {
  it('scan → 2 photos → the same view link in e-mail, WhatsApp and SMS → report abuse → photos gone', async () => {
    const o = await owner();
    await phoneChannels(o.userId);
    const scanner = nextIp();
    const res = await scan(
      o.code,
      [
        { name: 'a.jpg', type: 'image/jpeg', data: await jpeg() },
        { name: 'b.webp', type: 'image/webp', data: await webp() },
      ],
      scanner,
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().photos).toEqual({ stored: 2, rejected: 0 });
    const { alertId } = res.json();

    // Stored encrypted under random names, re-encoded without metadata.
    const rows = await h.db
      .selectFrom('alert_media')
      .selectAll()
      .where('alert_id', '=', alertId)
      .orderBy('position')
      .execute();
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.mime_type === 'image/jpeg' && r.size_bytes < 500 * 1024)).toBe(true);
    expect(Math.max(rows[0]!.width, rows[0]!.height)).toBe(1600);
    const stored = await files();
    expect(stored.sort()).toEqual(rows.map((r) => r.storage_key).sort());
    for (const name of stored) {
      const blob = await readFile(join(MEDIA_DIR, name));
      expect(blob.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))).toBe(false);
      expect(blob.includes(Buffer.from('LeakyCam'))).toBe(false);
    }
    const expiresInDays =
      (rows[0]!.expires_at.getTime() - rows[0]!.created_at.getTime()) / 86_400_000;
    expect(Math.round(expiresInDays)).toBe(30);

    // Every channel carries the same view link, and only the link.
    await h.app.get(DispatchService).dispatch(alertId);
    const mail = await lastMail(h, 'alert_received_photos');
    expect(mail).toBeDefined();
    const token = VIEW.exec(mail!.text)![1]!;
    expect(mail!.html).not.toContain('<img');
    expect(mail!.text).toContain(`/v/${token}?melden=1`);
    const sms = JSON.parse((await h.valkey.lrange(DEV_SMS_KEY, 0, 0))[0]!);
    expect(VIEW.exec(sms.body)![1]).toBe(token);
    expect(sms.body.length).toBeLessThanOrEqual(160);
    // Only the hash of the token is stored.
    const tokenRow = await h.db
      .selectFrom('alert_view_tokens')
      .selectAll()
      .where('alert_id', '=', alertId)
      .executeTakeFirstOrThrow();
    expect(tokenRow.token_hash.toString('hex')).not.toContain(Buffer.from(token).toString('hex'));

    // The view page and the photo stream.
    const view = await h.app.inject({ method: 'GET', url: `/v1/alerts/view/${token}` });
    expect(view.statusCode).toBe(200);
    const data = view.json();
    expect(data.type.code).toBe('damage');
    expect(data.photos).toHaveLength(2);
    expect(data.replyToken).toEqual(expect.any(String));
    const photo = await h.app.inject({
      method: 'GET',
      url: `/v1/alerts/media/${data.photos[0].id}?t=${token}`,
    });
    expect(photo.statusCode).toBe(200);
    expect(photo.headers['content-type']).toBe('image/jpeg');
    expect(photo.headers['cache-control']).toBe('no-store');
    expect(photo.headers['x-robots-tag']).toContain('noindex');
    expect(photo.headers['referrer-policy']).toBe('no-referrer');
    expect(String(photo.headers['content-disposition'])).toMatch(/^inline/);
    expect((await sharp(photo.rawPayload).metadata()).exif).toBeUndefined();

    // Unknown and foreign tokens look the same.
    for (const url of [
      `/v1/alerts/view/${'x'.repeat(43)}`,
      `/v1/alerts/view/short`,
      `/v1/alerts/media/${data.photos[0].id}?t=${'x'.repeat(43)}`,
      `/v1/alerts/media/${randomUUID()}?t=${token}`,
    ]) {
      const r = await h.app.inject({ method: 'GET', url });
      expect(r.statusCode, url).toBe(404);
    }

    // "Missbrauch melden": photos and text gone at once, sender blocked for this vehicle.
    const report = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/view/${token}/report-abuse`,
      payload: { source: 'view_page' },
    });
    expect(report.statusCode).toBe(200);
    expect(report.json()).toEqual({ deleted: 2, blocked: true });
    expect(await files()).toEqual([]);
    const after = await h.db
      .selectFrom('alert_media')
      .selectAll()
      .where('alert_id', '=', alertId)
      .execute();
    expect(
      after.every(
        (r) =>
          r.deleted_reason === 'abuse_report' && r.storage_key === null && r.wrapped_key === null,
      ),
    ).toBe(true);
    const abuse = await h.db
      .selectFrom('abuse_reports')
      .selectAll()
      .where('alert_id', '=', alertId)
      .executeTakeFirstOrThrow();
    expect(abuse).toMatchObject({ reason: 'photo_abuse', source: 'view_page', status: 'open' });
    expect(abuse.note).toBeNull();
    const block = await h.db
      .selectFrom('scanner_blocks')
      .select('reason')
      .where('reason', '=', 'photo_abuse')
      .executeTakeFirst();
    expect(block).toBeDefined();
    const uploadBlock = await h.db
      .selectFrom('vehicle_photo_upload_blocks')
      .select('until')
      .where('vehicle_id', '=', o.vehicleId)
      .executeTakeFirstOrThrow();
    expect(uploadBlock.until.getTime()).toBeGreaterThan(Date.now() + 23 * 3_600_000);

    const gone = (await h.app.inject({ method: 'GET', url: `/v1/alerts/view/${token}` })).json();
    expect(gone).toMatchObject({ photos: [], photosGone: 'abuse_report', reported: true });
    const again = await h.app.inject({
      method: 'POST',
      url: `/v1/alerts/view/${token}/report-abuse`,
      payload: {},
    });
    expect(again.json()).toEqual({ deleted: 0, blocked: true });

    // The same scanner is blocked for this vehicle; others may alert, but without photos for now.
    expect((await scan(o.code, [], scanner)).statusCode).toBe(403);
    const other = await scan(o.code, [{ name: 'c.jpg', type: 'image/jpeg', data: await jpeg() }]);
    expect(other.statusCode).toBe(201);
    expect(other.json().photos).toEqual({ stored: 0, rejected: 1, reason: 'not_available' });
  });

  it('never blocks the alert: wrong plan, renamed files and invalid images only drop photos', async () => {
    const o = await owner();
    const page = (await h.app.inject({ method: 'GET', url: `/v1/scan/${o.code}` })).json();
    expect(page.photos).toBe(true);

    const mixed = await scan(o.code, [
      { name: 'evil.jpg', type: 'image/jpeg', data: Buffer.from('#!/bin/sh\nrm -rf /\n') },
      { name: 'ok.jpg', type: 'image/jpeg', data: await jpeg() },
    ]);
    expect(mixed.statusCode).toBe(201);
    expect(mixed.json().photos).toEqual({ stored: 1, rejected: 1, reason: 'invalid' });

    await setSetting(h, 'photos.plans', ['plus']);
    const page2 = (await h.app.inject({ method: 'GET', url: `/v1/scan/${o.code}` })).json();
    expect(page2.photos).toBe(false);
    const res = await scan(o.code, [{ name: 'a.jpg', type: 'image/jpeg', data: await jpeg() }]);
    expect(res.statusCode).toBe(201);
    expect(res.json().photos).toEqual({ stored: 0, rejected: 1, reason: 'not_available' });
    expect(await files()).toHaveLength(1);
  });

  it('refuses more than 2 files and files over 500 KB before reading further', async () => {
    const o = await owner();
    const three = await scan(o.code, [
      { name: '1.jpg', type: 'image/jpeg', data: await jpeg() },
      { name: '2.jpg', type: 'image/jpeg', data: await jpeg() },
      { name: '3.jpg', type: 'image/jpeg', data: await jpeg() },
    ]);
    expect(three.statusCode).toBe(413);
    const big = await scan(o.code, [
      { name: 'big.jpg', type: 'image/jpeg', data: Buffer.alloc(600 * 1024, 1) },
    ]);
    expect(big.statusCode).toBe(413);
    expect(await files()).toEqual([]);
  });

  it('the owner can report from the portal history', async () => {
    const o = await owner();
    const res = await scan(o.code, [{ name: 'a.jpg', type: 'image/jpeg', data: await jpeg() }]);
    const r = await h.app.inject({
      method: 'POST',
      url: `/v1/portal/alerts/${res.json().alertId}/report-abuse`,
      headers: o.session.headers,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().deleted).toBe(1);
    const other = await owner();
    const foreign = await h.app.inject({
      method: 'POST',
      url: `/v1/portal/alerts/${res.json().alertId}/report-abuse`,
      headers: other.session.headers,
    });
    expect(foreign.statusCode).toBe(404);
  });

  it('retention: photos and their link are deleted after 30 days (key, file, row), idempotently', async () => {
    const o = await owner();
    const res = await scan(o.code, [
      { name: 'a.jpg', type: 'image/jpeg', data: await jpeg() },
      { name: 'b.jpg', type: 'image/jpeg', data: await jpeg('#c33') },
    ]);
    const { alertId } = res.json();
    const fresh = await scan(o.code, [{ name: 'c.jpg', type: 'image/jpeg', data: await jpeg() }]);
    const media = h.app.get(AlertMediaService);
    const viewToken = h.app.get(ViewTokenService).tokenFor(alertId);

    // Nothing is due yet.
    expect(await media.purgeExpired()).toEqual({ photos: 0, links: 0, orphans: 0 });
    expect(await files()).toHaveLength(3);

    // 31 days later for the first alert.
    await sql`UPDATE alert_media SET created_at = now() - interval '31 days', expires_at = now() - interval '1 day' WHERE alert_id = ${alertId}`.execute(
      h.db,
    );
    await sql`UPDATE alert_view_tokens SET expires_at = now() - interval '1 day' WHERE alert_id = ${alertId}`.execute(
      h.db,
    );
    // A leftover file without a row (e.g. a deleted account) and a brand-new upload in progress.
    await mkdir(MEDIA_DIR, { recursive: true });
    const orphan = randomUUID();
    const young = randomUUID();
    await writeFile(join(MEDIA_DIR, orphan), 'x');
    await writeFile(join(MEDIA_DIR, young), 'x');
    const old = new Date(Date.now() - 2 * 3_600_000);
    await utimes(join(MEDIA_DIR, orphan), old, old);

    expect(await media.purgeExpired()).toEqual({ photos: 2, links: 1, orphans: 1 });
    const rows = await h.db
      .selectFrom('alert_media')
      .selectAll()
      .where('alert_id', '=', alertId)
      .execute();
    expect(
      rows.every(
        (r) =>
          r.deleted_reason === 'retention' &&
          r.deleted_at !== null &&
          r.storage_key === null &&
          r.wrapped_key === null,
      ),
    ).toBe(true);
    const left = await files();
    expect(left).toHaveLength(2); // the other alert's photo and the young file
    expect(left).toContain(young);
    expect(
      (await h.app.inject({ method: 'GET', url: `/v1/alerts/view/${viewToken}` })).statusCode,
    ).toBe(404);
    // The other alert keeps its photo.
    const freshRow = await h.db
      .selectFrom('alert_media')
      .select('deleted_at')
      .where('alert_id', '=', fresh.json().alertId)
      .executeTakeFirstOrThrow();
    expect(freshRow.deleted_at).toBeNull();

    // Safe to run again, and it also finishes a deletion that stopped after the key.
    await sql`UPDATE alert_media SET wrapped_key = NULL WHERE alert_id = ${fresh.json().alertId}`.execute(
      h.db,
    );
    expect(await media.purgeExpired()).toEqual({ photos: 1, links: 0, orphans: 0 });
    expect(await media.purgeExpired()).toEqual({ photos: 0, links: 0, orphans: 0 });
  });
});
