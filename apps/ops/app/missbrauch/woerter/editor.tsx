'use client';

import {
  Badge,
  Button,
  Card,
  Field,
  Heading,
  Input,
  Notice,
  Stack,
  Text,
  Textarea,
  useI18n,
} from '@parkshield/ui';
import { useState, type FormEvent } from 'react';
import { OpsShell } from '@/components/ops-shell';
import { opsApi } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

type Lists = { insults: { de: string[]; en: string[] }; threats: { de: string[]; en: string[] } };
export interface Versions {
  versions: {
    version: number;
    words: Lists;
    note: string | null;
    createdAt: string;
    createdBy: string | null;
  }[];
}
const FIELDS = [
  ['insults', 'de'],
  ['insults', 'en'],
  ['threats', 'de'],
  ['threats', 'en'],
] as const;

/** AD-10: edit, publish (new version, live at once), roll back (an old version republished). */
export function WordListsEditor({ me, initial }: { me: StaffMe; initial: Versions | null }) {
  const { t } = useI18n();
  const [versions, setVersions] = useState(initial?.versions ?? []);
  const current = versions[0];
  const toText = (l?: Lists) =>
    Object.fromEntries(
      FIELDS.map(([k, lang]) => [`${k}_${lang}`, (l?.[k][lang] ?? []).join('\n')]),
    ) as Record<string, string>;
  const [text, setText] = useState(toText(current?.words));
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  const reload = async () => {
    const v = (await opsApi<Versions>('/ops/v1/abuse/word-lists')).versions;
    setVersions(v);
    setText(toText(v[0]?.words));
  };
  const lines = (s: string) =>
    s
      .split('\n')
      .map((w) => w.trim())
      .filter(Boolean);

  async function publish(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      const words: Lists = {
        insults: { de: lines(text.insults_de!), en: lines(text.insults_en!) },
        threats: { de: lines(text.threats_de!), en: lines(text.threats_en!) },
      };
      const r = await opsApi<{ version: number }>('/ops/v1/abuse/word-lists', {
        body: { words, note },
      });
      setMessage({ tone: 'success', text: t('opsWords.published', { version: r.version }) });
      setNote('');
      await reload();
    } catch {
      setMessage({ tone: 'danger', text: t('ops.error') });
    }
  }

  async function rollback(version: number) {
    const r = await opsApi<{ version: number }>(`/ops/v1/abuse/word-lists/${version}/rollback`, {
      body: {},
    });
    setMessage({ tone: 'success', text: t('opsWords.published', { version: r.version }) });
    await reload();
  }

  return (
    <OpsShell me={me}>
      <Stack gap={6}>
        <div>
          <Heading level={1}>{t('opsWords.title')}</Heading>
          <Text muted>{t('opsWords.intro')}</Text>
        </div>
        {!initial && <Notice tone="danger">{t('ops.forbidden')}</Notice>}
        {message && <Notice tone={message.tone}>{message.text}</Notice>}
        <Card>
          <form onSubmit={publish} className="flex flex-col gap-4">
            <div className="grid gap-4 md:grid-cols-2">
              {FIELDS.map(([k, lang]) => (
                <Field
                  key={`${k}_${lang}`}
                  label={t(`opsWords.${k}_${lang}`)}
                  hint={t('opsWords.hint')}
                >
                  {({ id, describedBy }) => (
                    <Textarea
                      id={id}
                      aria-describedby={describedBy}
                      className="min-h-48 font-mono"
                      value={text[`${k}_${lang}`]}
                      onChange={(e) => setText((x) => ({ ...x, [`${k}_${lang}`]: e.target.value }))}
                    />
                  )}
                </Field>
              ))}
            </div>
            <Field label={t('opsWords.note')}>
              {({ id }) => (
                <Input
                  id={id}
                  required
                  minLength={3}
                  maxLength={200}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
            <Button type="submit" className="w-fit">
              {t('opsWords.publish')}
            </Button>
          </form>
        </Card>
        <Card>
          <Stack gap={2}>
            <Heading level={2} className="text-xl">
              {t('opsWords.versions')}
            </Heading>
            <ul className="flex flex-col gap-2" aria-label={t('opsWords.versions')}>
              {versions.map((v, i) => (
                <li key={v.version} className="flex flex-wrap items-center gap-3">
                  <span>
                    {t('opsWords.version', {
                      version: v.version,
                      date: new Date(v.createdAt),
                      by: v.createdBy ?? 'Seed',
                    })}
                  </span>
                  {v.note && <span className="text-muted">„{v.note}“</span>}
                  {i === 0 ? (
                    <Badge tone="success">{t('opsWords.current')}</Badge>
                  ) : (
                    <Button variant="ghost" onClick={() => rollback(v.version)}>
                      {t('opsWords.rollback')}
                      <span className="sr-only"> ({v.version})</span>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Stack>
        </Card>
      </Stack>
    </OpsShell>
  );
}
