'use client';

import { Button, Text, useI18n } from '@parkshield/ui';
import Link from 'next/link';
import { KontoShell, Section } from '@/components/konto-shell';
import type { CreditNote, InvoiceSummary, Me, SubscriptionSummary } from '@/lib/api-server';
import {
  CheckoutForm,
  Invoices,
  isStoreSubscription,
  openPaymentPortal,
  Passkeys,
  PastDue,
  PlanFeatures,
  storeManageUrl,
  storeRefundUrl,
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
  const store = subscription ? isStoreSubscription(subscription) : false;
  return (
    <KontoShell title={t('portal.planTitle')} intro={t('portal.planIntro')}>
      {subscription?.status === 'past_due' && <PastDue sub={subscription} />}
      <Section title={t('account.subscription')} icon="card">
        {subscription ? (
          <>
            <SubscriptionInfo sub={subscription} />
            {store ? (
              // Apple/Google are the seller: payment method and receipts live in the store (A6).
              <Text muted data-testid="store-receipts">
                {t('account.storeReceipts', { provider: subscription.provider! })}
              </Text>
            ) : (
              <Button
                variant="secondary"
                onClick={() => void openPaymentPortal()}
                className="w-fit"
              >
                {t('account.paymentMethod')}
              </Button>
            )}
            <h3 className="font-semibold">{t('account.planIncludes')}</h3>
            <PlanFeatures />
          </>
        ) : (
          <CheckoutForm />
        )}
      </Section>

      {subscription && <ContractCard sub={subscription} />}

      {!store && <Invoices invoices={invoices} creditNotes={creditNotes} />}

      {subscription && <SummarySettings initial={me.summaryFrequency} />}

      <Passkeys initial={me.passkeys} />
    </KontoShell>
  );
}

const contractButton =
  'inline-flex min-h-12 w-fit items-center rounded-xl border-2 border-fg px-4 font-semibold hover:bg-secondary';

/**
 * One card „Vertrag“ (2026-11-21): during the withdrawal period the withdrawal comes first, with its
 * own button in the same style as the cancel button, so it stays permanently available and easy to
 * reach where the contract was concluded (§ 356a BGB); after the period only the cancel part remains.
 * The public pages /widerrufen and /kuendigen and their footer links stay unchanged.
 */
// TODO [LEGAL REVIEW] wording and placement of the withdrawal and cancellation buttons (§ 356a, § 312k BGB).
function ContractCard({ sub }: { sub: SubscriptionSummary }) {
  const { t } = useI18n();
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const withdrawable = sub.withdrawalOpenUntil ? new Date(sub.withdrawalOpenUntil) : null;
  if (!withdrawable && sub.cancelAtPeriodEnd && !end) return null;
  if (isStoreSubscription(sub)) return <StoreContractCard sub={sub} />;
  return (
    <Section title={t('account.contractTitle')} icon="close">
      {withdrawable && (
        <div className="flex flex-col gap-3 border-b border-border pb-5">
          <Text>{t('account.withdrawUntil', { date: withdrawable })}</Text>
          <Link href="/widerrufen" className={contractButton}>
            {t('common.footer.withdrawContract')}
          </Link>
        </div>
      )}
      {sub.cancelAtPeriodEnd ? (
        end && <Text>{t('account.canceledText', { date: end })}</Text>
      ) : (
        <div className="flex flex-col gap-3">
          <Text>{t('account.cancelText')}</Text>
          <Link href="/kuendigen" className={contractButton}>
            {t('account.cancelButton')}
          </Link>
        </div>
      )}
    </Section>
  );
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * App Store / Google Play subscriptions (A6): Apple or Google is the seller. „Vertrag hier kündigen“
 * opens the store's subscription management (we cannot cancel a store subscription), and „Vertrag
 * widerrufen“ stays on the card but leads to the store's official refund route.
 */
// TODO [LEGAL REVIEW] § 312k / § 356a BGB for store purchases: is linking to the store enough?
function StoreContractCard({ sub }: { sub: SubscriptionSummary }) {
  const { t } = useI18n();
  const provider = sub.provider!;
  const end = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
  const withdrawable = sub.withdrawalOpenUntil ? new Date(sub.withdrawalOpenUntil) : null;
  return (
    <Section title={t('account.contractTitle')} icon="close">
      {withdrawable && (
        <div
          className="flex flex-col gap-3 border-b border-border pb-5"
          data-testid="store-withdraw"
        >
          <Text>{t('account.withdrawUntil', { date: withdrawable })}</Text>
          <Text>{t('account.storeWithdrawText', { provider })}</Text>
          <a href={storeRefundUrl(sub)} {...external} className={contractButton}>
            {t('common.footer.withdrawContract')}
          </a>
        </div>
      )}
      {sub.cancelAtPeriodEnd ? (
        end && <Text>{t('account.canceledText', { date: end })}</Text>
      ) : (
        <div className="flex flex-col gap-3" data-testid="store-cancel">
          <Text>{t('account.storeCancelText', { provider })}</Text>
          <a href={storeManageUrl(sub)} {...external} className={contractButton}>
            {t('account.cancelButton')}
          </a>
        </div>
      )}
    </Section>
  );
}
