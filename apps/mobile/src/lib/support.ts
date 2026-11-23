import { t } from './i18n';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ContactErrors = Partial<Record<'subject' | 'email' | 'message', string>>;

/** The same limits as the API (POST /v1/app/support/contact), so mistakes show before sending. */
export function validateContact(f: {
  subject: string;
  email: string;
  message: string;
}): ContactErrors {
  const e: ContactErrors = {};
  const subject = f.subject.trim();
  if (subject.length < 3 || subject.length > 120) e.subject = t('helpSubjectError');
  const email = f.email.trim();
  if (!EMAIL.test(email) || email.length > 254) e.email = t('helpEmailError');
  const message = f.message.trim();
  if (message.length < 10 || message.length > 5000) e.message = t('helpMessageError');
  return e;
}
