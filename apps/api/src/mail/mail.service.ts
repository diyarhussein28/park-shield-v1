import { Inject, Injectable } from '@nestjs/common';
import { MAILER, type Mailer } from '../providers/ports';
import { renderMail, type MailLocale, type MailTemplate, type MailValues } from './templates';

@Injectable()
export class MailService {
  constructor(@Inject(MAILER) private readonly mailer: Mailer) {}

  async send(input: {
    to: string;
    template: MailTemplate;
    locale: MailLocale;
    values?: MailValues;
    actionUrl?: string;
    replies?: { label: string; url: string }[];
  }): Promise<void> {
    const rendered = renderMail(
      input.template,
      input.locale,
      input.values ?? {},
      input.actionUrl,
      input.replies,
    );
    await this.mailer.send({ to: input.to, tag: input.template, ...rendered });
  }
}
