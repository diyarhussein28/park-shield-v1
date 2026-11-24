'use client';

import { Card, Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { PageShell } from '@/components/site-chrome';
import { useBrowserValue } from '@/lib/use-browser-value';

const TOKEN = /^#t=([A-Za-z0-9_-]{20,100})$/;

export function AppSignIn() {
  const { t } = useI18n();
  const token = useBrowserValue(() => TOKEN.exec(window.location.hash)?.[1] ?? null, null);
  return (
    <PageShell>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            <Heading level={1} className="text-2xl">
              {t('appLink.title')}
            </Heading>
            {token ? (
              <>
                <Text>{t('appLink.lead')}</Text>
                <a
                  href={`parkshield://anmelden#t=${token}`}
                  className="bg-primary text-primary-fg flex min-h-14 items-center justify-center rounded-xl px-4 font-bold"
                >
                  {t('appLink.open')}
                </a>
                <Text muted>{t('appLink.noApp')}</Text>
              </>
            ) : (
              <Notice tone="warning">{t('appLink.invalid')}</Notice>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
