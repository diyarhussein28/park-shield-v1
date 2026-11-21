'use client';

import { Badge, Notice, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { Icon } from '@/components/icons';
import { KontoShell, Section } from '@/components/konto-shell';
import { PhoneSetup } from '@/components/phone-setup';
import { api } from '@/lib/api-client';
import type { ChannelsOverview, QuietHours, Usage } from '@/lib/api-server';
import { QuietHoursCard } from './quiet-hours';

/**
 * Notification settings since 2026-11-21: alerts arrive only as ParkShield app notifications (no
 * e-mail, no browser push); after 10 minutes without a reaction a reminder push, after 30 minutes one
 * SMS to the verified mobile number. So this page shows the app's status, the number (change only)
 * and the quiet hours, nothing else.
 */
export function NotificationsView({
  initial,
  quiet,
  usage,
}: {
  initial: ChannelsOverview;
  quiet: QuietHours;
  usage: Usage;
}) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [liveUsage, setUsage] = useState(usage);
  const reload = async () => {
    const [channels, used] = await Promise.all([
      api<ChannelsOverview>('/v1/channels'),
      api<Usage>('/v1/me/usage'),
    ]);
    setData(channels);
    setUsage(used);
  };
  const devices = data.app.devices;

  return (
    <KontoShell title={t('channels.title')} intro={t('channels.intro')}>
      {devices.length === 0 && (
        <Notice tone="warning" title={t('channels.appOffWarning')}>
          {t('channels.appOffHelp')}
        </Notice>
      )}
      <Section
        title={t('channels.appTitle')}
        icon="bell"
        intro={t('channels.appIntro')}
        aside={
          devices.length > 0 ? <Badge tone="success">{t('channels.appActive')}</Badge> : undefined
        }
      >
        {devices.length > 0 ? (
          <>
            <h3 className="font-semibold">{t('channels.appDevices')}</h3>
            <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
              {devices.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-4 py-3">
                  <Icon name="phone" className="size-5 shrink-0 text-primary" />
                  <span className="min-w-0 wrap-anywhere">
                    {t('channels.appDevice', {
                      platform: d.platform,
                      date: new Date(d.lastSeenAt),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-muted">{t('channels.appOffHelp')}</p>
        )}
      </Section>
      <PhoneSetup phone={data.sms?.phone ?? null} usage={liveUsage} onVerified={reload} />
      <QuietHoursCard initial={quiet} />
    </KontoShell>
  );
}
