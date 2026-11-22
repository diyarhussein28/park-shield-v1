import type { Logger } from 'pino';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOGGER } from '../core/tokens';
import { WelcomeLettersService } from '../letters/welcome-letters.service';
import { MailService } from '../mail/mail.service';
import {
  createHarness,
  mailbox,
  resetState,
  subscribe,
  type Harness,
  type Session,
} from '../test/harness';
import {
  PAYMENT_ATTACHMENT_TOPIC,
  PAYMENT_NOTIFY_TOPIC,
  PaymentNotifyService,
  letterFileName,
  queuePaymentNotification,
} from './payment-notify.service';
import { WELCOME_LETTER_TOPIC } from '../letters/trigger';

/**
 * payment@ (2026-11-22): every new subscription and every completed payment mails the payment
 * mailbox once per Stripe event, with the customer's letter attached (same PDF as the admin download).
 */
const PAYMENT_BOX = 'zahlungen@example.test';
let h: Harness;
let notify: PaymentNotifyService;
let letters: WelcomeLettersService;

beforeAll(async () => {
  h = await createHarness({ PAYMENT_NOTIFY_EMAIL: PAYMENT_BOX });
  letters = h.app.get(WelcomeLettersService);
  notify = new PaymentNotifyService(
    h.db,
    h.env,
    h.app.get<Logger>(LOGGER),
    h.app.get(MailService),
    letters,
  );
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

type Mail = Awaited<ReturnType<typeof mailbox>>[number] & {
  replyTo?: string;
  attachments?: { filename: string; contentType: string; base64: string }[];
};
const mails = async (tag: string) => (await mailbox(h)).filter((m) => m.tag === tag) as Mail[];

/** Runs the queued outbox events of these topics like the worker does. */
async function drain(topics: string[]) {
  const events = await h.db
    .selectFrom('outbox_events')
    .select(['id', 'topic', 'payload'])
    .where('topic', 'in', topics)
    .where('processed_at', 'is', null)
    .orderBy('id')
    .execute();
  for (const e of events) {
    const p = e.payload as { id?: string; userId?: string };
    if (e.topic === PAYMENT_NOTIFY_TOPIC) await notify.send(String(p.id));
    if (e.topic === PAYMENT_ATTACHMENT_TOPIC) await notify.sendAttachment(String(p.id));
    if (e.topic === WELCOME_LETTER_TOPIC) {
      if ((await letters.check(String(p.userId))) === 'created')
        await notify.letterCreated(String(p.userId));
    }
    await h.db
      .updateTable('outbox_events')
      .set({ processed_at: new Date() })
      .where('id', '=', e.id)
      .execute();
  }
  return events.length;
}

async function addVehicle(s: Session) {
  const res = await h.app.inject({
    method: 'POST',
    url: '/v1/vehicles',
    headers: s.headers,
    payload: { nickname: 'Der Blaue', plate: 'K-AB 1234' },
  });
  expect(res.statusCode).toBe(201);
}

const ids = async (email: string) => {
  const u = await h.db
    .selectFrom('users')
    .select(['id', 'customer_no'])
    .where('email', '=', email)
    .executeTakeFirstOrThrow();
  const s = await h.db
    .selectFrom('subscriptions')
    .select('contract_no')
    .where('user_id', '=', u.id)
    .executeTakeFirstOrThrow();
  return { userId: u.id, customerNo: u.customer_no!, contractNo: s.contract_no! };
};

describe('payment@ notification', () => {
  it('new subscription: once per Stripe event, only to PAYMENT_NOTIFY_EMAIL, letter attached when it exists', async () => {
    const s = await subscribe(h, 'kunde@example.de');
    await addVehicle(s); // the welcome letter can be created before the mail goes out
    await drain([WELCOME_LETTER_TOPIC]);
    const { userId, customerNo, contractNo } = await ids('kunde@example.de');
    const rows = await h.db.selectFrom('payment_notifications').selectAll().execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'subscription', user_id: userId, amount_cents: 2000 });

    // A retried webhook (same Stripe event) queues nothing more.
    expect(
      await queuePaymentNotification(h.db, {
        eventId: rows[0]!.stripe_event_id,
        kind: 'subscription',
        userId,
        amountCents: 2000,
        paymentRef: 'pi_x',
        paidAt: new Date(),
      }),
    ).toBe(false);

    await drain([PAYMENT_NOTIFY_TOPIC]);
    await notify.send(rows[0]!.id); // a replayed outbox event sends nothing twice
    const sent = await mails('payment_notification');
    expect(sent).toHaveLength(1);
    const m = sent[0]!;
    expect(m.to).toBe(PAYMENT_BOX);
    for (const s of [
      `Kundennummer: ${customerNo}`,
      `Vertragsnummer: ${contractNo}`,
      'Produkt: ParkShield-Jahresabo (neu)',
      'Betrag: 20,00',
      'Stripe-Zahlungs-ID: pi_fake_',
      `/kunden/${userId}`,
    ]) {
      expect(m.text).toContain(s);
    }
    // The attachment is byte for byte the admin download of the same letter.
    const file = letterFileName(customerNo, contractNo);
    expect(file).toBe(`${customerNo}_${contractNo}_Brief.pdf`.replace(/[^\w.-]/g, '_'));
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments![0]).toMatchObject({ filename: file, contentType: 'application/pdf' });
    const admin = (await letters.pdf((await letters.latestId(userId))!, { download: false })).file;
    expect(Buffer.from(m.attachments![0]!.base64, 'base64').equals(admin)).toBe(true);
    // Never to anyone else: every payment mail went to the configured box only.
    const all = (await mailbox(h)).filter((x) => x.tag.startsWith('payment_'));
    expect(new Set(all.map((x) => x.to))).toEqual(new Set([PAYMENT_BOX]));
    expect(notify.recipient()).toBe(PAYMENT_BOX);
  });

  it('no letter yet: the mail goes out with „Anhang fehlgeschlagen“, the letter follows by itself', async () => {
    const s = await subscribe(h, 'neu@example.de');
    await drain([WELCOME_LETTER_TOPIC]); // paid, no vehicle: no letter
    await drain([PAYMENT_NOTIFY_TOPIC]);
    const first = (await mails('payment_notification'))[0]!;
    expect(first.text).toContain('Anhang fehlgeschlagen');
    expect(first.attachments ?? []).toHaveLength(0);
    const row = await h.db
      .selectFrom('payment_notifications')
      .selectAll()
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({ attachment_failed: true, attachment_sent_at: null });

    // The retry finds no letter: it throws, so the outbox tries again later.
    await expect(notify.sendAttachment(row.id)).rejects.toThrow(/not available/);
    // The first vehicle creates the letter, which queues the attachment again; it goes out once.
    await addVehicle(s);
    await drain([WELCOME_LETTER_TOPIC]);
    await drain([PAYMENT_ATTACHMENT_TOPIC]);
    await notify.sendAttachment(row.id);
    const follow = await mails('payment_attachment');
    expect(follow).toHaveLength(1);
    expect(follow[0]!.to).toBe(PAYMENT_BOX);
    expect(follow[0]!.attachments).toHaveLength(1);
  });

  it('rendering fails: still mailed with the admin link and the note; renewals need no letter', async () => {
    const s = await subscribe(h, 'kaputt@example.de');
    await addVehicle(s);
    await drain([WELCOME_LETTER_TOPIC]);
    const spy = vi.spyOn(letters, 'pdf').mockRejectedValueOnce(new Error('pdf broke'));
    await drain([PAYMENT_NOTIFY_TOPIC]);
    spy.mockRestore();
    const m = (await mails('payment_notification'))[0]!;
    expect(m.text).toContain('Anhang fehlgeschlagen. Der Brief wird automatisch nachgeschickt');
    expect(m.text).toMatch(/\/kunden\//);
    expect(
      await h.db
        .selectFrom('outbox_events')
        .select('id')
        .where('topic', '=', PAYMENT_ATTACHMENT_TOPIC)
        .execute(),
    ).toHaveLength(1);

    const { userId } = await ids('kaputt@example.de');
    await queuePaymentNotification(h.db, {
      eventId: 'evt_renewal_1',
      kind: 'renewal',
      userId,
      amountCents: 2000,
      paymentRef: 'pi_renew',
      paidAt: new Date(),
    });
    await drain([PAYMENT_NOTIFY_TOPIC]);
    const renewal = (await mails('payment_notification')).find((x) =>
      x.text.includes('Verlängerung'),
    )!;
    expect(renewal.text).toContain('Kein Brief zu dieser Zahlung.');
    expect(renewal.attachments ?? []).toHaveLength(0);
  });
});
