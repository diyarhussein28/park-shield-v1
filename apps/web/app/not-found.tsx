'use client';

import { Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { PageShell } from '@/components/site-chrome';

/** Our own 404 inside the normal header and footer, with a way on (WCAG 1.3.1, 2.4.5). */
export default function NotFound() {
  const { t } = useI18n();
  return (
    <PageShell>
      <Container className="py-12">
        <Stack gap={3}>
          <Heading level={1}>{t('common.notFoundTitle')}</Heading>
          <Text>{t('common.notFoundText')}</Text>
          <div className="flex flex-wrap gap-4">
            <Link href="/" className="text-primary underline">
              {t('common.notFoundBack')}
            </Link>
            <Link href="/hilfe" className="text-primary underline">
              {t('common.footer.help')}
            </Link>
          </div>
        </Stack>
      </Container>
    </PageShell>
  );
}
