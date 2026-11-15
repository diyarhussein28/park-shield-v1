'use client';

import { useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { AuthFrame } from '@/components/auth-frame';

/** Our own 404 with a main landmark and a way back (WCAG 1.3.1, 2.4.5). */
export default function NotFound() {
  const { t } = useI18n();
  return (
    <AuthFrame title={t('common.notFoundTitle')}>
      <p>{t('common.notFoundText')}</p>
      <Link href="/" className="font-semibold text-primary underline">
        {t('common.notFoundBack')}
      </Link>
    </AuthFrame>
  );
}
