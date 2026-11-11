import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/session.service';
import type { Db } from '../core/core.module';
import { normalizeEmail, sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import { CAPTCHA, SUPPORT_DESK, type Captcha, type SupportDesk } from '../providers/ports';

export const SUPPORT_TOPICS = [
  'alert_missing',
  'decal',
  'billing',
  'privacy',
  'abuse',
  'other',
] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];

const TOPIC_DE: Record<SupportTopic, string> = {
  alert_missing: 'Warnung nicht bekommen',
  decal: 'Aufkleber und Versand',
  billing: 'Zahlung und Kündigung',
  privacy: 'Datenschutz',
  abuse: 'Missbrauch',
  other: 'Sonstiges',
};

/**
 * US-44 / SP-01: the contact form opens a ticket in Zammad, the only ticket store (no ticket tables
 * here). Signed-in customers are recognised, so support sees the plan and the 48-hour promise.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SUPPORT_DESK) private readonly desk: SupportDesk,
    @Inject(CAPTCHA) private readonly captcha: Captcha,
    @Inject(RateLimitService) private readonly limits: RateLimitService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async contact(
    input: {
      email: string;
      name?: string;
      topic: SupportTopic;
      message: string;
      captcha?: string;
      locale: 'de' | 'en';
    },
    ctx: { ipPrefix: string; auth: AuthContext | null },
  ) {
    if (!(await this.captcha.verify(input.captcha)))
      throw new BadRequestException({ error: 'captcha_failed' });
    // Signed in: the ticket belongs to the account's address, not to whatever was typed.
    const email = ctx.auth ? ctx.auth.email : normalizeEmail(input.email);
    await this.limits.enforce('support.ip', ctx.ipPrefix);
    await this.limits.enforce('support.email', sha256(email).toString('hex'));

    let plan: string | null = null;
    if (ctx.auth) {
      const s = await this.db
        .selectFrom('subscriptions')
        .select('plan')
        .where('user_id', '=', ctx.auth.userId)
        .where('status', 'in', ['active', 'past_due'])
        .executeTakeFirst();
      plan = s?.plan ?? null;
    }
    const replyHours = plan ? await this.settings.get('support.reply_hours_plus', 48) : null;
    const tags = [
      `topic_${input.topic}`,
      `lang_${input.locale}`,
      ...(ctx.auth ? ['signed_in'] : []),
      ...(plan ? [plan, `reply_${replyHours}h`] : []),
    ];
    const footer = ctx.auth
      ? `\n\n---\nKunden-ID: ${ctx.auth.userId}${plan ? ` · Tarif: ${plan} · Antwort binnen ${replyHours} h` : ''}`
      : '';
    const subject = `[${TOPIC_DE[input.topic]}] ${input.message.replace(/\s+/g, ' ').slice(0, 60)}`;
    const { number } = await this.desk.createTicket({
      email,
      name: input.name?.trim() || null,
      subject,
      body: `${input.message.trim()}${footer}`,
      tags,
      locale: input.locale,
    });
    return { ticket: number, replyHours };
  }
}
