'use client';

import { Text, useI18n } from '@parkshield/ui';
import { useEffect } from 'react';

/**
 * AD-20: target of the link field in Zammad's ticket sidebar
 * (https://ops…/zammad?email=#{ticket.customer.email}). The staff cookie is SameSite=Strict and is not
 * sent on this cross-site navigation, so this page only forwards to the summary from our own origin,
 * where the cookie is sent again.
 */
export default function ZammadEntry() {
  const { t } = useI18n();
  useEffect(() => {
    const email = new URLSearchParams(window.location.search).get('email') ?? '';
    window.location.replace(`/kunden/zammad?email=${encodeURIComponent(email)}`);
  }, []);
  return (
    <main id="main" className="p-8">
      <Text>{t('ops.loading')}</Text>
    </main>
  );
}
