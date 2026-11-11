'use client';

import type { MessageKey, Translate } from '@parkshield/i18n';
import { Card, Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { PageShell } from '@/components/site-chrome';
import type { DeliveryHelp } from '@/lib/api-server';

/** Plain-language reason for a delivery outcome (SP-05). Unknown provider codes get a generic text. */
function reasonText(t: Translate, status: string, reason: string | null): string | null {
  if (!reason) return null;
  const known = [
    'quiet_hours',
    'sensitive_spot',
    'kill_switch',
    'fair_use',
    'http_404',
    'http_410',
  ];
  if (known.includes(reason)) return t(`deliveryHelp.r_${reason}` as MessageKey);
  if (reason.startsWith('http_')) return t('deliveryHelp.r_push_error');
  return status === 'failed' ? t('deliveryHelp.r_error') : null;
}

function Check({ ok, children, fix }: { ok: boolean; children: ReactNode; fix?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start justify-between gap-2">
      <span>
        <span aria-hidden="true">{ok ? '✓ ' : '! '}</span>
        {children}
      </span>
      {!ok && fix}
    </li>
  );
}

/** SP-05: "I didn't get the alert" — the most expected ticket, answered by the portal itself. */
export function DeliveryHelpView({ data }: { data: DeliveryHelp }) {
  const { t, locale } = useI18n();
  const s = data.setup;
  const fixLink = (href: string, label: string) => (
    <Link href={href} className="text-primary underline">
      {label}
    </Link>
  );
  const channel = (c: string) => t('channels.channelName', { channel: c });

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div>
            <Link href="/konto" className="text-primary underline">
              {t('channels.toAccount')}
            </Link>
            <Heading level={1} className="mt-2">
              {t('deliveryHelp.title')}
            </Heading>
            <Text muted>{t('deliveryHelp.intro')}</Text>
          </div>

          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('deliveryHelp.checksTitle')}
              </Heading>
              <ul className="flex flex-col gap-2">
                <Check
                  ok={s.pushDevices > 0 && s.pushFailing === 0}
                  fix={fixLink('/konto/benachrichtigungen', t('deliveryHelp.goNotifications'))}
                >
                  {s.pushDevices === 0
                    ? t('deliveryHelp.noPush')
                    : s.pushFailing > 0
                      ? t('deliveryHelp.pushFailing', { count: s.pushFailing })
                      : t('deliveryHelp.okPush', { count: s.pushDevices })}
                </Check>
                <Check ok={s.whatsapp}>
                  {s.whatsapp ? t('deliveryHelp.okWhatsApp') : t('deliveryHelp.noWhatsApp')}
                  {s.whatsapp && s.whatsappUsage.limit > 0 && (
                    <> {t('deliveryHelp.whatsappUsage', s.whatsappUsage)}</>
                  )}
                </Check>
                {s.quietHours > 0 && (
                  <Check
                    ok={false}
                    fix={fixLink('/konto/benachrichtigungen', t('deliveryHelp.goNotifications'))}
                  >
                    {t('deliveryHelp.quietHours', { count: s.quietHours })}
                  </Check>
                )}
                {!s.decalTested && (
                  <Check ok={false} fix={fixLink('/konto/fahrzeuge', t('deliveryHelp.goTest'))}>
                    {t('deliveryHelp.notTested')}
                  </Check>
                )}
                {s.switchedOff.length > 0 && (
                  <Check ok={false}>
                    {t('deliveryHelp.switchedOff', {
                      channels: s.switchedOff.map(channel).join(', '),
                    })}
                  </Check>
                )}
              </ul>
            </Stack>
          </Card>

          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-xl">
                {t('deliveryHelp.attemptsTitle')}
              </Heading>
              {data.attempts.length === 0 ? (
                <Text muted>{t('deliveryHelp.none')}</Text>
              ) : (
                <ol className="flex flex-col gap-3" aria-label={t('deliveryHelp.attemptsTitle')}>
                  {data.attempts.map((d, i) => {
                    const why = reasonText(t, d.status, d.reason);
                    return (
                      <li
                        key={`${d.alertId}-${i}`}
                        className="rounded-xl border border-border px-4 py-3"
                      >
                        <p className="font-semibold">
                          {t('deliveryHelp.attempt', {
                            type: locale === 'en' ? d.type.en : d.type.de,
                            nickname: d.nickname,
                            channel: channel(d.channel),
                            at: new Date(d.at),
                          })}
                        </p>
                        <p>{t(`deliveryHelp.s_${d.status}` as MessageKey)}</p>
                        {why && (
                          <p className="text-sm text-muted">
                            {t('deliveryHelp.fix')}: {why}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
