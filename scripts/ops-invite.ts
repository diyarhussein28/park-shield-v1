// Creates a staff account and prints a one-time passkey set-up link for the ops app (US-34).
// Needed once to create the first superadmin; afterwards staff are invited from the ops app.
//   npm run ops:invite -- --email anna@parkshield.de --name "Anna Admin" --role superadmin
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { Redis } from 'ioredis';
import pg from 'pg';
import { ensureLocalEnv } from './lib/env.ts';

ensureLocalEnv();
const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', multiple: true },
  },
});
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
const roles = values.role ?? [];
if (!email || !name || !roles.length) {
  console.error(
    'usage: npm run ops:invite -- --email <e-mail> --name "<name>" --role <role> [--role <role>]',
  );
  process.exit(2);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const known = await db.query('SELECT code FROM staff_roles WHERE code = ANY($1)', [roles]);
  if (known.rowCount !== new Set(roles).size)
    throw new Error(`unknown role in ${roles.join(', ')}`);
  await db.query('BEGIN');
  const existing = await db.query<{ id: string; kind: string }>(
    'SELECT id, kind FROM users WHERE email = $1',
    [email],
  );
  if (existing.rows[0] && existing.rows[0].kind !== 'staff')
    throw new Error('this e-mail belongs to a customer account');
  const userId =
    existing.rows[0]?.id ??
    (
      await db.query<{ id: string }>(
        `INSERT INTO users (email, kind, display_name, email_verified_at) VALUES ($1, 'staff', $2, now()) RETURNING id`,
        [email, name],
      )
    ).rows[0]!.id;
  await db.query('DELETE FROM staff_role_assignments WHERE user_id = $1', [userId]);
  for (const role of new Set(roles)) {
    await db.query('INSERT INTO staff_role_assignments (user_id, role_code) VALUES ($1, $2)', [
      userId,
      role,
    ]);
  }
  await db.query(
    `INSERT INTO audit_logs (actor_id, actor_kind, action, entity, entity_id, meta)
     VALUES (NULL, NULL, 'staff.invite', 'users', $1, $2)`,
    [userId, JSON.stringify({ roles, via: 'cli' })],
  );
  await db.query('COMMIT');

  // Same scheme as StaffService.invite: only the SHA-256 of the token is stored, for 72 hours.
  const token = randomBytes(32).toString('base64url');
  const valkey = new Redis(process.env.VALKEY_URL!);
  await valkey.set(
    `ops:invite:${createHash('sha256').update(token).digest('hex')}`,
    userId,
    'EX',
    72 * 3600,
  );
  valkey.disconnect();
  console.log(`Staff account ${email} (${roles.join(', ')}). Passkey set-up link, valid 72 h:`);
  console.log(`${process.env.OPS_BASE_URL}/einladung#t=${token}`);
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(String(err));
  process.exitCode = 1;
} finally {
  await db.end();
}
