import { randomBytes } from 'node:crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { SettingsService } from './settings.service';
import { LOGGER, VALKEY } from './tokens';

// One atomic step: increment, start the window on the first hit, and undo the increment when over the
// limit, so rejected requests never consume quota and concurrent requests cannot overshoot (02-arch §5).
const SCRIPT = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end
if n > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[2]) end
  return {0, ttl}
end
return {1, tonumber(ARGV[1]) - n}
`;

// Sliding window over several limits (abuse protection §2): each key is a sorted set of request times.
// Expired entries are dropped, every counter is checked, and only if all pass is the request added to
// all of them. Retry-After is the moment the oldest entry of the exceeded window leaves it.
// ARGV: now (ms), member, then max and window (ms) per key.
const SLIDING_SCRIPT = `
local now = tonumber(ARGV[1])
for i = 1, #KEYS do
  local max = tonumber(ARGV[1 + i * 2])
  local win = tonumber(ARGV[2 + i * 2])
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - win)
  if redis.call('ZCARD', KEYS[i]) >= max then
    local oldest = redis.call('ZRANGE', KEYS[i], 0, 0, 'WITHSCORES')
    local retry = win
    if oldest[2] then retry = tonumber(oldest[2]) + win - now end
    return {0, i, math.max(1, math.ceil(retry / 1000))}
  end
end
for i = 1, #KEYS do
  redis.call('ZADD', KEYS[i], now, ARGV[2])
  redis.call('PEXPIRE', KEYS[i], tonumber(ARGV[2 + i * 2]))
end
return {1, 0, 0}
`;

/** Named limits with their defaults. Runtime values come from app_settings key `ratelimit.<name>`. */
export const RATE_LIMITS = {
  // US-17 / abuse protection §2: scanner limits, sliding windows (02-architecture §5)
  'alert.scanner_vehicle': { max: 2, windowSeconds: 3600 },
  'alert.scanner_vehicle_day': { max: 3, windowSeconds: 86_400 },
  'alert.scanner_global': { max: 6, windowSeconds: 3600 },
  'alert.vehicle': { max: 20, windowSeconds: 86_400 },
  // A sender who confirmed a phone number: the same limits per number and vehicle.
  'alert.phone_vehicle': { max: 2, windowSeconds: 3600 },
  'alert.phone_vehicle_day': { max: 3, windowSeconds: 86_400 },
  // Scanner phone check (Protected Mode): every code is an SMS that costs money (SMS pumping).
  'verify.otp_scanner': { max: 3, windowSeconds: 3600 },
  'verify.otp_phone': { max: 3, windowSeconds: 86_400 },
  'verify.otp_country': { max: 50, windowSeconds: 3600 },
  'verify.check_phone': { max: 5, windowSeconds: 900 },
  'report.fake_ip': { max: 5, windowSeconds: 3600 },
  // NT-07: every SMS code costs money and reaches a third party's phone if mistyped.
  'sms.otp_user': { max: 3, windowSeconds: 3600 },
  'sms.otp_phone': { max: 5, windowSeconds: 86_400 },
  'magic_link.ip': { max: 30, windowSeconds: 3600 },
  'magic_link.email': { max: 5, windowSeconds: 3600 },
  'cancel.ip': { max: 10, windowSeconds: 3600 },
  'withdrawal.ip': { max: 10, windowSeconds: 3600 },
  'cancel.email': { max: 5, windowSeconds: 3600 },
  'scan.not_found': { max: 30, windowSeconds: 60 },
  // US-24: invitations e-mail third parties, so an account cannot be used to send many of them.
  'contact.invite': { max: 5, windowSeconds: 86_400 },
  // US-44: the contact form creates Zammad tickets.
  'support.ip': { max: 10, windowSeconds: 3600 },
  'support.email': { max: 5, windowSeconds: 3600 },
  // ASVS 2.2.1: completing a sign-in (link, passkey) is limited per network even though the
  // tokens are unguessable; a shared NAT (office, campus) still has plenty of room.
  'auth.ip': { max: 60, windowSeconds: 600 },
  // 6-digit codes: on top of 5 tries per code, a network may only guess this often.
  'auth.code_ip': { max: 30, windowSeconds: 900 },
  'ops_auth.ip': { max: 30, windowSeconds: 600 },
  // Phase 2 alert photos: uploads per vehicle (an alert with photos counts once), and the owner's
  // view page with its photos and the "Missbrauch melden" button, per network.
  'photos.vehicle': { max: 6, windowSeconds: 3600 },
  'alert_view.ip': { max: 120, windowSeconds: 600 },
  // Scanner alerts with photos (multipart, up to ~1 MB): counted per network before a single byte of
  // the body is read, so large uploads cannot pile up in memory ahead of the captcha check. Alerts
  // without photos (JSON) do not count. A refused upload can still be sent without photos.
  'scan.upload_ip': { max: 30, windowSeconds: 600 },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/** German default texts of the scanner limits (abuse protection §2); the scanner page localises. */
export const LIMIT_MESSAGES = {
  scanner:
    'Sie haben das Limit für Benachrichtigungen überschritten. Bitte versuchen Sie es später erneut.',
  vehicle:
    'Der Fahrzeughalter wurde bereits mehrfach benachrichtigt. Bitte versuchen Sie es später erneut.',
} as const;

export class RateLimitedException extends HttpException {
  constructor(
    public readonly retryAfterSeconds: number,
    limit?: RateLimitName,
  ) {
    const message = limit?.startsWith('alert.')
      ? limit === 'alert.vehicle'
        ? LIMIT_MESSAGES.vehicle
        : LIMIT_MESSAGES.scanner
      : undefined;
    super(
      {
        error: 'rate_limited',
        retryAfterSeconds,
        ...(limit ? { limit } : {}),
        ...(message ? { message } : {}),
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/**
 * Stand-in while Valkey does not answer: a small sliding window per process. It is deliberately
 * generous (each API process counts alone) and only exists so that an outage never blocks every alert.
 */
class LocalWindows {
  private readonly hits = new Map<string, number[]>();
  constructor(private readonly maxKeys = 20_000) {}

  check(limits: { key: string; max: number; windowMs: number }[], now: number) {
    for (const [i, l] of limits.entries()) {
      const list = (this.hits.get(l.key) ?? []).filter((t) => t > now - l.windowMs);
      this.hits.set(l.key, list);
      if (list.length >= l.max) {
        return { ok: false, index: i, retry: Math.ceil((list[0]! + l.windowMs - now) / 1000) };
      }
    }
    for (const l of limits) this.hits.get(l.key)!.push(now);
    // Forget the oldest keys first; losing a counter only makes the fallback more lenient.
    while (this.hits.size > this.maxKeys) this.hits.delete(this.hits.keys().next().value!);
    return { ok: true, index: -1, retry: 0 };
  }
}

const withTimeout = <T>(p: Promise<T>, ms: number) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('valkey timeout')), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });

@Injectable()
export class RateLimitService {
  private readonly local = new LocalWindows();
  private alarmAt = 0;

  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  async hit(key: string, max: number, windowSeconds: number): Promise<RateLimitResult> {
    const [ok, n] = (await this.valkey.eval(SCRIPT, 1, `rl:${key}`, max, windowSeconds)) as [
      number,
      number,
    ];
    return ok === 1
      ? { allowed: true, remaining: n, retryAfterSeconds: 0 }
      : { allowed: false, remaining: 0, retryAfterSeconds: n };
  }

  /** Enforces a named limit (hard rule 6: values come from app_settings, defaults above). */
  async enforce(name: RateLimitName, subject: string): Promise<void> {
    const { max, windowSeconds } = await this.settings.get(`ratelimit.${name}`, RATE_LIMITS[name]);
    const r = await this.hit(`${name}:${subject}`, max, windowSeconds);
    if (!r.allowed) throw new RateLimitedException(r.retryAfterSeconds, name);
  }

  /**
   * Scanner limits (US-17, abuse protection §2): all-or-nothing sliding windows in one Lua call. If
   * Valkey does not answer in time, the request is counted by the in-process fallback instead (fail
   * open: an outage must never stop every alert) and an alarm is logged.
   */
  async enforceAll(limits: { name: RateLimitName; subject: string }[]): Promise<void> {
    const values = await Promise.all(
      limits.map((l) => this.settings.get(`ratelimit.${l.name}`, RATE_LIMITS[l.name])),
    );
    const timeoutMs = Number(await this.settings.get('abuse.valkey_timeout_ms', 300));
    const keys = limits.map((l) => `rls:${l.name}:${l.subject}`);
    const now = Date.now();
    let result: [number, number, number];
    try {
      result = (await withTimeout(
        this.valkey.eval(
          SLIDING_SCRIPT,
          keys.length,
          ...keys,
          now,
          `${now}:${randomBytes(6).toString('hex')}`,
          ...values.flatMap((v) => [v.max, v.windowSeconds * 1000]),
        ),
        timeoutMs,
      )) as [number, number, number];
    } catch (err) {
      this.alarm(err);
      const r = this.local.check(
        keys.map((key, i) => ({
          key,
          max: values[i]!.max,
          windowMs: values[i]!.windowSeconds * 1000,
        })),
        now,
      );
      result = r.ok ? [1, 0, 0] : [0, r.index + 1, r.retry];
    }
    const [ok, index, retry] = result;
    if (ok !== 1) throw new RateLimitedException(retry, limits[index - 1]!.name);
  }

  /** Monitoring: one error line per minute while Valkey is unreachable (log alert in Better Stack). */
  private alarm(err: unknown) {
    if (Date.now() - this.alarmAt < 60_000) return;
    this.alarmAt = Date.now();
    this.logger.error(
      { alarm: 'ratelimit_valkey_unavailable', err: String(err) },
      'rate limits fall back to in-process counters',
    );
  }
}
