'use client';

import type { MessageKey } from '@parkshield/i18n';
import {
  Button,
  Card,
  Checkbox,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  useI18n,
} from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { api, ApiError, errorText } from '@/lib/api-client';
import type { QuietHours, QuietRule } from '@/lib/api-server';

const DAYS = [0, 1, 2, 3, 4, 5, 6];

/** OW-06 / US-26: quiet hours per weekday; urgent alerts bypass them by default. */
export function QuietHoursCard({ initial }: { initial: QuietHours }) {
  const { t } = useI18n();
  const [data, setData] = useState(initial);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4, 5, 6]);
  const [start, setStart] = useState('22:00');
  const [end, setEnd] = useState('07:00');
  const [urgentBypass, setUrgentBypass] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dayText = (list: number[]) => {
    const key = list.join(',');
    if (key === '0,1,2,3,4,5,6') return t('quiet.everyDay');
    if (key === '0,1,2,3,4') return t('quiet.weekdays');
    if (key === '5,6') return t('quiet.weekend');
    return list.map((d) => t(`quiet.day${d}` as MessageKey)).join(', ');
  };
  const ruleText = (r: QuietRule) =>
    t('quiet.rule', { days: dayText(r.days), start: r.start, end: r.end });

  async function add(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!days.length) {
      setError(t('quiet.daysRequired'));
      return;
    }
    setBusy(true);
    try {
      setData(
        await api<QuietHours>('/v1/quiet-hours', {
          body: { days: [...days].sort(), start, end, urgentBypass },
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.body?.error === 'rule_limit'
          ? t('quiet.limit', { limit: 7 })
          : errorText(err, t),
      );
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await api(`/v1/quiet-hours/${id}`, { method: 'DELETE' });
    setData(await api<QuietHours>('/v1/quiet-hours'));
  }

  return (
    <Card>
      <Stack gap={3}>
        <Heading level={2} className="text-xl">
          {t('quiet.title')}
        </Heading>
        <Text>{t('quiet.intro')}</Text>
        {data.rules.length === 0 ? (
          <Text muted>{t('quiet.none')}</Text>
        ) : (
          <ul className="flex flex-col gap-2" aria-label={t('quiet.title')}>
            {data.rules.map((r) => (
              <li
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-4 py-2"
              >
                <span>
                  <span className="font-semibold">{ruleText(r)}</span>
                  <span className="text-muted">
                    {' '}
                    · {r.urgentBypass ? t('quiet.ruleUrgent') : t('quiet.ruleAll')}
                  </span>
                </span>
                <Button
                  variant="ghost"
                  onClick={() => remove(r.id)}
                  aria-label={t('quiet.removeLabel', { rule: ruleText(r) })}
                >
                  {t('quiet.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={add} className="flex flex-col gap-4 border-t border-border pt-4">
          <Heading level={3} className="text-lg">
            {t('quiet.add')}
          </Heading>
          <fieldset>
            <legend className="mb-2 font-semibold">{t('quiet.days')}</legend>
            <div className="flex flex-wrap gap-x-4">
              {DAYS.map((d) => (
                <Checkbox
                  key={d}
                  label={
                    <>
                      <span aria-hidden="true">{t(`quiet.day${d}` as MessageKey)}</span>
                      <span className="sr-only">{t(`quiet.dayLong${d}` as MessageKey)}</span>
                    </>
                  }
                  checked={days.includes(d)}
                  onChange={(e) =>
                    setDays((list) =>
                      e.target.checked ? [...list, d] : list.filter((x) => x !== d),
                    )
                  }
                />
              ))}
            </div>
          </fieldset>
          <div className="grid max-w-md grid-cols-2 gap-4">
            <Field label={t('quiet.from')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  required
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              )}
            </Field>
            <Field label={t('quiet.to')}>
              {({ id }) => (
                <Input
                  id={id}
                  type="time"
                  required
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              )}
            </Field>
          </div>
          <Text muted className="text-sm">
            {t('quiet.overnight')} {t('quiet.timezone', { timezone: data.timezone })}
          </Text>
          <div>
            <Checkbox
              label={t('quiet.urgentBypass')}
              checked={urgentBypass}
              onChange={(e) => setUrgentBypass(e.target.checked)}
            />
            <Text muted className="text-sm">
              {t('quiet.urgentHint')}
            </Text>
          </div>
          {error && <Notice tone="danger">{error}</Notice>}
          <Button type="submit" busy={busy} className="w-fit">
            {t('quiet.add')}
          </Button>
        </form>
      </Stack>
    </Card>
  );
}
