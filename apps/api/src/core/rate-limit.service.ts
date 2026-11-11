import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { SettingsService } from './settings.service';
import { VALKEY } from './tokens';

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

// Several limits at once: check every counter first, and only if all pass, count the request on all
// of them. A request rejected by one limit therefore consumes none of the others (02-architecture §5).
const MULTI_SCRIPT = `
for i = 1, #KEYS do
  local n = tonumber(redis.call('GET', KEYS[i]) or '0')
  if n >= tonumber(ARGV[i * 2 - 1]) then
    local ttl = redis.call('TTL', KEYS[i])
    if ttl < 0 then ttl = tonumber(ARGV[i * 2]) end
    return {0, i, ttl}
  end
end
for i = 1, #KEYS do
  local n = redis.call('INCR', KEYS[i])
  if n == 1 then redis.call('EXPIRE', KEYS[i], ARGV[i * 2]) end
end
return {1, 0, 0}
`;

/** Named limits with their defaults. Runtime values come from app_settings key `ratelimit.<name>`. */
export const RATE_LIMITS = {
  // US-17: the three scanner limits (02-architecture §5)
  'alert.scanner_vehicle': { max: 1, windowSeconds: 900 },
  'alert.scanner_global': { max: 6, windowSeconds: 3600 },
  'alert.vehicle': { max: 20, windowSeconds: 86_400 },
  'report.fake_ip': { max: 5, windowSeconds: 3600 },
  'whatsapp.otp_user': { max: 3, windowSeconds: 3600 },
  'whatsapp.otp_phone': { max: 5, windowSeconds: 86_400 },
  'magic_link.ip': { max: 30, windowSeconds: 3600 },
  'magic_link.email': { max: 5, windowSeconds: 3600 },
  'cancel.ip': { max: 10, windowSeconds: 3600 },
  'cancel.email': { max: 5, windowSeconds: 3600 },
  'waitlist.ip': { max: 10, windowSeconds: 3600 },
  'waitlist.email': { max: 3, windowSeconds: 86_400 },
  'scan.not_found': { max: 30, windowSeconds: 60 },
  // US-24: invitations e-mail third parties, so an account cannot be used to send many of them.
  'contact.invite': { max: 5, windowSeconds: 86_400 },
  // US-44: the contact form creates Zammad tickets.
  'support.ip': { max: 10, windowSeconds: 3600 },
  'support.email': { max: 5, windowSeconds: 3600 },
  // ASVS 2.2.1: completing a sign-in (link, passkey) is limited per network even though the
  // tokens are unguessable; a shared NAT (office, campus) still has plenty of room.
  'auth.ip': { max: 60, windowSeconds: 600 },
  'ops_auth.ip': { max: 30, windowSeconds: 600 },
} as const;
export type RateLimitName = keyof typeof RATE_LIMITS;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export class RateLimitedException extends HttpException {
  constructor(
    public readonly retryAfterSeconds: number,
    limit?: RateLimitName,
  ) {
    super(
      { error: 'rate_limited', retryAfterSeconds, ...(limit ? { limit } : {}) },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

@Injectable()
export class RateLimitService {
  constructor(
    @Inject(VALKEY) private readonly valkey: Redis,
    @Inject(SettingsService) private readonly settings: SettingsService,
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

  /** All-or-nothing check of several named limits (US-17). */
  async enforceAll(limits: { name: RateLimitName; subject: string }[]): Promise<void> {
    const values = await Promise.all(
      limits.map((l) => this.settings.get(`ratelimit.${l.name}`, RATE_LIMITS[l.name])),
    );
    const keys = limits.map((l) => `rl:${l.name}:${l.subject}`);
    const args = values.flatMap((v) => [v.max, v.windowSeconds]);
    const [ok, index, ttl] = (await this.valkey.eval(
      MULTI_SCRIPT,
      keys.length,
      ...keys,
      ...args,
    )) as [number, number, number];
    if (ok !== 1) throw new RateLimitedException(ttl, limits[index - 1]!.name);
  }
}
