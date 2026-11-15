'use client';

import { Button, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { KontoShell, Section } from '@/components/konto-shell';
import type { CreditNote, InvoiceSummary, Me, SubscriptionSummary } from '@/lib/api-server';
import {
  CheckoutForm,
  Invoices,
  openPaymentPortal,
  Passkeys,
  PastDue,
  SubscriptionInfo,
  SummarySettings,
} from '../parts';

/** Everything about the contract and the account itself, kept off the overview page. */
export function AboView({
  me,
  subscription,
  invoices,
  creditNotes,
}: {
  me: Me;
  subscription: SubscriptionSummary | null;
  invoices: InvoiceSummary[];
  creditNotes: CreditNote[];
}) {
  const { t } = useI18n();
  return (
    <KontoShell title={t('portal.planTitle')} intro={t('portal.planIntro')}>
      {subscription?.status === 'past_due' && <PastDue />}
      <Section title={t('account.subscription')} icon="card">
        {subscription ? (
          <>
            <SubscriptionInfo sub={subscription} />
            <Button variant="secondary" onClick={() => void openPaymentPortal()} className="w-fit">
              {t('account.paymentMethod')}
            </Button>
          </>
        ) : (
          <CheckoutForm />
        )}
      </Section>

      <Invoices invoices={invoices} creditNotes={creditNotes} />

      {subscription && <SummarySettings initial={me.summaryFrequency} />}

      <Passkeys initial={me.passkeys} />

      {subscription && !subscription.cancelAtPeriodEnd && (
        <Section title={t('account.cancelTitle')} icon="close">
          <Text>{t('account.cancelText')}</Text>
          <Link
            href="/kuendigen"
            className="inline-flex min-h-12 w-fit items-center rounded-xl border-2 border-fg px-4 font-semibold"
          >
            {t('common.footer.cancelContract')}
          </Link>
        </Section>
      )}
    </KontoShell>
  );
}
