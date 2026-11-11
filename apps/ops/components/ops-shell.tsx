'use client';

import { Button, Container, LanguageSwitch, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { useEffect, type ReactNode } from 'react';
import { opsApi } from '@/lib/api';
import type { StaffMe } from '@/lib/server';

const IDLE_MS = 30 * 60_000;

/**
 * Frame for signed-in pages. The server ends a staff session after 30 min without a request; this
 * timer also leaves the page after 30 min without input, so nothing stays open on an unattended screen.
 */
export function OpsShell({ me, children }: { me: StaffMe; children: ReactNode }) {
  const { t } = useI18n();

  useEffect(() => {
    let timer = setTimeout(leave, IDLE_MS);
    function leave() {
      window.location.assign('/anmelden?abgelaufen=1');
    }
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(leave, IDLE_MS);
    };
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, []);

  async function logout() {
    await opsApi('/ops/v1/auth/logout', { body: {} }).catch(() => {});
    window.location.assign('/anmelden');
  }

  const can = (p: string) => me.permissions.includes(p);
  // The menu mirrors permissions; the API checks them again on every call.
  const items: { href: string; label: string; show: boolean }[] = [
    { href: '/', label: t('ops.navHome'), show: true },
    { href: '/kunden', label: t('ops.navCustomers'), show: can('customer.read_masked') },
    {
      href: '/break-glass',
      label: t('ops.navBreakGlass'),
      show: can('pii.decrypt_request') || can('pii.decrypt_approve'),
    },
    { href: '/datenschutz', label: t('ops.navDsr'), show: can('dsr.process') },
    { href: '/missbrauch', label: t('ops.navAbuse'), show: can('abuse.moderate') },
    { href: '/missbrauch/pruefung', label: t('ops.navReview'), show: can('moderation.review') },
    { href: '/missbrauch/woerter', label: t('ops.navWords'), show: can('abuse.moderate') },
    { href: '/bestellungen', label: t('ops.navOrders'), show: can('orders.manage') },
    {
      href: '/partner',
      label: t('ops.navPartners'),
      show: can('partners.manage') || can('tokens.manage'),
    },
    { href: '/gutscheine', label: t('ops.navPromos'), show: can('promo.manage') },
    { href: '/einstellungen', label: t('ops.navSettings'), show: can('settings.edit') },
    { href: '/einstellungen/anbieter', label: t('ops.navHealth'), show: can('settings.edit') },
    { href: '/audit', label: t('ops.navAudit'), show: can('audit.read') },
    { href: '/mitarbeitende', label: t('ops.navStaff'), show: can('staff.manage') },
  ];
  return (
    <>
      <header className="border-b border-border">
        <Container className="flex flex-wrap items-center justify-between gap-3 py-3">
          <nav aria-label="Ops" className="flex flex-wrap items-center gap-4">
            <Link href="/" className="font-bold">
              {t('ops.title')}
            </Link>
            {items
              .filter((i) => i.show)
              .map((i) => (
                <Link key={i.href} href={i.href} className="text-primary underline">
                  {i.label}
                </Link>
              ))}
          </nav>
          {/* Wraps on phones: a long staff address must not push the page wider than the screen. */}
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <Text muted className="text-sm">
              {t('ops.welcome', { email: me.email })}
            </Text>
            <LanguageSwitch />
            <Button variant="secondary" onClick={logout}>
              {t('ops.logout')}
            </Button>
          </div>
        </Container>
      </header>
      <main id="main">
        <Container className="py-8">{children}</Container>
      </main>
    </>
  );
}
