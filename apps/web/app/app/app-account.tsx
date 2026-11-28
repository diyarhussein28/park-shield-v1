'use client';

import { Card, Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { Icon } from '@/components/icons';
import { PageShell } from '@/components/site-chrome';

const storeButton =
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-primary px-5 font-bold text-primary-fg transition hover:bg-primary-hover';

export function AppAccount({
  appStoreUrl,
  playStoreUrl,
}: {
  appStoreUrl: string | null;
  playStoreUrl: string | null;
}) {
  const { t } = useI18n();
  const items = ['appPage.item1', 'appPage.item2', 'appPage.item3', 'appPage.item4'] as const;
  return (
    <PageShell title={t('appPage.title')}>
      <Container className="max-w-2xl py-10">
        <Stack gap={6}>
          <Card>
            <Stack gap={4}>
              <Text>{t('appPage.lead')}</Text>
              <Heading level={2} className="text-lg">
                {t('appPage.listTitle')}
              </Heading>
              <ul className="flex flex-col gap-2">
                {items.map((k) => (
                  <li key={k} className="flex items-center gap-2">
                    <Icon
                      name="check"
                      className="size-5 shrink-0 text-success-fg"
                      strokeWidth={3}
                    />
                    {t(k)}
                  </li>
                ))}
              </ul>
              {appStoreUrl || playStoreUrl ? (
                <div className="flex flex-wrap gap-3">
                  {appStoreUrl && (
                    <a href={appStoreUrl} className={storeButton}>
                      {t('appPage.appStore')}
                    </a>
                  )}
                  {playStoreUrl && (
                    <a href={playStoreUrl} className={storeButton}>
                      {t('appPage.playStore')}
                    </a>
                  )}
                </div>
              ) : (
                <Text muted>{t('appPage.soon')}</Text>
              )}
            </Stack>
          </Card>
          <Card>
            <Stack gap={3}>
              <Heading level={2} className="text-lg">
                {t('appPage.withoutLogin')}
              </Heading>
              <ul className="flex flex-col gap-1">
                <li>
                  <Link
                    href="/kuendigen"
                    className="inline-flex min-h-12 items-center font-semibold text-primary underline"
                  >
                    {t('common.siteFooter.cancel')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/widerrufen"
                    className="inline-flex min-h-12 items-center font-semibold text-primary underline"
                  >
                    {t('common.siteFooter.withdraw')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/hilfe"
                    className="inline-flex min-h-12 items-center font-semibold text-primary underline"
                  >
                    {t('common.siteFooter.help')}
                  </Link>
                </li>
              </ul>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
