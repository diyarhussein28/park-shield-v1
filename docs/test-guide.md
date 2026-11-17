# ParkShield — full manual test on the test server

A step-by-step walk through every feature on **https://test.park-shield.de** and the back office.
Work through it in order: later steps need the account, vehicle and decal from earlier ones. Tick
each box, note anything odd (see [§13](#13-reporting-a-problem)). Whole run: about 2–3 hours.

> The UI is German. Button names are quoted exactly as they appear („…“). An AI agent can walk you
> through this file in your language.

---

## 0. Before you start

- [ ] **Basic auth** for the test site: user name and password come from the owner privately (never
      in chat or in the repo). The scanner page `/s/…` and webhooks work without it.
- [ ] **Two devices:** a laptop (owner side) and a phone (the stranger who scans). A second browser
      or a private window also works for the scanner.
- [ ] **Your own real e-mail address and mobile number.** Mails (Mailjet) and SMS (Twilio) on the
      test server are **real**. Do not use other people's addresses or numbers.
- [ ] **Stripe is in test mode:** no real money. Card `4242 4242 4242 4242`, any future date, any
      CVC, any name. Declined card: `4000 0000 0000 0002`. 3-D Secure: `4000 0027 6000 3184`.
- [ ] **Back office:** SSH tunnel open and your own staff passkey registered
      ([status.md §2](status.md#2-test-server)).

What behaves differently on the test server (expected, not bugs):

| Topic                    | On the test server                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Captcha                  | simulated („Sicherheitsprüfung: lokal simuliert“)                                  |
| WhatsApp                 | switched off everywhere (`WHATSAPP_PROVIDER=off`)                                  |
| Scanner phone check code | fake: the code appears in `/dev/postfach`, not as an SMS                           |
| Alert photos             | off (`ALERT_PHOTOS_ENABLED`), not testable yet                                     |
| Wait between alerts      | 1 minute per vehicle (production: 15 minutes)                                      |
| SMS                      | real and limited: Plus 5 per month. Each costs money; do not send dozens.          |
| Printed decals           | no print partner: orders land as files on the server, staff mark them as shipped   |

---

## 1. Public website (no account)

- [ ] `/` loads fast; the animated demo plays and can be paused; scrolling reaches the prices.
- [ ] Switch the language DE ↔ EN; texts change, nothing stays in the other language.
- [ ] Phone: no horizontal scrolling, menu opens and closes, all buttons can be tapped.
- [ ] `/hilfe`: search and open two articles. `/hilfe/kontakt`: send a message → it arrives at
      `contact@park-shield.de` (ask the owner) with your address as reply-to.
- [ ] Legal pages open and show the company data: `/impressum`, `/datenschutz`, `/agb`,
      `/widerruf`, `/barrierefreiheit`, `/sicherheit`.
- [ ] `/business`: join the waitlist → confirmation e-mail → link confirms (`/business/bestaetigen`).

## 2. Sign-up and sign-in

- [ ] `/anmelden`: enter your e-mail → „Link senden“ → e-mail arrives within a minute.
- [ ] The link signs you in. Open it a second time → it must no longer work (one-time link).
- [ ] Sign out, sign in again. Ask for two links in a row: only the newest one works.
- [ ] Later (after §3), in `/konto/abo`: „Passkey hinzufügen“, sign out and sign in with the
      passkey instead of the e-mail link.

## 3. Buying the subscription

- [ ] `/konto` shows the checkout. Without ticking the withdrawal consent („Ich verlange
      ausdrücklich …“) ordering is not possible.
- [ ] Tick it → „Zahlungspflichtig bestellen“ → Stripe checkout (test mode). First try the
      declined card: you get an error and no subscription.
- [ ] Pay with `4242 4242 4242 4242` → back on `/konto`, the subscription is active.
- [ ] Order confirmation and invoice e-mails arrive; `/konto/abo` lists the invoice (PDF shows 19 %
      VAT included).
- [ ] Optional: create a promo code in the back office (§12, „Gutscheine“) and use it as
      „Gutscheincode“ on a second test account.

## 4. Vehicle and decal

- [ ] `/konto` or `/konto/fahrzeuge`: „Fahrzeug hinzufügen“ (nickname, plate, colour).
- [ ] The vehicle shows its QR code. Download the PDF and check it prints cleanly (A4, sharp code).
- [ ] Open „Aufkleber und Details“ → „Aufkleber testen“ → a test alert reaches **all** your
      channels („Das ist Ihre Testwarnung …“). Reply from the mail; the reply shows up.
- [ ] Edit and delete a second vehicle; its QR code must stop working (scan shows an error page).

## 5. Delivery channels and settings

- [ ] `/konto/zustellung`: e-mail is there. Add your mobile number for SMS („Handynummer
      bestätigen“, code by SMS). Allow push in the browser and on the phone.
- [ ] `/konto/benachrichtigungen`: change the channel order (e.g. SMS first). Normal alerts go to
      the first channel that works; urgent alerts and tests go to all.
- [ ] Add a quiet time („Ruhezeit“) covering now → a normal alert stays silent and appears in the
      history as „Stumm wegen Ruhezeit“; an urgent one (towing) still comes through. Remove it.
- [ ] Vehicle modes (if shown for your vehicle): try one and check its effect on the next alert.

## 6. Emergency contact

- [ ] `/konto/notfallkontakte`: add a contact with **a second e-mail address of your own**.
- [ ] That address gets a consent e-mail → open it → accept on `/notfallkontakt`. Until then the
      contact shows as not confirmed and receives nothing.
- [ ] Later (§7): when you do not react to an alert, it escalates to this contact after the
      configured delay (setting in the back office).

## 7. The scanner (core flow)

Use the **phone** as the stranger, **not signed in**.

- [ ] Open the vehicle's QR code with the phone camera (or the „Scan-Seite auf diesem Gerät
      öffnen“ link) → `/s/<code>` loads quickly, shows no name, number or plate of the owner.
- [ ] Pick a problem (e.g. lights on) and send → the owner gets it on the first channel.
- [ ] Owner replies („Ich komme“, „In ca. 30 Min“, „Bin nicht in der Nähe“) from the mail, SMS
      link or push → the scanner page updates **live** without reloading.
- [ ] Send another alert at once → blocked (1 minute wait on the test server). After a minute it
      works again.
- [ ] Urgent problem (towing) → all channels at once.
- [ ] Free text: a normal sentence goes through; insults or a phone number are blocked or held for
      review (see §12 „Missbrauch“ → review queue).
- [ ] Do **not** react to one alert → after the delay the emergency contact (§6) is notified, and
      the owner gets a follow-up.
- [ ] Owner: „Missbrauch melden“ on an alert → the report shows up in the back office.
- [ ] **Schutzmodus (Protected Mode):** switch it on in the account → scanner contents from unknown
      senders are hidden; the scanner may be asked to confirm a mobile number („Handynummer
      bestätigen“, code in `/dev/postfach`). Switch it off again.
- [ ] Phone with a slow network (DevTools „Slow 4G“): the scanner page is still usable.

## 8. History

- [ ] `/konto/verlauf` lists every alert with type, time, channel and reply, including the muted
      ones and the test alert.

## 9. Pre-printed decal (activation)

- [ ] Only if the back office has an unclaimed decal code: `/aktivieren` with that code links it to
      a vehicle. Otherwise skip.

## 10. Data and privacy

- [ ] `/konto/daten`: „Daten herunterladen“ → the export contains your data and nothing about other
      customers.
- [ ] `/datenschutz-anfrage`: send a request → it appears in the back office GDPR queue (§12).

## 11. Cancelling, withdrawal, deletion — use a **second test account**

These end the subscription, so do them last or with a fresh account (new e-mail, new test payment).

- [ ] `/kuendigen` (works without signing in): „Ordentliche Kündigung“ → confirmation e-mail with
      the end date. `/kuendigen/zuruecknehmen` takes it back.
- [ ] Within 14 days: „Vertrag widerrufen“ (`/widerrufen`) → refund (Stripe test) and a credit note;
      the amount follows the withdrawal formula.
- [ ] „Konto löschen“ in `/konto/daten` → decals stop working at once; within 24 hours
      `/konto-loeschen-abbrechen` (link in the mail) cancels the deletion.

## 12. Back office (http://localhost:3001 through the tunnel)

Every action is logged under your name. Do not change global settings without telling the owner;
settings and kill switches apply to the whole test server.

- [ ] **Start page:** tasks waiting, key figures, all areas with explanations.
- [ ] **Kunden:** search your test customer → Customer 360 is masked (no full e-mail, plate,
      phone). Open an alert trace („Warnungen“): every delivery attempt per channel.
- [ ] **Break-glass (four eyes):** request to reveal one masked field of your test customer → the
      **owner** approves in „Break-glass“ → you see it once; the audit log shows both steps. You
      cannot approve your own request.
- [ ] **Erstattung:** refund part of a test payment → Stripe test refund, credit note e-mail.
- [ ] **Missbrauch:** the report from §7; review queue with the held free text (approve / block);
      word lists (add a test word, check it blocks, remove it); phone bans.
- [ ] **Datenschutz:** the request from §10, deadlines, work it through.
- [ ] **Bestellungen:** a decal order (from „Aufkleber bestellen“ in the account) → mark in
      production → shipped with a tracking number; the customer gets the e-mail.
- [ ] **Gutscheine:** create a code, use it once (§3), deactivate it.
- [ ] **Partner**, **Zammad** (shows e-mail mode for now): open and read.
- [ ] **Einstellungen:** read-only unless agreed. „Anbieter“ shows the provider health.
- [ ] **Audit:** find your own actions from this run.
- [ ] **Mitarbeitende:** list of staff and roles; „Prüfung“ (quarterly access review) opens.

## 13. Reporting a problem

For each problem note: page (URL **without** codes or `#t=` links), what you did, what you
expected, what happened, time, device/browser, and a screenshot without personal data or secret
links. Collect them in one list and send it to the owner. The repository is public, so personal
data never goes into GitHub issues.

When you are done, delete your test accounts' data you do not need any more (§11) and tell the
owner which global settings you changed, if any.
