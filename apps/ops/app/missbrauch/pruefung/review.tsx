'use client';

import { Button, Card, Heading, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useState } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

export interface ReviewData {
  items: { id: string; rule: string; createdAt: string; language: string; text: string }[];
  week: { reviewed: number; falsePositive: number; rate: number | null };
}
const DECISIONS = ['correct_block', 'false_positive', 'unclear'] as const;

/** AD-09: sampled blocked texts, decided one by one; the weekly false-positive rate on top. */
export function ReviewQueue({ me, initial }: { me: StaffMe; initial: ReviewData | null }) {
  const { t } = useI18n();
  const [items, setItems] = useState(initial?.items ?? []);
  const week = initial?.week;

  async function decide(id: string, decision: (typeof DECISIONS)[number]) {
    await opsApi(`/ops/v1/abuse/reviews/${id}`, { body: { decision } });
    setItems((list) => list.filter((i) => i.id !== id));
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsReview.title')}</Heading>
          <Text muted>{t('opsReview.intro')}</Text>
          {week && (
            <Text className="mt-2 font-semibold">
              {t('opsReview.week', {
                reviewed: week.reviewed,
                fp: week.falsePositive,
                rate: week.rate === null ? '' : ` (${Math.round(week.rate * 100)} %)`,
              })}
            </Text>
          )}
        </div>
        {!initial && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {initial && items.length === 0 && <Text>{t('opsReview.none')}</Text>}
        <ul className="flex flex-col gap-3" aria-label={t('opsReview.title')}>
          {items.map((i) => (
            <li key={i.id}>
              <Card>
                <Stack gap={2}>
                  <Text muted className="text-sm">
                    {t('opsReview.rule', { rule: i.rule })} · {i.language}
                  </Text>
                  <blockquote className="rounded-xl bg-surface px-4 py-3">{i.text}</blockquote>
                  <div className="flex flex-wrap gap-2">
                    {DECISIONS.map((d) => (
                      <Button
                        key={d}
                        variant={d === 'false_positive' ? 'secondary' : 'ghost'}
                        onClick={() => decide(i.id, d)}
                      >
                        {t(`opsReview.${d}`)}
                      </Button>
                    ))}
                  </div>
                </Stack>
              </Card>
            </li>
          ))}
        </ul>
      </Stack>
    </OpsShell>
  );
}
