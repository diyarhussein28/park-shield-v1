# Prompt: implement the app redesign end to end, then run a full QA pass

Copy everything below the line into a new Claude Code session opened in the repository root.

---

You are implementing the complete redesign of the ParkShield mobile app and the sign-up / biometric
login feature, end to end, in one run. **Do not ask the owner any questions.** Work autonomously from
start to finish: implement, test, commit, push to `main`, then run a full QA pass, fix what it finds,
push again, and finish with a written report. Talk to the owner in **Arabic** (Levantine), but write
code, commits and repository docs in English, except `docs/app-redesign.md`, which is in Arabic.

## 0. Ground rules

1. **Read first, in this order:** `AGENTS.md`, `docs/status.md`, `docs/app-redesign.md` (the source of
   truth for this job: findings P1–P18, §5 direction, §6 sign-up + biometric login, §7 owner
   decisions), `apps/mobile/AGENTS.md` (Expo rules: read the versioned Expo docs before touching any
   Expo API, install packages only with `npx expo install` from `apps/mobile`).
2. **Owner decisions in `docs/app-redesign.md` §7 are binding.** Where something is still open or
   unspecified, pick the option the file recommends (or the most conservative, privacy-friendly one),
   implement it, and record it in §7 as `Agent decision (YYYY-MM-DD): …` so the owner can revisit it.
3. **Project hard rules apply** (AGENTS.md §8):
   - Sensitive fields are encrypted (`*_enc`), with blind indexes (`*_bidx`) only if lookups are needed.
   - No personal data in logs.
   - Limits and timeouts come from `app_settings` (registry `apps/api/src/ops/settings-registry.ts`),
     never hard-coded.
   - All UI text goes through i18n: `packages/i18n` (`de.ts` first, then the same key in `en.ts`) for
     texts shared with the website; app-only texts in `apps/mobile/src/lib/i18n.ts` (de + en).
   - New migrations only, never edit old ones; run `npm run db:types` after every migration.
   - Every new public route goes into `apps/api/src/security/routes.test.ts`.
   - WCAG 2.2 AA: contrast-tested tokens, 24 px targets (44 pt on iOS is better), visible focus,
     Dynamic Type, reduced motion respected (animations stop or are skipped when it is on).
4. **Safety:**
   - Never use real provider keys for tests, never deploy, never touch the test server or its `server.env`.
   - Never commit secrets.
   - The repository is public: no real personal data anywhere.
5. **Git:**
   - `git pull --rebase` before you start and before every push.
   - Small, logical commits with Conventional Commit messages (`feat(app): …`, `feat(api): …`,
     `fix(app): …`, `test: …`, `docs: …`).
   - Push straight to `main` (no PRs) after each phase that leaves the build green.
   - Never push a red build: lint, typecheck and tests must pass first.

## 1. Set up the local stack

1. `git pull --rebase`, `npm install` (root), `npm ci --prefix apps/mobile`.
2. Start the dev stack with all provider keys emptied so every fake is used (command in
   `docs/status.md` §6 "Local E2E with real keys"), including `ALERT_PHOTOS_ENABLED=true`.
   - It also applies migrations.
   - If port 5432 is taken, follow AGENTS.md §10.
   - Check `http://127.0.0.1:4000/v1/ready` returns `ready: true`.
3. Start Metro from `apps/mobile` with `EXPO_PUBLIC_API_URL=http://localhost:3000` and open the app in
   the iOS Simulator (Expo Go) with the simulator tools.
   - Attach the simulator panel first.
   - Use a current iPhone, plus an iPhone SE for small-screen checks later.
4. **Known simulator traps:**
   - The host Mac may use an Arabic keyboard layout, so typed Latin text arrives as Arabic letters.
     Put text into the simulator clipboard with `xcrun simctl pbcopy booted` and paste it into fields
     (digits type fine).
   - Screenshots can lag one step behind: take a second screenshot before acting on one.
   - Sign-in codes are in the fake inbox `GET http://127.0.0.1:4000/v1/dev/mailbox`.
   - Fake payments use `/dev/checkout` ("Run test payment").
5. Take **"before" screenshots** of every main screen (sign-in, home, alert, vehicles, QR page,
   account, more, notifications, dark mode). Save them to `.local/redesign-qa/before/` (git-ignored,
   never committed).

## 2. Quick fixes from the findings (commit: `fix(app): …`)

| Finding | Fix |
|---------|-----|
| **P3** | Closing or cancelling the payment page without paying must not say "Thank you for your payment" or mention direct debit. Show a neutral "Payment cancelled, nothing was charged" state and the order button again. Only show "checking your payment" when the checkout really returned success. |
| **P4** | Sign-in text and button must agree (code, not link). |
| **P16** | Every e-mail, code, phone, plate and postcode field is LTR and left-aligned regardless of keyboard language. |
| **P17** | Six code boxes (or one field styled as six), `oneTimeCode` autofill, auto-submit when six digits are entered; Arabic-Indic digits typed on an Arabic keyboard are converted, not dropped. |
| **P5** | No duplicated "Sign in" title. |

## 3. Backend: profile, sign-up and settings (commits: `feat(api): …`, `feat(db): …`)

### 3.1 Data

- Migration adding to `users` (or a new `user_profiles` table, your choice; follow the existing
  `*_enc` pattern and `crypto.ts`):
  - Encrypted: first name, last name, street + house number, postcode, city, country (default `DE`),
    optional phone (verified phone can reuse the existing SMS number storage if one exists).
  - `profile_completed_at` (timestamptz).
  - `profile_source` (`signup` | `completed_later`).
- Retention, data export (`/konto/daten` and app equivalent) and account deletion must include the
  new fields. Extend the existing privacy export and deletion code and their tests.

### 3.2 API (authenticated, owner session)

- `GET /v1/me/profile` and `PUT /v1/me/profile`.
  - Validation: required are first name, last name, street, postcode, city, country, and the e-mail
    the account already has. Phone is optional.
  - German postcode is 5 digits when the country is DE.
  - Trim, length limits, no HTML.
- **Profile completeness gate:** checkout creation (`/v1/billing/checkout` or the existing endpoint)
  returns a clear error code (for example `profile_incomplete`) until the profile is complete. The web
  portal and the app both handle it.
- **Phone:** if given, verify it with the existing SMS code flow (the one behind "Send code by SMS" in
  notifications). The account is complete without a phone.
- **Stripe prefill:** when creating the checkout session, pass name and billing address from the
  profile (create or update the Stripe customer) so the user does not type them twice. Keep
  `automatic_tax`.

### 3.3 Welcome letter (`apps/api/src/letters/welcome-letters.service.ts`, `trigger.ts`)

- The address on the letter is **always the sign-up address** when the profile exists. The decal
  shipping address is used only for decal orders.
- **Automatic letters only for new accounts:** the automatic `welcome_letter.check` creates a letter
  only when `profile_source = 'signup'`.
  - Old accounts that complete their profile later (`completed_later`) get no automatic letter.
  - Ops "Neu erstellen" still works for any account (sign-up address first, old sources as fallback
    for accounts without a profile).
- Update `letters.test.ts` for all cases.

### 3.4 Settings

Add to the settings registry, with sensible defaults, ops-editable:

- `app.lock_after_seconds` (default 300).

Deliver it to the app through an authenticated endpoint (an existing app bootstrap endpoint, or a new
`GET /v1/app/config`).

### 3.5 Tests

- API integration tests (`apps/api/src/test/harness.ts`) for:
  - profile read and write, validation
  - the checkout gate
  - Stripe prefill with the fake
  - the letter rules
  - export and deletion
- Run `npm run db:types`, `npm run db:check`, then `cd apps/api && npx vitest run` for the touched
  modules, then the full `npm test`.

## 4. Mobile app (commits: `feat(app): …`, one per area)

### 4.1 Design tokens and identity (keep blue + yellow, §7)

- Make the logo yellow a real second colour: add accent tokens (yellow fill, readable on-yellow
  foreground, subtle yellow surface) for light and dark.
  - Add them to `packages/ui/src/theme.css` **and** `apps/mobile/src/theme/tokens.ts` (the test keeps
    them 1:1 and checks WCAG contrast: extend it).
- A distinctive heading font (open licence, bundled with `expo-font`) for titles only; body stays the
  system font. Respect Dynamic Type.
- New illustrations as SVG (react-native-svg): a proper car (with wheels), the decal on a windscreen,
  a shield/check for "protected", and three onboarding scenes.
  - Consistent line weight, blue + yellow.
  - Replace the trapezoid car (P13).
- Success moments: short, tasteful celebration (check animation + headline) after payment and after
  the first QR code. Skipped when reduced motion is on; no sound.

### 4.2 Navigation: tabs Home · Alerts · Cars · Account (§5.1, §7)

- `src/app/(tabs)`:
  - new `index` = **Home**
  - new `alerts` tab = list + 90-day history (merge the current history screen)
  - `fahrzeuge` = Cars
  - `konto` = **Account**
- Delete `mehr`; move its items into Account as a grouped iOS-style list: notifications, emergency
  contacts, "Didn't get the alert?", your data, help, then **sign out as a plain red text row at the
  bottom** (P12).
- Keep `BrandTabBar` with the open-alert badge on the Alerts tab. Update deep links, the
  `unstable_settings` anchor and any `router.push` targets.

### 4.3 Home = protection status dashboard (P1, P9, P11, P18)

Order, top to bottom:

1. **Open alerts first:** large, urgent card per open alert, warm/urgent colour, relative time ("2 min
   ago"), car nickname, and the "I'm coming" button right on the card.
2. **Protection status:** the car illustration, nickname, and a badge "Protected ✓" or "1 step left".
3. **Set-up:** a compact, dismissible strip with **one** primary button for the next step only (not
   three equal outlined buttons). Progress counts real steps consistently.
4. Development-only notices (no Firebase) become a small footer note, not the top banner.

The three-step explainer appears once (onboarding), not on Home and Account at the same time.

### 4.4 Onboarding, sign-up, verification (§5.2, §6)

**First launch:** three onboarding screens (illustration + one sentence each, skippable, page dots),
then two buttons: **"Get started"** (new account) and **"I already have an account"** (existing
e-mail + code sign-in).

**Sign-up, before payment (§7):** short steps with a progress bar:

1. E-mail → 6-digit code (verify).
2. First + last name.
3. Address (street + no., postcode, city, country DE default).
4. Phone (optional, "Skip"; if given → SMS code).

Then:

- Save the profile (`profile_source = signup`).
- Offer biometric unlock (§4.5).
- Show the paywall (§4.6).
- Then add the first car.

**Existing accounts:** on the first open after the update, a blocking "Complete your account" screen
(name + address, phone optional) until done (`profile_source = completed_later`, no automatic letter).

**Push permission:** ask only after the first QR code exists, with a short explanation screen first
(P6). Remove the automatic modal on first Home load.

### 4.5 Biometric app lock (§6, §7)

Use `expo-local-authentication` (installed with `npx expo install`).

- Add `NSFaceIDUsageDescription` (German, i18n-reviewed wording) in `app.config.ts` `ios.infoPlist`.
- Keep the session exactly as today: `THIS_DEVICE_ONLY` in Keychain / Keystore, never backed up, so a
  new phone must sign in again.
- After sign-up / sign-in, offer **Face ID** (iPhone; Touch ID on older devices) or **whatever the
  Android device supports** (fingerprint, face, device credential). Show the right name and icon per
  device.
- **Lock** when the app returns to the foreground after `app.lock_after_seconds` (default 300 s) or
  more in the background. Returning sooner does not lock. Cold start with a stored session also
  locks.
- **Fallback:** device passcode / PIN / pattern is allowed (no e-mail sign-in needed).
- **Exception:** tapping an alert notification opens **only that alert screen (and its chat)**
  without unlocking. Any navigation elsewhere asks for unlock. The lock screen itself is branded,
  accessible, and has an "Unlock" button.
- A setting under Account to turn the lock on or off.
- Unit tests (Jest) for the timer logic and the alert exception.

### 4.6 Paywall / subscription (§5.4, P7, P8)

- Plus vs Premium comparison with illustrated benefits (Premium shown as "from 9 Nov 2027" if not yet
  bookable, as today).
- One clear call to action.
- Legal text collapsed under "Details", but the withdrawal-consent checkbox and the button wording
  that German law requires stay (do not change their legal meaning; shorten only the visible
  presentation).
- Correct states for cancel, pending and success (P3).
- After success: celebration, then straight to "Add your car".

### 4.7 Car page (§5.6, P10)

- QR code with **Print PDF / Share / Save** at the top.
- "How to put it on" as a short collapsible.
- Decal design moved to its own pushed screen with **visual template thumbnails** (real mini
  renders), headline choices as chips, and one live preview (not two).

### 4.8 Settings controls (P14, P15)

- Native-looking switches instead of checkboxes for on/off settings.
- The notifications screen explains clearly that SMS is a Premium feature and does not ask Plus users
  for a number as if SMS were included.

### 4.9 Texts and i18n

- Every new or changed string goes into de + en.
- German is the source language; keep the existing tone (clear, honest, privacy-respecting).
- Run the parity tests.

### 4.10 Website parity (minimum)

Because the API now gates checkout on a complete profile, add the same "complete your account" form
(name + address, phone optional) to the web portal `/konto` before checkout, using the same API and
the shared i18n keys. Keep the website's look; no web redesign.

### 4.11 Mobile tests

- `npm --prefix apps/mobile test` and `npm --prefix apps/mobile run typecheck` green.
- Add tests for the onboarding gate, the profile gate, the lock, the tab structure, and the token
  parity / contrast test.

## 5. Full verification before pushing

Run and fix until all pass:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run db:check`
- mobile test + typecheck
- `npm run e2e` against the running stack: update the E2E tests the web change affects, and add
  `expectAccessible(page)` on new web pages.

Then `git pull --rebase` and push to `main`.

## 6. Documentation (commit: `docs: …`)

- `docs/app-redesign.md`:
  - set **Status: implemented** with the date
  - mark each finding P1–P18 as fixed (with the commit) or explain why not
  - record every agent decision in §7
  - add a log entry in §9
- `AGENTS.md`: update the app section (tabs, onboarding, sign-up, profile gate, biometric lock,
  `app.lock_after_seconds`, welcome-letter address rule) and the "Last updated" line.
- `docs/status.md`: add a decision entry and anything that must happen before go-live (for example
  privacy policy text for the new data).
- `LEGAL_REVIEW.md`: a new section listing the new personal data (name, address, optional phone),
  purpose (contract, invoices, welcome letter), legal basis to confirm, the privacy-policy text that
  needs the lawyer, and the App Store / Play privacy-label changes. **Do not invent final legal text;**
  draft it and mark it `TODO [LEGAL REVIEW]`.

Push.

## 7. Full QA pass (after everything is pushed)

Act as a demanding product designer and QA engineer. Test the real app in the iOS Simulator (and an
Android emulator if one is available; if not, say so in the report). Use test data only.

### 7.1 Functional test matrix

Test every row, note pass or fail, and keep a screenshot for each:

1. **First launch:** onboarding (swipe, skip, dots), "Get started", "I already have an account".
2. **Sign-up:**
   - invalid e-mail
   - wrong code, expired code, resend timer
   - Arabic-keyboard digits
   - code autofill / auto-submit
   - name and address validation (missing fields, wrong postcode)
   - phone skipped
   - phone given → SMS code from the fake inbox
3. **Paywall:**
   - cancel on the payment page (correct message, nothing charged)
   - fake payment success
   - celebration
   - Stripe prefill (check the fake checkout session data)
4. **Car:**
   - add car (validation)
   - QR page actions (PDF, share, save)
   - design screen with thumbnails and preview
   - push-permission explanation after the first QR
5. **Alerts:**
   - send alerts from the scanner page `http://localhost:3000/s/<code>` (the browser pane is fine)
   - Home shows the open alert first
   - "I'm coming" from the Home card and from the alert screen
   - "In about 30 min", "I'm not nearby"
   - chat open and send
   - Alerts tab list and history
   - badge count
6. **Biometric lock:**
   - Enrol Face ID in the simulator:
     `xcrun simctl spawn booted notifyutil -s com.apple.BiometricKit.enrollmentChanged '1' && xcrun simctl spawn booted notifyutil -p com.apple.BiometricKit.enrollmentChanged`
   - Matching face: `notifyutil -p com.apple.BiometricKit_Sim.pearl.match`
   - Non-matching face: `…pearl.nomatch`
   - Then test:
     - enable the lock
     - background for less than the timeout (no lock)
     - more than the timeout (lock: set `app.lock_after_seconds` low with `setSetting` or ops for the test and restore it after)
     - failed face, then passcode fallback
     - alert-notification exception (only that alert opens; other tabs ask for unlock)
     - turn the lock off
     - sign out and in again
7. **Existing account:** an account created the old way (e-mail only) gets the blocking "Complete
   your account" screen, and **no** automatic welcome letter after completing it. A new sign-up
   account gets a letter with the **sign-up address** after payment + first car. Check in ops
   (`/willkommensbriefe`) or via the API tests.
8. **Account tab:**
   - every former "More" item reachable
   - switches
   - language
   - data export
   - delete-account flow (start, then cancel)
   - sign out
9. **Website:** `/konto` asks for name + address before checkout; existing E2E still green.

### 7.2 Design and UX review

For each main screen (onboarding, sign-up steps, paywall, Home, alert, Alerts tab, Cars, QR page,
design screen, Account, lock screen), in light **and** dark mode, check the following:

- First impression in 2 seconds; is the most important thing seen first?
- Visual hierarchy, spacing rhythm, alignment, consistency of cards, buttons, icons and type.
- Use of blue + yellow; does it feel premium and calm, not bureaucratic or alarming (except real
  alerts, which must feel urgent)?
- Emotional tone of the copy; any leftover legal walls or negative framing.
- Accessibility:
  - contrast
  - touch targets ≥ 44 pt
  - VoiceOver labels and order (use the accessibility inspector or read the tree)
  - largest Dynamic Type size without clipping
  - reduced motion
- Small screen (iPhone SE) without clipping or horizontal scroll.
- Performance feel: loading states, empty states, error states (stop the API briefly to see offline
  states, then restart it).

Score every screen 1–10 on: clarity, visual quality, consistency, emotion / trust, accessibility.
Compare with the "before" screenshots.

### 7.3 Fix and re-test

- Fix every functional failure and every design issue scored below 8.
- Re-run the affected tests and the full verification from §5.
- Commit (`fix(app): …`, `style(app): …`), `git pull --rebase`, push.

### 7.4 QA report

- Write `docs/app-redesign-qa.md` (English) with:
  - the test matrix (pass/fail)
  - the score table before vs after
  - remaining known issues with priority
  - what could not be tested and why (for example real push, real Face ID hardware, Android
    biometrics without an emulator)
- Keep screenshots in `.local/redesign-qa/` (not committed).
- Commit and push.

## 8. Finish

1. Final `git status` clean, `git log --oneline` of this run, CI green on GitHub (check with `gh`; fix
   and push if red).
2. Restore any setting you changed for testing (for example `app.lock_after_seconds`).
3. Reply to the owner **in Arabic**, short and clear:
   - what was built
   - the QA results and scores (before → after)
   - what is left: lawyer review, real devices, store privacy labels, deploy not done
   - your own decisions recorded in `docs/app-redesign.md` §7
