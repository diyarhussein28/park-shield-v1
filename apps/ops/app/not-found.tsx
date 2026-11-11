'use client';

import { Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';

/** Our own 404 with a main landmark and a way back (WCAG 1.3.1, 2.4.5). */
export default function NotFound() {
  const { t } = useI18n();
  return (
    <main id="main">
      <Container className="py-12">
        <Stack gap={3}>
          <Heading level={1}>{t('common.notFoundTitle')}</Heading>
          <Text>{t('common.notFoundText')}</Text>
          <Link href="/" className="text-primary underline">
            {t('common.notFoundBack')}
          </Link>
        </Stack>
      </Container>
    </main>
  );
}
