// Seeds paying customers with an active decal each, for the k6 load test (US-45). Local or staging only.
//   npm run load:seed -- --vehicles 2000      creates load+N@example.test customers (idempotent)
//   npm run load:seed -- --clean              removes them again (cascades to alerts and deliveries)
// The decal codes go to .local/load/codes.json (git-ignored); k6 reads them from there.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { FieldCrypto, randomCrockford, sha256 } from '../apps/api/src/core/crypto.ts';
import { ensureLocalEnv } from './lib/env.ts';
import { ROOT } from './lib/paths.ts';

ensureLocalEnv();
const { values } = parseArgs({
  options: {
    vehicles: { type: 'string', default: '2000' },
    clean: { type: 'boolean', default: false },
  },
});
if (process.env.NODE_ENV === 'production' && process.env.APP_ENV === 'production') {
  console.error('refusing to seed load-test data in production');
  process.exit(2);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  if (values.clean) {
    const r = await db.query(`DELETE FROM users WHERE email LIKE 'load+%@example.test'`);
    console.log(`removed ${r.rowCount} load-test customers`);
    process.exit(0);
  }
  const n = Number(values.vehicles);
  const crypto = FieldCrypto.fromEnv(process.env, process.env.BIDX_KEY!);
  await db.query('BEGIN');
  const users = await db.query<{ id: string; i: number }>(
    `INSERT INTO users (email, email_verified_at, display_name)
     SELECT 'load+' || i || '@example.test', now(), 'Last ' || i FROM generate_series(1, $1) i
     ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
     RETURNING id, substring(email from 'load\\+(\\d+)@')::int AS i`,
    [n],
  );
  await db.query(
    `INSERT INTO subscriptions (user_id, plan, status, contract_no, current_period_start, current_period_end)
     SELECT u.id, 'plus', 'active', 'PS-L' || lpad(u.i::text, 7, '0'), now(), now() + interval '1 year'
       FROM unnest($1::uuid[], $2::int[]) AS u(id, i)
      WHERE NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = 'active')`,
    [users.rows.map((u) => u.id), users.rows.map((u) => u.i)],
  );
  await db.query(
    `INSERT INTO vehicles (owner_user_id, nickname, color)
     SELECT u.id, 'Last ' || u.i, 'Blau' FROM unnest($1::uuid[], $2::int[]) AS u(id, i)
      WHERE NOT EXISTS (SELECT 1 FROM vehicles v WHERE v.owner_user_id = u.id)`,
    [users.rows.map((u) => u.id), users.rows.map((u) => u.i)],
  );
  // Fresh codes on every run: the plaintext only exists here and in codes.json.
  await db.query(
    `DELETE FROM qr_tokens t USING vehicles v, users u
      WHERE t.vehicle_id = v.id AND v.owner_user_id = u.id AND u.email LIKE 'load+%@example.test'`,
  );
  const vehicles = await db.query<{ id: string }>(
    `SELECT v.id FROM vehicles v JOIN users u ON u.id = v.owner_user_id
      WHERE u.email LIKE 'load+%@example.test' ORDER BY v.id`,
  );
  const codes = vehicles.rows.map(() => randomCrockford(10));
  await db.query(
    `INSERT INTO qr_tokens (vehicle_id, code_hash, code_enc, key_version, code_hint, status, activated_at, last_test_at)
     SELECT * , 'active'::token_status, now(), now()
       FROM unnest($1::uuid[], $2::bytea[], $3::bytea[], $4::smallint[], $5::char(4)[])`,
    [
      vehicles.rows.map((v) => v.id),
      codes.map((c) => sha256(c)),
      codes.map((c) => crypto.encrypt(c)),
      codes.map(() => crypto.keyVersion),
      codes.map((c) => c.slice(-4)),
    ],
  );
  await db.query('COMMIT');
  const dir = join(ROOT, '.local', 'load');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'codes.json'), JSON.stringify(codes));
  console.log(
    `seeded ${codes.length} paying customers with an active decal; codes in .local/load/codes.json`,
  );
} catch (err) {
  await db.query('ROLLBACK').catch(() => undefined);
  throw err;
} finally {
  await db.end();
}
