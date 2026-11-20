'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Badge,
  Card,
  Container,
  Field,
  Heading,
  Input,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { useEffect, useMemo, useState } from 'react';
import { Icon, type IconName } from '@/components/icons';
import { api } from '@/lib/api-client';
import { cx } from '@/lib/cx';

interface Mail {
  to: string;
  subject: string;
  text: string;
  tag: string;
  sentAt: string;
}
interface Sms {
  to: string;
  body: string;
  tag: string;
  messageId: string;
  sentAt: string;
}
/** What the fake FCM sender stored: the exact request body that would go to Google. */
interface AppPush {
  body: {
    message: {
      token: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
    };
  };
  messageId: string;
  sentAt: string;
}

type Kind = 'email' | 'sms' | 'app';
interface Item {
  key: string;
  kind: Kind;
  to: string;
  title: string;
  text: string;
  tag: string;
  sentAt: Date;
}

const KINDS: Kind[] = ['email', 'sms', 'app'];
const ICON: Record<Kind, IconName> = { email: 'mail', sms: 'phone', app: 'bell' };
const KIND_KEY: Record<Kind, MessageKey> = {
  email: 'dev.kindEmail',
  sms: 'dev.kindSms',
  app: 'dev.kindAppPush',
};

// nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored literal prefix, no backtracking; dev-only page
const URL_RE = /(https?:\/\/\S+)/g;

const linkify = (text: string) =>
  text.split(URL_RE).map((part, i) =>
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored literal prefix check, dev-only page
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="break-all text-primary underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );

/** The label written right before a link in the text ("Jetzt anmelden: https://…"). */
function links(text: string): { url: string; label: string }[] {
  const out: { url: string; label: string }[] = [];
  for (const line of text.split('\n')) {
    const m = /^(.*?):?\s*(https?:\/\/\S+)\s*$/.exec(line.trim());
    if (m) out.push({ url: m[2]!, label: m[1]?.trim() || new URL(m[2]!).pathname });
  }
  return out;
}

/**
 * Local inbox for everything sent while the provider keys are empty: e-mails (Brevo/SendGrid fake),
 * SMS (Twilio fake) and app pushes (FCM fake). One list, newest first, filterable by recipient and kind.
 */
export default function DevInbox() {
  const { t } = useI18n();
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [sms, setSms] = useState<Sms[]>([]);
  const [pushes, setPushes] = useState<AppPush[]>([]);
  const [filter, setFilter] = useState('');
  const [kind, setKind] = useState<Kind | 'all'>('all');

  useEffect(() => {
    const load = () =>
      Promise.all([
        api<{ mails: Mail[] }>('/v1/dev/mailbox').then(
          (r) => setMails(r.mails),
          () => setMails([]),
        ),
        api<{ messages: Sms[] }>('/v1/dev/sms').then(
          (r) => setSms(r.messages),
          () => setSms([]),
        ),
        api<{ messages: AppPush[] }>('/v1/dev/app-push').then(
          (r) => setPushes(r.messages),
          () => setPushes([]),
        ),
      ]);
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...(mails ?? []).map((m, i) => ({
        key: `m${i}${m.sentAt}`,
        kind: 'email' as const,
        to: m.to,
        title: m.subject,
        text: m.text,
        tag: m.tag,
        sentAt: new Date(m.sentAt),
      })),
      ...sms.map((m) => ({
        key: m.messageId,
        kind: 'sms' as const,
        to: m.to,
        title: m.body.split('\n')[0]!,
        text: m.body,
        tag: m.tag,
        sentAt: new Date(m.sentAt),
      })),
      ...pushes.map((m) => ({
        key: m.messageId,
        kind: 'app' as const,
        to: t('dev.appDevice', { token: `${m.body.message.token.slice(0, 12)}…` }),
        title: `${m.body.message.notification.title}: ${m.body.message.notification.body}`,
        text: JSON.stringify(m.body.message.data),
        tag: m.body.message.data.kind ?? 'push',
        sentAt: new Date(m.sentAt),
      })),
    ];
    return all.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  }, [mails, sms, pushes, t]);

  const needle = filter.trim().toLowerCase().replace(/\s+/g, '');
  const byRecipient = items.filter(
    (i) => !needle || i.to.toLowerCase().replace(/\s+/g, '').includes(needle),
  );
  const shown = byRecipient.filter((i) => kind === 'all' || i.kind === kind);
  const count = (k: Kind) => byRecipient.filter((i) => i.kind === k).length;

  return (
    <main id="main">
      <Container className="max-w-4xl py-10">
        <Stack gap={6}>
          <div>
            <Heading level={1}>{t('dev.inboxTitle')}</Heading>
            <Text muted className="mt-2">
              {t('dev.inboxIntro')}
            </Text>
          </div>

          <Card>
            <Stack gap={4}>
              <Field label={t('dev.filterLabel')} hint={t('dev.filterHint')}>
                {({ id, describedBy }) => (
                  <Input
                    id={id}
                    type="search"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    aria-describedby={describedBy}
                    className="max-w-md"
                  />
                )}
              </Field>
              <div role="group" aria-label={t('dev.kindGroup')} className="flex flex-wrap gap-2">
                {(['all', ...KINDS] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => setKind(k)}
                    className={cx(
                      'min-h-12 cursor-pointer rounded-xl border-2 px-4 font-semibold',
                      kind === k
                        ? 'border-primary bg-primary text-primary-fg'
                        : 'border-border-strong hover:border-primary',
                    )}
                  >
                    {k === 'all'
                      ? t('dev.kindAll', { count: byRecipient.length })
                      : t(KIND_KEY[k], { count: count(k) })}
                  </button>
                ))}
              </div>
            </Stack>
          </Card>

          {mails === null ? null : shown.length === 0 ? (
            <Text>{items.length ? t('dev.inboxNoMatch') : t('dev.inboxEmpty')}</Text>
          ) : (
            <ol className="flex flex-col gap-3" aria-label={t('dev.inboxTitle')}>
              {shown.map((item) => (
                <li key={item.key}>
                  <Message item={item} />
                </li>
              ))}
            </ol>
          )}
        </Stack>
      </Container>
    </main>
  );
}

function Message({ item }: { item: Item }) {
  const { t, locale } = useI18n();
  const actions = item.kind === 'app' ? [] : links(item.text);
  return (
    <article className="rounded-2xl border border-border bg-surface p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Badge tone={item.kind === 'email' ? 'info' : 'success'} className="gap-1">
          <Icon name={ICON[item.kind]} className="size-4" />
          {t('channels.channelName', { channel: item.kind === 'app' ? 'native_push' : item.kind })}
        </Badge>
        <span className="min-w-0 font-semibold wrap-anywhere">{t('dev.to', { to: item.to })}</span>
        <time dateTime={item.sentAt.toISOString()} className="text-sm text-muted">
          {item.sentAt.toLocaleString(locale === 'de' ? 'de-DE' : 'en-GB')}
        </time>
      </div>
      <h2 className="mt-3 text-lg font-bold wrap-anywhere">{item.title}</h2>
      {item.kind === 'sms' && (
        <p className="mt-2 whitespace-pre-wrap wrap-anywhere">{linkify(item.text)}</p>
      )}
      {item.kind === 'app' && <p className="mt-2 font-mono text-sm wrap-anywhere">{item.text}</p>}
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => (
            <a
              key={a.url}
              href={a.url}
              className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-xl bg-primary px-4 font-semibold text-primary-fg hover:bg-primary-hover"
            >
              <span className="min-w-0 truncate">{t('dev.openLink', { label: a.label })}</span>
              <Icon name="arrowRight" className="size-5 shrink-0" />
            </a>
          ))}
        </div>
      )}
      {item.kind === 'email' && (
        <details className="mt-3">
          <summary className="min-h-12 cursor-pointer content-center font-semibold text-primary">
            {t('dev.showText')}
          </summary>
          <div className="mt-2 rounded-xl bg-secondary/40 p-3 whitespace-pre-wrap wrap-anywhere">
            {linkify(item.text)}
          </div>
        </details>
      )}
      <p className="mt-2 text-xs text-muted">{item.tag}</p>
    </article>
  );
}
