import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AuthContext } from '../auth/session.service';
import type { Db } from '../core/core.module';
import { normalizeEmail, sha256 } from '../core/crypto';
import { RateLimitService } from '../core/rate-limit.service';
import { SettingsService } from '../core/settings.service';
import { DB } from '../core/tokens';
import { MailService } from '../mail/mail.service';
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
const TOPIC_EN: Record<SupportTopic, string> = {
  alert_missing: 'Alert not received',
  decal: 'Decal and shipping',
  billing: 'Payment and cancellation',
  privacy: 'Privacy',
  abuse: 'Abuse',
  other: 'Other',
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
    @Inject(MailService) private readonly mail: MailService,
  ) {}

  async contact(
    input: {
      email: string;
      name?: string;
      topic: SupportTopic;
      message: string;
      captcha?: string;
      locale: 'de' | 'en';
      client?: string;
    },
    ctx: { ipPrefix: string; auth: AuthContext | null },
  ) {
    if (!(await this.captcha.verify(input.captcha)))
      throw new BadRequestException({ error: 'captcha_failed' });
    // Signed in: the ticket belongs to the account's address, not to whatever was typed.
    const email = ctx.auth ? ctx.auth.email : normalizeEmail(input.email);
    await this.limits.enforce('support.ip', ctx.ipPrefix);
    await this.limits.enforce('support.email', sha256(email).toString('hex'));
    return this.submit({ ...input, email, subject: null }, ctx.auth);
  }

  /**
   * The in-app contact form (signed in, bearer session, so no captcha): a free subject and a reply
   * address the customer may change (pre-filled with the account's). Limited per account, per network
   * and per reply address, so the confirmation can never be used to mail strangers in bulk.
   */
  async appContact(
    input: {
      subject: string;
      email: string;
      message: string;
      locale: 'de' | 'en';
      client?: string;
    },
    ctx: { ipPrefix: string; auth: AuthContext },
  ) {
    const email = normalizeEmail(input.email);
    await this.limits.enforce('support.ip', ctx.ipPrefix);
    await this.limits.enforce('support.email', sha256(ctx.auth.userId).toString('hex'));
    if (email !== ctx.auth.email)
      await this.limits.enforce('support.email', sha256(email).toString('hex'));
    return this.submit(
      {
        email,
        topic: 'other',
        subject: input.subject.replace(/\s+/g, ' ').trim(),
        message: input.message,
        locale: input.locale,
        client: input.client,
      },
      ctx.auth,
    );
  }

  private async submit(
    input: {
      email: string;
      name?: string;
      topic: SupportTopic;
      subject: string | null;
      message: string;
      locale: 'de' | 'en';
      client?: string;
    },
    auth: AuthContext | null,
  ) {
    const email = input.email;
    let plan: string | null = null;
    let customerNo: string | null = null;
    let contractNo: string | null = null;
    if (auth) {
      const s = await this.db
        .selectFrom('subscriptions')
        .select(['plan', 'contract_no'])
        .where('user_id', '=', auth.userId)
        .where('status', 'in', ['active', 'past_due'])
        .orderBy('created_at', 'desc')
        .executeTakeFirst();
      plan = s?.plan ?? null;
      contractNo = s?.contract_no ?? null;
      const u = await this.db
        .selectFrom('users')
        .select('customer_no')
        .where('id', '=', auth.userId)
        .executeTakeFirst();
      customerNo = u?.customer_no ?? null;
    }
    const replyHours = plan ? await this.settings.get('support.reply_hours_plus', 48) : null;
    const tags = [
      `topic_${input.topic}`,
      `lang_${input.locale}`,
      ...(auth ? ['signed_in'] : []),
      ...(plan ? [plan, `reply_${replyHours}h`] : []),
    ];
    const client = input.client?.trim() || 'web';
    const at = new Date();
    const footer = auth
      ? `\n\n---\nKundennummer: ${customerNo ?? '–'} · Vertragsnummer: ${contractNo ?? '–'}${plan ? ` · Antwort binnen ${replyHours} h` : ''}`
      : '';
    const subject = `[${TOPIC_DE[input.topic]}] ${(input.subject ?? input.message).replace(/\s+/g, ' ').slice(0, 60)}`;
    const { number } = await this.desk.createTicket({
      email,
      name: input.name?.trim() || null,
      subject,
      body: `${input.subject ? `Betreff: ${input.subject}\n\n` : ''}${input.message.trim()}${footer}\nVersion: ${client}`,
      tags,
      locale: input.locale,
      fields: {
        topic: TOPIC_DE[input.topic],
        subject: input.subject,
        message: input.message.trim(),
        customerNo,
        contractNo,
        client,
        at,
      },
    });
    // The customer's short confirmation („Wir haben Ihre Nachricht erhalten …“).
    await this.mail.send({
      to: email,
      template: 'support_received',
      locale: input.locale,
      values: {
        ticket: number,
        topic: input.subject ?? (input.locale === 'en' ? TOPIC_EN : TOPIC_DE)[input.topic],
      },
    });
    return { ticket: number, replyHours };
  }
}
