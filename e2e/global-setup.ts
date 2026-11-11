import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from 'dotenv';
import { Redis } from 'ioredis';
import pg from 'pg';

/**
 * Every local browser test comes from one IP, so per-IP limits (correctly) trip after a few runs.
 * Raise them in the local dev database only, clear old counters, and tell the API to reload settings.
 * Per-address limits and the per-scanner-per-vehicle limit stay at their defaults so the tests still
 * exercise them; every test scans from the same machine, so the cross-vehicle scanner limit and the
 * per-vehicle limit are raised too (they are covered by the API tests).
 */
export default async function globalSetup() {
  const env = join(import.meta.dirname, '..', '.env');
  if (existsSync(env)) config({ path: env, quiet: true });
  if (!process.env.DATABASE_URL || !process.env.VALKEY_URL) return;

  const raised = { max: 100_000, windowSeconds: 3600 };
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  for (const name of [
    'magic_link.ip',
    'cancel.ip',
    'waitlist.ip',
    'scan.not_found',
    'alert.scanner_global',
    'alert.vehicle',
    'report.fake_ip',
    'support.ip',
    'auth.ip',
    'ops_auth.ip',
  ]) {
    await db.query(
      `INSERT INTO app_settings (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [`ratelimit.${name}`, JSON.stringify(raised)],
    );
  }
  await db.end();

  const valkey = new Redis(process.env.VALKEY_URL);
  const stale = await valkey.keys('rl:*');
  if (stale.length) await valkey.del(...stale);
  await valkey.publish('settings:changed', '1');
  valkey.disconnect();

  await warmUp();
}

/**
 * `next dev` compiles each route on its first request. When many tests hit uncompiled routes at once,
 * compiles queue up and clicks land before hydration. Request every route once, sequentially, first.
 * (Production builds are precompiled; this only matters locally.)
 */
async function warmUp() {
  const web = process.env.WEB_BASE_URL ?? 'http://localhost:3000';
  const ops = process.env.OPS_BASE_URL ?? 'http://localhost:3001';
  const id = '00000000-0000-4000-8000-000000000000';
  const routes = [
    ...[
      '/',
      '/anmelden',
      '/anmelden/link',
      '/konto',
      '/konto/fahrzeuge',
      `/konto/fahrzeuge/${id}`,
      '/konto/benachrichtigungen',
      '/konto/notfallkontakte',
      '/konto/verlauf',
      '/konto/zustellung',
      '/konto/daten',
      '/antwort',
      '/notfallkontakt',
      '/konto-loeschen-abbrechen',
      '/datenschutz-anfrage',
      '/dev/checkout',
      '/s/0000000000',
      '/hilfe',
      '/hilfe/so-funktioniert-parkshield',
      '/hilfe/kontakt',
      '/aktivieren',
    ].map((p) => web + p),
    ...[
      '/',
      '/anmelden',
      '/einladung',
      '/kunden',
      `/kunden/${id}`,
      `/warnungen/${id}`,
      '/break-glass',
      '/datenschutz',
      `/datenschutz/${id}`,
      '/missbrauch',
      '/missbrauch/pruefung',
      '/missbrauch/woerter',
      '/mitarbeitende',
      '/bestellungen',
      `/bestellungen/${id}`,
      '/partner',
      `/kunden/${id}/erstattung`,
      '/gutscheine',
      '/einstellungen',
      '/einstellungen/anbieter',
      '/audit',
      '/zammad',
      '/kunden/zammad',
    ].map((p) => ops + p),
  ];
  for (const url of routes) {
    await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(60_000) }).catch(() => {});
  }
}
