import type { Db } from '../core/core.module';

export const PAYMENT_NOTIFY_TOPIC = 'payment.notify';
export const PAYMENT_ATTACHMENT_TOPIC = 'payment.notify_attachment';

export type PaymentKind = 'subscription' | 'renewal' | 'print_order';

/**
 * Records a payment for the payment mailbox once per Stripe event and queues its mail (2026-11-22).
 * Kept free of other services (like letters/trigger.ts) so the billing service can call it without an
 * import cycle; the worker's PaymentNotifyService sends the mail.
 */
export async function queuePaymentNotification(
  db: Pick<Db, 'insertInto'>,
  input: {
    eventId: string;
    kind: PaymentKind;
    userId: string;
    subscriptionId?: string | null;
    orderId?: string | null;
    amountCents: number;
    paymentRef: string | null;
    paidAt: Date;
  },
): Promise<boolean> {
  const row = await db
    .insertInto('payment_notifications')
    .values({
      stripe_event_id: input.eventId,
      kind: input.kind,
      user_id: input.userId,
      subscription_id: input.subscriptionId ?? null,
      order_id: input.orderId ?? null,
      amount_cents: input.amountCents,
      payment_ref: input.paymentRef,
      paid_at: input.paidAt,
    })
    .onConflict((oc) => oc.column('stripe_event_id').doNothing())
    .returning('id')
    .executeTakeFirst();
  if (!row) return false;
  await db
    .insertInto('outbox_events')
    .values({ topic: PAYMENT_NOTIFY_TOPIC, payload: JSON.stringify({ id: row.id }) })
    .execute();
  return true;
}
