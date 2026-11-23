import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { appSignIn, createHarness, mailbox, resetState, type Harness } from '../test/harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());
beforeEach(() => resetState(h));

const tickets = async () =>
  (await h.app.inject({ method: 'GET', url: '/v1/dev/zammad/tickets' })).json().tickets as {
    email: string;
    subject: string;
    body: string;
    tags: string[];
    fields: { subject: string | null; topic: string };
  }[];

describe('in-app contact form (POST /v1/app/support/contact)', () => {
  const send = (payload: Record<string, unknown>, headers: Record<string, string> = {}) =>
    h.app.inject({
      method: 'POST',
      url: '/v1/app/support/contact',
      headers,
      remoteAddress: '203.0.113.21',
      payload: { locale: 'de', client: 'app 1.0.0 ios', ...payload },
    });

  it('needs the app session', async () => {
    const res = await send({
      subject: 'Frage',
      email: 'x@example.de',
      message: 'Eine Frage zur App, bitte.',
    });
    expect(res.statusCode).toBe(401);
  });

  it('sends the subject and message with the chosen reply address, confirms to that address', async () => {
    const app = await appSignIn(h, 'konto@example.de');
    const res = await send(
      {
        subject: '  Aufkleber   löst sich ',
        email: 'Antwort@Example.de',
        message: 'Mein Aufkleber löst sich an der Ecke.',
      },
      app,
    );
    expect(res.statusCode).toBe(201);
    const t = (await tickets())[0]!;
    expect(t.email).toBe('antwort@example.de');
    expect(t.subject).toBe('[Sonstiges] Aufkleber löst sich');
    expect(t.fields.subject).toBe('Aufkleber löst sich');
    expect(t.tags).toContain('signed_in');
    expect(t.body).toContain('Version: app 1.0.0 ios');
    const confirmation = (await mailbox(h)).find((m) => m.tag === 'support_received');
    expect(confirmation?.to).toBe('antwort@example.de');
    expect(confirmation?.text).toContain('Aufkleber löst sich');
  });

  it('rejects a short message or a bad reply address', async () => {
    const app = await appSignIn(h, 'konto2@example.de');
    expect(
      (await send({ subject: 'Frage', email: 'kein-mail', message: 'Lange genug Nachricht.' }, app))
        .statusCode,
    ).toBe(400);
    expect(
      (await send({ subject: 'Frage', email: 'a@example.de', message: 'kurz' }, app)).statusCode,
    ).toBe(400);
  });

  it('limits requests per account', async () => {
    const app = await appSignIn(h, 'viel@example.de');
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push(
        (
          await send(
            {
              subject: `Frage ${i}`,
              email: 'viel@example.de',
              message: 'Noch eine Frage zur App.',
            },
            app,
          )
        ).statusCode,
      );
    }
    expect(codes.slice(0, 5)).toEqual([201, 201, 201, 201, 201]);
    expect(codes[5]).toBe(429);
  });
});
