'use client';

import { Card, Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api-client';

interface Mail {
  to: string;
  subject: string;
  text: string;
  tag: string;
  sentAt: string;
}

const linkify = (text: string) =>
  text.split(/(https?:\/\/\S+)/g).map((part, i) =>
    // nosemgrep: ajinabraham.njsscan.dos.regex_dos.regex_dos -- anchored literal prefix, no backtracking; dev-only page
    /^https?:\/\//.test(part) ? (
      <a key={i} href={part} className="break-all text-primary underline">
        {part}
      </a>
    ) : (
      <span key={i}>{part}</span>
    ),
  );

interface WhatsAppMessage {
  to: string;
  template: string;
  lang: string;
  params: string[];
  messageId: string;
  sentAt: string;
}

/** Local inbox for mails and WhatsApp messages sent while the provider keys are empty. */
export default function DevInbox() {
  const { t } = useI18n();
  const [mails, setMails] = useState<Mail[] | null>(null);
  const [whatsapp, setWhatsapp] = useState<WhatsAppMessage[]>([]);
  useEffect(() => {
    const load = () =>
      Promise.all([
        api<{ mails: Mail[] }>('/v1/dev/mailbox').then(
          (r) => setMails(r.mails),
          () => setMails([]),
        ),
        api<{ messages: WhatsAppMessage[] }>('/v1/dev/whatsapp').then(
          (r) => setWhatsapp(r.messages),
          () => setWhatsapp([]),
        ),
      ]);
    void load();
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <main id="main">
      <Container className="py-10">
        <Stack gap={4}>
          <Heading level={1}>{t('dev.inboxTitle')}</Heading>
          <Text muted>{t('dev.inboxIntro')}</Text>
          {whatsapp.length > 0 && (
            <section aria-labelledby="wa-h">
              <Heading level={2} id="wa-h" className="mb-3 text-xl">
                WhatsApp
              </Heading>
              <ul className="flex flex-col gap-2">
                {whatsapp.map((m) => (
                  <li key={m.messageId}>
                    <Card>
                      <Text className="font-semibold">
                        {m.template} ({m.lang}): {m.params.join(' · ') || '—'}
                      </Text>
                      <Text muted className="text-sm">
                        {t('dev.to', { to: `+${m.to}` })} · {new Date(m.sentAt).toLocaleString()}
                      </Text>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {mails?.length === 0 && <Text>{t('dev.inboxEmpty')}</Text>}
          {mails?.map((m) => (
            <Card key={m.sentAt + m.tag}>
              <Stack gap={2}>
                <Heading level={2} className="text-lg">
                  {m.subject}
                </Heading>
                <Text muted className="text-sm">
                  {t('dev.to', { to: m.to })} · {new Date(m.sentAt).toLocaleString()} · {m.tag}
                </Text>
                <div className="whitespace-pre-wrap">{linkify(m.text)}</div>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Container>
    </main>
  );
}
