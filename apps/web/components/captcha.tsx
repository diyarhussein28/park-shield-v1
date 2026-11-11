'use client';

import { Text, useI18n } from '@parkshield/ui';
import { useEffect, useRef, useState } from 'react';

const SITEKEY = process.env.NEXT_PUBLIC_FRIENDLY_CAPTCHA_SITEKEY ?? '';
export const DEV_CAPTCHA_SOLUTION = 'dev-captcha-ok';

/**
 * Friendly Captcha (proof of work, no cookies, EU endpoint). Without a sitekey the API runs its local fake,
 * which accepts a fixed solution; the UI says so instead of pretending.
 */
export function Captcha({ onSolved }: { onSolved: (solution: string | undefined) => void }) {
  const { t, locale } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [handle, setHandle] = useState<{ destroy(): void } | null>(null);

  useEffect(() => {
    if (!SITEKEY) {
      onSolved(DEV_CAPTCHA_SOLUTION);
      return;
    }
    let widget: { destroy(): void } | null = null;
    let cancelled = false;
    void import('@friendlycaptcha/sdk').then(({ FriendlyCaptchaSDK }) => {
      if (cancelled || !ref.current) return;
      const sdk = new FriendlyCaptchaSDK({ apiEndpoint: 'eu' });
      const w = sdk.createWidget({
        element: ref.current,
        sitekey: SITEKEY,
        language: locale,
        startMode: 'auto',
      });
      w.addEventListener('frc:widget.complete', (e) => onSolved(e.detail.response));
      w.addEventListener('frc:widget.expire', () => onSolved(undefined));
      widget = w;
      setHandle(w);
    });
    return () => {
      cancelled = true;
      widget?.destroy();
    };
  }, [locale, onSolved]);

  if (!SITEKEY) {
    return (
      <Text muted className="text-sm" data-testid="captcha-local">
        {t('auth.captchaLocal')}
      </Text>
    );
  }
  return <div ref={ref} data-ready={Boolean(handle)} />;
}
