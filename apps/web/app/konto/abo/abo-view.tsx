'use client';

import { Badge, Button, Text, useI18n } from '@parkshield/ui';
import { Icon } from '@/components/icons';
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

      {subscription?.plan === 'plus' && <UpgradeCard />}

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

/** A paying Plus customer sees the way up, never the checkout again. Premium opens on 9 Nov 2027. */
function UpgradeCard() {
  const { t } = useI18n();
  const features = [
    t('landing.premiumF2'),
    t('landing.premiumF3'),
    t('landing.premiumF4'),
    t('landing.premiumF5'),
  ];
  return (
    <Section
      title={t('portal.upgradeTitle')}
      icon="zap"
      intro={t('portal.upgradeIntro')}
      aside={<Badge tone="info">{t('portal.upgradeBadge')}</Badge>}
    >
      <ul className="flex flex-col gap-2">
        {features.map((f) => (
          <li key={f} className="flex items-start gap-2">
            <Icon name="check" className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>{f}</span>
          </li>
        ))}
      </ul>
      <Text muted>{t('portal.upgradeSoon')}</Text>
    </Section>
  );
}
