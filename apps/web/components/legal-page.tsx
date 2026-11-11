'use client';

import { Container, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { legalContent, type LegalSlug } from '@/lib/legal-content';
import { PageShell } from './site-chrome';

export function LegalPage({ slug }: { slug: LegalSlug }) {
  const { locale, t } = useI18n();
  const doc = legalContent[locale][slug];
  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <Heading level={1}>{doc.title}</Heading>
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
