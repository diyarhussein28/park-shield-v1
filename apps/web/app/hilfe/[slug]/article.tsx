'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Card, Container, Heading, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { PageShell } from '@/components/site-chrome';
import { articleBySlug, HELP_ARTICLES } from '@/lib/help-articles';

export function ArticleView({ slug }: { slug: string }) {
  const { t, locale } = useI18n();
  const a = articleBySlug(slug)!;
  const text = a[locale];
  const related = HELP_ARTICLES.filter((x) => x.category === a.category && x.slug !== slug).slice(
    0,
    3,
  );
  return (
    <PageShell>
      <Container className="max-w-3xl py-10">
        <Stack gap={6}>
          <nav aria-label={t('help.breadcrumb')}>
            <Link href="/hilfe" className="text-primary underline">
              {t('help.title')}
            </Link>{' '}
            › {t(`help.cat_${a.category}` as MessageKey)}
          </nav>
          <article className="flex flex-col gap-4">
            <Heading level={1}>{text.title}</Heading>
            <Text className="text-lg">{text.summary}</Text>
            {text.body.map((p) => (
              <Text key={p.slice(0, 32)}>{p}</Text>
            ))}
            {a.action && (
              <Link
                href={a.action.href}
                className="inline-flex min-h-12 w-fit items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
              >
                {a.action[locale]}
              </Link>
            )}
          </article>
          {related.length > 0 && (
            <section aria-labelledby="related">
              <Heading level={2} id="related" className="text-xl">
                {t('help.related')}
              </Heading>
              <ul className="mt-2 flex flex-col gap-2">
                {related.map((r) => (
                  <li key={r.slug}>
                    <Link href={`/hilfe/${r.slug}`} className="text-primary underline">
                      {r[locale].title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <Card>
            <Stack gap={2}>
              <Text className="font-semibold">{t('help.notSolved')}</Text>
              <Link href="/hilfe/kontakt" className="text-primary underline">
                {t('help.contactLink')}
              </Link>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
