'use client';

import { Card, Container, Notice, Stack, Text, useI18n } from '@parkshield/ui';
import { useEffect, useMemo, useState } from 'react';
import { PageShell } from '@/components/site-chrome';
import { useBrowserValue } from '@/lib/use-browser-value';

const DEFAULT_RETURN = 'parkshield://auth/callback';

interface Fragment {
  token: string | null;
  rid: string | null;
  code: string | null;
}

function parseFragment(hash: string): Fragment {
  const q = new URLSearchParams(hash.slice(1));
  const token = q.get('t');
  const rid = q.get('r');
  const code = q.get('c');
  return {
    token: token && /^[A-Za-z0-9_-]{20,100}$/.test(token) ? token : null,
    rid: rid && /^[A-Za-z0-9_-]{16,40}$/.test(rid) ? rid : null,
    code: code && /^\d{6}$/.test(code) ? code : null,
  };
}

export function AuthOpen() {
  const { t } = useI18n();
  // A string snapshot (stable for useSyncExternalStore), parsed once.
  const hash = useBrowserValue<string | null>(() => window.location.hash, null);
  const f = useMemo(() => (hash === null ? null : parseFragment(hash)), [hash]);
  const [target, setTarget] = useState<string | null>(null);

  // Where the app listens (its own scheme, or Expo Go during development); kept on the server.
  useEffect(() => {
    if (!f?.rid) return;
    let live = true;
    void fetch(`/v1/auth/email/return/${f.rid}`, { credentials: 'omit' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { url?: string } | null) => live && setTarget(b?.url ?? DEFAULT_RETURN))
      .catch(() => live && setTarget(DEFAULT_RETURN));
    return () => {
      live = false;
    };
  }, [f?.rid]);

  const href = f?.token && target ? `${target}?token=${encodeURIComponent(f.token)}` : null;

  return (
    <PageShell title={t('authOpen.title')}>
      <Container className="max-w-2xl py-10">
        <Card>
          <Stack gap={4}>
            {f && !f.token ? (
              <Notice tone="warning">{t('authOpen.invalid')}</Notice>
            ) : (
              <>
                <Text>{t('authOpen.lead')}</Text>
                {href ? (
                  <a
                    href={href}
                    className="bg-primary text-primary-fg flex min-h-14 items-center justify-center rounded-xl px-4 font-bold"
                  >
                    {t('authOpen.open')}
                  </a>
                ) : (
                  <Text muted>{t('authOpen.loading')}</Text>
                )}
                {f?.code && (
                  <Text>
                    {t('authOpen.fallback')}{' '}
                    <span className="font-mono text-xl font-bold tracking-widest">{f.code}</span>
                  </Text>
                )}
              </>
            )}
          </Stack>
        </Card>
      </Container>
    </PageShell>
  );
}
