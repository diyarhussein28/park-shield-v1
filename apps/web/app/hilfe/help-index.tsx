'use client';

import type { MessageKey } from '@parkshield/i18n';
import { Card, Container, Field, Heading, Input, Stack, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { HELP_ARTICLES, HELP_CATEGORIES, searchText } from '@/lib/help-articles';

/** SP-01 help centre: search over all 20 articles, grouped by topic, and the way to the contact form. */
export function HelpIndex() {
  const { t, locale } = useI18n();
  const [q, setQ] = useState('');
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hits = useMemo(
    () => HELP_ARTICLES.filter((a) => words.every((w) => searchText(a, locale).includes(w))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [q, locale],
  );

  return (
    <PageShell>
      <Container className="py-10">
        <Stack gap={6}>
          <div>
            <Heading level={1}>{t('help.title')}</Heading>
            <Text muted>{t('help.intro')}</Text>
          </div>
          <form role="search" onSubmit={(e) => e.preventDefault()} className="max-w-xl">
            <Field label={t('help.searchLabel')}>
              {({ id }) => (
                <Input id={id} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
              )}
            </Field>
          </form>
          {words.length > 0 ? (
            <section aria-labelledby="results">
              <Heading level={2} id="results" className="text-xl">
                {t('help.results', { count: hits.length })}
              </Heading>
              <ul className="mt-3 flex flex-col gap-3" aria-live="polite">
                {hits.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={`/hilfe/${a.slug}`}
                      className="font-semibold text-primary underline"
                    >
                      {a[locale].title}
                    </Link>
                    <p className="text-muted">{a[locale].summary}</p>
                  </li>
                ))}
              </ul>
            </section>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {HELP_CATEGORIES.map((c) => (
                <Card key={c}>
                  <Stack gap={3}>
                    <Heading level={2} className="text-xl">
                      {t(`help.cat_${c}` as MessageKey)}
                    </Heading>
                    <ul className="flex flex-col gap-2">
                      {HELP_ARTICLES.filter((a) => a.category === c).map((a) => (
                        <li key={a.slug}>
                          <Link href={`/hilfe/${a.slug}`} className="text-primary underline">
                            {a[locale].title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </Stack>
                </Card>
              ))}
            </div>
          )}
          <Card>
            <Stack gap={2}>
              <Heading level={2} className="text-xl">
                {t('help.contactTitle')}
              </Heading>
              <Text>{t('help.contactIntro')}</Text>
              <Link
                href="/hilfe/kontakt"
                className="inline-flex min-h-12 w-fit items-center rounded-xl bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover"
              >
                {t('help.contactLink')}
              </Link>
            </Stack>
          </Card>
        </Stack>
      </Container>
    </PageShell>
  );
}
