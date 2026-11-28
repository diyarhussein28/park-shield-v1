'use client';

import { Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { legalDoc, type LegalContext, type LegalSlug } from '@parkshield/shared';
import { PageShell } from './site-chrome';

export function LegalPage({ slug, context }: { slug: LegalSlug; context?: LegalContext }) {
  const { locale, t } = useI18n();
  const doc = legalDoc(locale, slug, context);
  return (
    <PageShell title={doc.title}>
      <Container className="py-10">
        <Stack gap={6}>
          <Notice tone="warning">
            {t('legal.draft')}
            {locale !== 'de' && ` ${t('legal.courtesy')}`}
          </Notice>
          {doc.sections.map((s) => (
            <section key={s.heading}>
              <Heading level={2} className="mb-3 text-xl">
                {s.heading}
              </Heading>
              <Stack gap={3}>
                {s.paragraphs.map((p) => (
                  <Text key={p}>{p}</Text>
                ))}
              </Stack>
            </section>
          ))}
        </Stack>
      </Container>
    </PageShell>
  );
}
