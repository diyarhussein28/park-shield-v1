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
- [ ] **Back office:** https://ops.test.park-shield.de (same basic auth), your own staff passkey
      registered for that address ([status.md §2](status.md#2-test-server)).

What behaves differently on the test server (expected, not bugs):

| Topic                    | On the test server                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Captcha                  | simulated („Sicherheitsprüfung: lokal simuliert“)                                  |
| Owner's mobile number    | real: Twilio Lookup (mobile only) + Verify, the code arrives as a real SMS         |
| Scanner phone check code | real Twilio Verify too (Protected Mode)                                            |
| Alerts to the owner      | **app push only** (no alert e-mail); needs the app signed in on your phone         |
| Alert photos             | on (production: after the legal review)                                            |
| Wait between alerts      | 1 minute per vehicle (production: 15 minutes)                                      |
| SMS                      | real, one per alert after 30 min without reaction, cap 20 / month. Costs money.    |
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

## 2. Sign-up and sign-in

- [ ] `/anmelden`: enter your e-mail → „Link senden“ → e-mail arrives within a minute.
- [ ] The link signs you in. `/konto` first asks for name, address and the **required** mobile
      number: a landline is rejected („Festnetz- und Internetnummern können keine SMS empfangen“),
      a mobile number gets a code by SMS; checkout stays locked until it is verified.
- [ ] Sign out and open the same link again → it must no longer work (one-time link).
- [ ] Sign out, sign in again. Ask for two links in a row: only the newest one works.
- [ ] Later (after §3), in `/konto/abo`: „Passkey hinzufügen“, sign out and sign in with the
      passkey instead of the e-mail link.

## 3. Buying the subscription

- [ ] `/konto` shows the checkout. Without ticking the withdrawal consent („Ich verlange
      ausdrücklich …“) ordering is not possible.
- [ ] The home page and `/konto` show **one** plan „ParkShield“, 19,99 € / Jahr incl. MwSt., one
      vehicle; no Plus or Premium anywhere.
- [ ] Tick it → „Zahlungspflichtig bestellen – 19,99 € / Jahr“ → Stripe checkout (test mode). First try the
      declined card: you get an error and no subscription.
- [ ] Pay with `4242 4242 4242 4242` → back on `/konto`, the subscription is active (yearly,
      365 days); `/konto/abo` shows the contract card and „Vertrag widerrufen“ in the first 14 days.
- [ ] Order confirmation and invoice e-mails arrive; `/konto/abo` lists the invoice (PDF shows 19 %
      VAT included).
- [ ] Optional: create a promo code in the back office (§12, „Gutscheine“) and use it as
      „Gutscheincode“ on a second test account.

## 4. Vehicle and decal

- [ ] `/konto` or `/konto/fahrzeuge`: „Fahrzeug hinzufügen“ (nickname, plate, colour). After the
      first vehicle the add form is gone (one vehicle per plan).
- [ ] The vehicle shows its QR code. Self-print is free: PDF 80 × 80 mm with cut marks, PNG and SVG
      download.
- [ ] Open „Aufkleber und Details“ → „Aufkleber testen“ → a test alert reaches the app by push
      („Das ist Ihre Testwarnung …“); no SMS for tests, a reminder push after 10 minutes.
- [ ] **Sperren:** the dialog lists the four facts; after confirming there is no active code, a
      warning shows, and the old code scans as inactive. „Neuen Code erstellen“ (free) brings a new
      code with the same design.
- [ ] **Print:** the first shipped decal is „kostenlos (Willkommensdruck)“; a second one costs
      3 € (Stripe one-time payment, test card). The order appears in the back office (§12).

## 5. Delivery channels and settings

- [ ] `/konto/benachrichtigungen`: push status of the app, the verified mobile number (it can be
      changed, not removed) and quiet hours. Install the app on your phone and sign in (alerts come
      only there).
- [ ] Add a quiet time („Ruhezeit“) covering now → a normal alert stays silent and appears in the
      history as „Stumm wegen Ruhezeit“; an urgent one (towing) still pushes, but **no SMS** in
      quiet hours. Remove it.
- [ ] Vehicle modes (if shown for your vehicle): try one and check its effect on the next alert.

## 6. (removed: trusted contacts were dropped on 2026-11-21)

## 7. The scanner (core flow)

Use the **phone** as the stranger, **not signed in**.

- [ ] Open the vehicle's QR code with the phone camera (or the „Scan-Seite auf diesem Gerät
      öffnen“ link) → `/s/<code>` loads quickly, shows no name, number or plate of the owner.
- [ ] The page shows „Nur echt auf park-shield.de“.
- [ ] Pick a problem (e.g. lights on) and send → the owner gets an app push (generic text, no
      details); no e-mail.
- [ ] Owner replies („Ich komme“, „In ca. 30 Min“, „Bin nicht in der Nähe“) in the app → the
      scanner page updates **live** without reloading.
- [ ] Send another alert at once → blocked (1 minute wait on the test server). After a minute it
      works again.
- [ ] Urgent problem (towing) → app push, also in quiet hours.
- [ ] Free text: a normal sentence goes through; insults or a phone number are blocked or held for
      review (see §12 „Missbrauch“ → review queue).
- [ ] Do **not** react to one alert → after 10 minutes a reminder push, after 30 minutes **one**
      SMS with a view link (`/v/…`). „Ich komme“, any reply, opening the chat or „Erledigt“ stop it;
      merely opening the alert („gesehen“) does not.
- [ ] **Absender blockieren** (app alert screen or `/konto/verlauf`) → the chat ends at once, the
      scanner page shows „Der Chat wurde beendet.“, no reminder or SMS follows.
- [ ] Owner: „Missbrauch melden“ on an alert → the report shows up in the back office.
- [ ] **Schutzmodus (Protected Mode):** switch it on in the account → scanner contents from unknown
      senders are hidden; the scanner may be asked to confirm a mobile number („Handynummer
      bestätigen“, real SMS code). Switch it off again.
- [ ] **Photo:** on the scanner page add a photo („Foto hinzufügen“, camera or gallery) and send →
      the owner's notification has a link to view it (`/v/…`); the photos also show in the app's
      alert screen. „Missbrauch melden“ there (or on the view page) deletes them at once; otherwise
      they are deleted 30 days after the alert.
- [ ] Phone with a slow network (DevTools „Slow 4G“): the scanner page is still usable.

## 8. History

- [ ] `/konto/verlauf` lists every alert with type, time, channel and reply, including the muted
      ones and the test alert; blocked senders are marked.

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

## 12. Back office (https://ops.test.park-shield.de)

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
- [ ] **Bestellungen:** a decal order (the welcome print or the 3 € print from §4) → mark in
      production → shipped with a tracking number; the customer gets the e-mail.
- [ ] **Gutscheine:** create a code, use it once (§3), deactivate it.
- [ ] **Partner**, **Zammad** (shows e-mail mode for now): open and read.
- [ ] **Einstellungen:** read-only unless agreed. „Anbieter“ shows the provider health.
- [ ] **Audit:** find your own actions from this run.
- [ ] **Mitarbeitende:** list of staff and roles; „Prüfung“ (quarterly access review) opens.

## 12a. NFC stickers from our own stock (since 2026-11-27)

Background: `docs/nfc-sticker-plan.md`. The printed sticker is a generic QR + NFC sticker (NTAG215) from
our own stock; the vehicle's old code keeps working until the new sticker is tested, at the latest 14 days
after shipping. Parts B and C need NTAG215 stickers; part C also needs the app build with the NFC screens
(EAS build after `dc0dfd2`) and „Einstellungen“ → `fulfillment.mode` = `from_stock` (agree with the owner
first and set it back to `on_demand` afterwards if no programmed stock is left).

**A. Back office only (works now): „Aufkleber-Lager“ (`/lager`)**

- [ ] „Neue Charge“ with 2–3 stickers → the batch shows its serial range (`PS-000001 – …`), „NTAG215“ and
      „0 zugeordnet“.
- [ ] „Druckdatei (PDF)“: generic design, serial number under the QR code, line „Scannen oder Handy
      anhalten – ohne App“, no vehicle name.
- [ ] As admin: „Produktionsliste (CSV)“ (opens as columns in Excel: serial, URL, NDEF data) and
      „QR-Bilder (ZIP)“ (one SVG and one PNG per serial). As fulfillment: both links are missing.
- [ ] Scan a sticker of the batch with a phone camera → the page says the sticker is not active and
      offers no set-up. In the app, „Aufkleber aktivieren“ with that code is refused.
- [ ] „Aufkleber finden“: by serial (`PS-000001`, `ps1`, `1`) and by the QR content → the sticker page
      opens.
- [ ] „Bestand“ card: counts per state. Set „Warnung, wenn weniger Aufkleber bereit …“ above the ready
      count → warning on `/lager` and a to-do on the start page; set it back.
- [ ] „Charge verloren?“ (admin): the button stays off until the confirmation is ticked; afterwards the
      batch's stickers in stock scan as not active.

**B. Programming the chip (needs NTAG215 stickers)**

- [ ] Android, Chrome, sticker page: „Adresse und QR-Code anzeigen“ → „Chip beschreiben“ (allow NFC,
      hold the sticker) → „Chip prüfen“ (take it away, hold again) → steps „Erledigt“.
- [ ] „Chip endgültig sperren“ only after ticking the confirmation → „Bereit zum Verpacken“. Only lock
      chips that carry the test server's URL.
- [ ] iPhone (no Web NFC): the page explains NFC Tools; write the URL with NFC Tools, „Mit NFC Tools
      beschrieben“, read it with NFC Tools, paste the URL → „Chip prüfen“ passes.
- [ ] Wrong chip: write another URL onto the chip → „Chip prüfen“ refuses („andere Adresse“). The same
      chip on a second sticker → „bereits einem anderen Aufkleber zugeordnet“.
- [ ] A locked chip cannot be rewritten (NFC Tools write fails).
- [ ] „Aufkleber aussondern“ with a reason → status „Ausgesondert“, the code never works.

**C. Ordering, packing, change-over (needs B, the new app build and `from_stock`)**

- [ ] App, vehicle → print → „Drucken und zusenden lassen“: the confirmation shows the neutral sticker and
      the new-code note, no vehicle name, no design, no preview.
- [ ] Back office, the order → scan a sticker that is not locked → refused; a partner decal → refused; a
      locked sticker → „verpackt“.
- [ ] App: the vehicle shows the new code with your own design, „Ihr Aufkleber“ with the serial and the
      notice „Neuer Aufkleber unterwegs“. Your old PDF/decal still opens the scanner page.
- [ ] Back office: „versendet“ with a tracking number → the e-mail says to stick it inside the window,
      test it, and that the old code works at most 14 days; the app shows that date.
- [ ] The new sticker: QR scan and NFC tap open the same page (iPhone with the screen unlocked,
      Android with NFC on). Also through a windscreen and a side window.
- [ ] „Aufkleber testen“ with the new sticker → the old code stops at once (old PDF: not active), the
      notice disappears.
- [ ] Without the test: set `fulfillment.old_code_grace_days` to 1 → about a day after shipping the old
      code stops by itself (worker every 10 minutes). Set it back to 14.
- [ ] Parcel back („Retoure“) after shipping → the old code keeps working without a deadline.
- [ ] „Sperren“ during the change-over → both codes stop; a new code is free at once (no 10-day wait).

## 13. Reporting a problem

For each problem note: page (URL **without** codes or `#t=` links), what you did, what you
expected, what happened, time, device/browser, and a screenshot without personal data or secret
links. Collect them in one list and send it to the owner. The repository is public, so personal
data never goes into GitHub issues.

When you are done, delete your test accounts' data you do not need any more (§11) and tell the
owner which global settings you changed, if any.
