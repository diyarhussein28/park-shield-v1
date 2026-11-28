'use client';

import { Card, Container, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { PageShell } from '@/components/site-chrome';
import { useBrowserValue } from '@/lib/use-browser-value';

const CODE = /^#c=([0-9A-Za-z-]{6,20})$/;

export function AppClaim() {
  const { t } = useI18n();
  const code = useBrowserValue(() => CODE.exec(window.location.hash)?.[1] ?? null, null);
  return (
    <PageShell title={t('appClaim.title')}>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            {code ? (
              <>
                <Text>{t('appClaim.lead')}</Text>
                <a
                  href={`parkshield://aktivieren#c=${encodeURIComponent(code)}`}
                  className="bg-primary text-primary-fg flex min-h-14 items-center justify-center rounded-xl px-4 font-bold"
                >
                  {t('appLink.open')}
                </a>
                <Text muted>{t('appLink.noApp')}</Text>
              </>
            ) : (
              <Notice tone="warning">{t('appClaim.invalid')}</Notice>
            )}
            <Link
              href="/app"
              className="text-primary min-h-12 content-center font-semibold underline"
            >
              {t('appPage.nav')}
            </Link>
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
