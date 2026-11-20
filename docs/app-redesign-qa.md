# App redesign — QA report (2026-11-21)

Scope: the redesign and the sign-up / biometric-lock feature from `docs/app-redesign.md`, implemented
in `64e4240` (API), `7933888` (tokens), `09c9d09` (i18n), `5693ad0` (app), `a1c90ca` (website) and
the QA fixes in `294d47d`.

**Setup.** Local stack with every provider faked (Stripe, Mailjet, Twilio, captcha), API on :4010,
website on :3010, Metro on :8082, iPhone 17 Pro simulator (iOS, English device language) with Expo Go.
Face ID enrolled with `notifyutil`. Screenshots are in `.local/redesign-qa/after/` (not committed).

**No "before" screenshots were taken in this run**: the old app could not be shown any more once the
new code was in the working tree. The "before" scores below are based on the findings P1–P18 recorded
on 2026-11-20 (`docs/app-redesign.md` §3).

## 1. Automated checks

| Check | Result |
| --- | --- |
| `npm run format:check`, `lint`, `typecheck` | pass |
| API tests (`apps/api`, 46 files) | 509 passed |
| App tests (`apps/mobile`, 17 suites) | 107 passed |
| UI / i18n / shared packages | 38 / 13 / 5 passed (token contrast incl. the new accent pairs) |
| `npm run db:check` (migration up, rollback, up) | pass |
| Website E2E (Playwright, desktop + mobile Chrome, against the QA stack) | 115 passed, 9 skipped (skips are existing desktop-only/conditional tests) |
| `expo export --platform android` (CI step) | pass |

## 2. Functional test matrix (simulator)

| # | Area | Case | Result |
| --- | --- | --- | --- |
| 1 | First launch | three onboarding scenes, page dots, „Next“ | pass |
| 1 | First launch | „Skip“ | pass in unit test; on the simulator Expo Go's floating dev button covers it (not present in real builds) |
| 1 | First launch | „Get started“ → sign-up; „I already have an account“ → sign-in | pass |
| 2 | Sign-up | invalid e-mail keeps „Send code“ disabled | pass |
| 2 | Sign-up | 6 code boxes, auto-submit on six digits | pass |
| 2 | Sign-up | wrong / expired code, resend timer (60 s) | pass (unit tests; resend timer also seen on device) |
| 2 | Sign-up | Arabic-Indic digits converted | pass (unit tests) |
| 2 | Sign-up | name and address validation, wrong postcode | pass (error shown; fixed: stale error now clears while typing) |
| 2 | Sign-up | phone skipped | pass |
| 2 | Sign-up | phone given → SMS code from the fake inbox → confirmed | pass (fixed: confirmation was shown twice) |
| 2 | Sign-up | app closed in the middle → resumes at sign-up step 2/4 | **failed, fixed** (`newAccount` from the API) |
| 3 | Paywall | Plus vs Premium („from 9 November 2027“), details folded | pass |
| 3 | Paywall | payment page closed without paying → „Payment cancelled. Nothing was charged.“ | pass (P3) |
| 3 | Paywall | fake payment → „Welcome to ParkShield!“ → „Add your car“ | pass |
| 3 | Paywall | Stripe prefill (fake customer record: Max Neumann, Ringstrasse 7, 10115 Berlin) | pass |
| 4 | Car | add car | pass after fix: an invalid plate showed „Something went wrong“ — now says what to check |
| 4 | Car | first QR → „Your car is protected“ → QR page → push explanation (first time only) | pass (P6, P8) |
| 4 | Car | QR on top with Print / Share or save; guide folded; design screen with real thumbnails and headline chips | pass (fixed: template names were truncated, now three per row) |
| 4 | Car | Print / Share actions open the system sheets | not opened on the simulator (covered by unit test for the share path) |
| 5 | Alerts | alert from the scanner API → Home shows it first, urgent red, „just now“, badge 1 on Alerts | pass |
| 5 | Alerts | „I'm coming“ on the Home card | pass (fixed: added a confirmation; the card used to vanish silently) |
| 5 | Alerts | „In about 30 min“, „I'm not nearby“, chat open/send | not re-tested on the simulator (screens unchanged; existing unit tests pass) |
| 5 | Alerts | Alerts tab list + 90-day history | pass (unit tests; tab seen on device) |
| 6 | Lock | Face ID offer after sign-up and after completing an old account | pass |
| 6 | Lock | enable (Face ID prompt, match) | pass |
| 6 | Lock | cold start with lock on → locked, asks Face ID by itself | pass |
| 6 | Lock | non-matching face → „Face Not Recognized“ → cancel → lock screen with message and „Unlock“ | pass |
| 6 | Lock | background > timeout (setting lowered to 10 s for the test, restored to 300) → locked | pass |
| 6 | Lock | background < timeout → stays open | pass |
| 6 | Lock | device passcode fallback | not testable: the simulator has no passcode (the option is enabled in code, `disableDeviceFallback: false`) |
| 6 | Lock | alert opened from a notification while locked | not testable in Expo Go (no push); covered by unit tests of `allowedWhileLocked` and the gate |
| 7 | Existing account | old account (e-mail only, paid, with car) → blocking „Complete your account“ → no new welcome letter | pass (its only letter predates the profile) |
| 7 | New account | sign-up profile source `signup`; letter address = sign-up address | pass (API tests; letter not printed on device) |
| 8 | Account | all former „More“ items, lock switch, red sign-out row, version | pass |
| 8 | Account | data export, delete-account start/cancel, e-mail language | not re-tested on the simulator (screens unchanged; unit/E2E tests pass) |
| 9 | Website | `/konto` asks for name and address before the checkout; validation; a11y | pass (new E2E `signup-profile.spec.ts`) |

Other findings fixed in `294d47d`: the first tap on a button while the keyboard was open only closed
the keyboard; duplicated titles on the paywall and the push explanation; German quotes „…“ in the
English UI; two buttons for the same step on Home without a car; empty decal-order address although
the sign-up address is known (now prefilled); white wheels on the car in dark mode; lock offer showed a
Face ID icon when only the device code exists.

## 3. Design and UX scores (1–10)

Scores: clarity / visual quality / consistency / emotion and trust / accessibility.

| Screen | Before (from findings) | After |
| --- | --- | --- |
| Onboarding | — (did not exist) | 9 / 8 / 9 / 9 / 8 |
| Sign-in / sign-up steps | 5 / 5 / 6 / 5 / 6 | 9 / 8 / 9 / 8 / 8 |
| Paywall | 4 / 5 / 6 / 3 / 7 | 8 / 8 / 8 / 8 / 8 |
| Start (Home) | 4 / 5 / 5 / 4 / 7 | 9 / 9 / 9 / 9 / 8 |
| Alert screen | 8 / 7 / 7 / 8 / 8 | 8 / 7 / 8 / 8 / 8 (unchanged screen) |
| Alerts tab | — (part of Home) | 8 / 8 / 8 / 8 / 8 |
| Cars / QR page | 5 / 7 / 6 / 6 / 7 | 8 / 8 / 8 / 8 / 8 |
| Design screen | 4 / 5 / 6 / 5 / 7 | 8 / 8 / 8 / 8 / 8 |
| Account | 5 / 5 / 5 / 5 / 7 | 9 / 9 / 9 / 8 / 8 |
| Lock screen | — | 9 / 8 / 9 / 9 / 8 |
| Dark mode (all) | 7 / 7 / 7 / 7 / 7 | 8 / 8 / 8 / 8 / 8 |

Accessibility notes: every new control has a label; the progress bar, page dots and code input are
announced as one element each; the pager pages that are not visible are hidden from VoiceOver; the
success animation and onboarding paging respect „Reduce Motion“; all touch targets are ≥ 44 pt;
heading font scales with Dynamic Type. **Not done in this run:** a VoiceOver walk-through, the largest
Dynamic Type size and the iPhone SE size on the simulator, and offline states (API stopped) — these
are on the list below.

## 4. Remaining issues

| Priority | Issue |
| --- | --- |
| High | Face ID / fingerprint on real devices (iPhone with passcode, Samsung) not tested; needs a development build (Face ID is not supported in Expo Go). |
| High | Lawyer: privacy text for name/address, legal basis, store privacy labels, folded checkout details (`LEGAL_REVIEW.md` §8). |
| Medium | Notification-tap exception to the lock tested only by unit tests (needs a build with Firebase). |
| Medium | Manual VoiceOver pass, largest Dynamic Type, iPhone SE, offline states. |
| Medium | Deletion period for name/address of accounts that never pay (proposal 90 days, needs a decision). |
| Low | Android emulator not available in this run: Android layout and biometrics untested. |
| Low | „Skip“ on onboarding sits under Expo Go's dev button (dev only). |
| Low | In the simulator the first typed text after a tap sometimes did not arrive (simulator input timing; not reproduced in code). |

## 5. Not deployed

Nothing was deployed. Before the test server: run the migration and tell the team that existing test
accounts will be asked for name and address (`docs/status.md` §4 item 8).
