import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '../config/env';
import { ENV } from '../core/tokens';
import { CompanyService } from '../letters/company.service';
import { MAILER, type Mailer, type MailAttachment } from '../providers/ports';
import { DEFAULT_FRAME, type MailFrame } from './layout';
import { renderMail, type MailLocale, type MailTemplate, type MailValues } from './templates';

const FRAME_TTL_MS = 5 * 60_000;

/**
 * Every e-mail goes through here and the one layout (mail/layout.ts). The footer's company name and
 * address come from the company settings (ops → Einstellungen → Unternehmen), cached for 5 minutes.
 */
@Injectable()
export class MailService {
  private frame: { value: MailFrame; at: number } | null = null;

  constructor(
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(ENV) private readonly env: Env,
    @Inject(CompanyService) private readonly company: CompanyService,
  ) {}

  /** Website and company data for the layout; falls back to the built-in defaults on a DB error. */
  async currentFrame(): Promise<MailFrame> {
    if (this.frame && Date.now() - this.frame.at < FRAME_TTL_MS) return this.frame.value;
    const c = await this.company
      .current()
      .then((p) => p.data)
      .catch(() => null);
    const value: MailFrame = {
      webBaseUrl: this.env.WEB_BASE_URL,
      company: c
        ? {
            name: c.name,
            street: c.street,
            postalCode: c.postalCode,
            city: c.city,
            country: c.country,
          }
        : DEFAULT_FRAME.company,
    };
    this.frame = { value, at: Date.now() };
    return value;
  }

  async send(input: {
    to: string;
    template: MailTemplate;
    locale: MailLocale;
    values?: MailValues;
    actionUrl?: string;
    replies?: { label: string; url: string }[];
    links?: { label: string; url: string }[];
    attachments?: MailAttachment[];
    replyTo?: string;
  }): Promise<void> {
    const rendered = renderMail(
      input.template,
      input.locale,
      input.values ?? {},
      input.actionUrl,
      input.replies,
      input.links,
      await this.currentFrame(),
    );
    await this.mailer.send({
      to: input.to,
      tag: input.template,
      ...rendered,
      ...(input.attachments?.length ? { attachments: input.attachments } : {}),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
    });
  }
}
