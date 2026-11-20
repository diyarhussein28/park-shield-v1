# ParkShield owner app — mobile redesign (design)

Date: 2026-11-19. Scope: the native owner app (`apps/mobile`). The scanner page (`/s/[code]`) is a
separate, later project with its own design.

## 1. Intent

The owner app works but feels cluttered: a long alert list followed by eight menu rows, plain text and
raw forms. The owner wants it to look and feel like the website (same logo, colours, icons, tone), with
clear navigation and scannable cards, so it earns trust and is easy to use in a hurry on the street.

**Goals**

- One product: website and app share logo, colour roles, icons and wording.
- Navigation that never leaves the owner lost: a bottom tab bar with four tabs.
- Scannable screens: cards, clear hierarchy, generous spacing, touch targets ≥ 48 pt.
- The two urgent actions on an alert („Ich komme“, „Rückfrage stellen“) are unmistakable.
- Ready for real artwork: illustration slots that work now with simple placeholders.

**Non-goals**

- No API changes and no new functionality: every screen keeps the behaviour built so far (portal
  parity, payment in the app, all three owner replies, texts from `packages/i18n`). The only new
  content is what the request asks for: empty states and a short decal placement guide (§5, §7).
- No Arabic, no right-to-left layout: German and English only.
- No native system tabs, no custom fonts (the website uses the system font too).

**Anti-goals** (a failure even if it works)

- Any tracking, analytics or new storage. The app keeps only the session in the Keychain/Keystore.
- Losing accessibility: contrast below WCAG AA, targets under 44 pt, icons without text, motion that
  cannot be reduced.
- Texts that differ from the website for the same thing.

## 2. Approaches

| Approach                                        | Trade-off                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **A. Branded tab bar (chosen)**                 | Expo Router `Tabs`, website icons, full control of colour and dark mode; same look on iOS/Android |
| B. Native system tabs (iOS UITabBar, Material)  | Most native feel, but system icons instead of the website's, and less styling control             |
| C. Keep the stack, restyle only                 | Least work, but does not fix the navigation, the main complaint                                   |

The owner chose **A**.

## 3. Audit: what to fix

| Today                                                                  | Change                                                                                       |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Home = alert list + 8 menu rows under it                                | 4 tabs; the alert feed is its own tab, the rest lives in tabs and a „Mehr“ list               |
| „Übersicht“ is a separate screen nobody finds                           | Its parts move to where they belong: set-up guide, payment-failed and welcome banners → top of Warnungen; QR codes and „Was passiert beim Scannen?“ → Fahrzeuge; plan → Konto; quick links → Mehr |
| No logo anywhere in the app                                             | Logo mark on sign-in, in the Warnungen header and in empty states                            |
| Alerts are text rows                                                    | Alert cards with a type icon, colour stripe for urgent, status chip and time                 |
| Alert detail: equal-weight buttons                                      | One large primary „Ich komme“, a clear secondary „Rückfrage stellen“, the rest below         |
| Long forms in one column of cards                                       | Sections with a header, short intro and grouped fields; destructive actions at the bottom    |
| `Choice` radio lists for everything                                     | Segmented control for 2–3 short options, radio list only for longer ones                     |
| Plain „No alerts“ text                                                  | Empty states with illustration slot, title, one sentence and one action                      |
| App colours copied by hand (one border colour differs from the website) | One tokens file mirroring `packages/ui/src/theme.css`, tested for contrast                   |

## 4. Navigation blueprint

```
Root stack
├── (tabs)                       bottom tab bar, always visible on these four
│   ├── Warnungen   (index)      alert feed; set-up guide card on top while protection < 100 %
│   ├── Fahrzeuge                vehicle cards with QR thumbnail and decal status; „Fahrzeug hinzufügen“
│   ├── Konto & Abo              plan card (status, contract, renewal), checkout when none, invoices,
│   │                            summary e-mail, profile, passkeys, withdrawal, cancellation
│   └── Mehr                     list: Benachrichtigungen · Notfallkontakte · Verlauf ·
│                                Warnung nicht bekommen? · Meine Daten · Hilfe · Abmelden
└── pushed above the tabs (tab bar hidden, back button)
    alert detail · chat · vehicle detail · Benachrichtigungen · Notfallkontakte · Verlauf ·
    Zustellung · Daten · Kündigen · Widerrufen · Hilfe · push permission (modal) · sign-in
```

- Tab labels are short app texts so four fit on a 320 pt phone with large text: „Warnungen“ /
  „Alerts“, „Fahrzeuge“ / „Vehicles“, „Konto“ / „Account“, „Mehr“ / „More“. They are navigation, not
  content: the screen titles keep the website's wording (`portal.vehiclesTitle`, `portal.planTitle`
  …). Labels stay on one line (no wrapping), with `adjustsFontSizeToFit` as the last resort. Icons
  from the website set: `bell`, `car`, `card`, `menu`. *(Builder-check call.)*
- Badge on Warnungen: number of open alerts (not acknowledged, not expired), from the existing list.
- The alert detail and the chat are pushed above the tabs, so nothing competes with the urgent actions.
- Deep links and push taps keep their routes (`/alerts/[id]`, `/chat/[id]`, `/app/...`); only the
  home route moves into the tab group.
- The current `uebersicht` route is removed (its parts are spread as in §3).

## 5. Screens

**Warnungen (feed)**

- Header: logo mark + „ParkShield“, title „Warnungen“.
- Banners first: payment failed (`PastDue`, so an owner who stays on this tab still sees it), welcome
  after checkout, push off / no Firebase build. Then:
  - **without a plan:** the „In drei Schritten geschützt“ card (`portal.start*`) with „Abo
    abschließen“, which switches to the Konto tab where the checkout is. The tabs are always shown.
    *(Builder-check call: the app's first run without a plan leads to the checkout, as `/konto` does
    on the website.)*
  - **with a plan:** the set-up guide card (progress bar, the open steps as rows that open the right
    screen) while protection < 100 %.
- Alert cards, newest first: type icon in a tinted circle, type name, vehicle nickname, time; a status
  chip („Neu“, „Gesehen“, „Ich komme“, „Abgelaufen“ …, the existing status texts); urgent alerts get a
  red stripe on the leading edge and the urgent icon tint. Test alerts get a „Test“ chip.
- Pull to refresh stays. Empty state (only with a plan): illustration slot `empty-alerts`, „Keine
  Warnungen“, one line („Wenn jemand Ihren Aufkleber scannt, sehen Sie es hier.“), action „Aufkleber
  testen“ → Fahrzeuge.

**Alert detail** (pushed)

- Hero card: large type icon, type name, vehicle, time, status chip; the scanner's message (or the
  Protected Mode „Anzeigen“ button) and photos below.
- Action block, in this order: primary „Ich komme“ (full width, 56 pt); secondary „Rückfrage stellen“
  / „Chat fortsetzen“ with the scanner's online state; then a row of two tertiary buttons „In ca.
  30 Min“ and „Bin nicht in der Nähe“ (stacked when the text is large). All three replies stay.
- After „Ich komme“: success state in the hero („Die Person am Fahrzeug sieht: unterwegs“).

**Chat** (pushed) — messages as bubbles, quick replies as chips above the input, „Erledigt / Chat
schließen“ in the header. Behaviour unchanged.

**Fahrzeuge** — one card per vehicle: QR thumbnail (decal SVG), nickname, plate · colour, decal status
chip, „Aufkleber und Details ›“. „Fahrzeug hinzufügen“ as a card at the end (form opens in place).
Below: „Was passiert beim Scannen?“ (`portal.how*`, three numbered steps). Empty state: illustration
slot `empty-vehicles`; without a plan the website's `vehicles.noSubscription` notice with a button to
the Konto tab. Vehicle detail keeps all sections of the website's vehicle page, grouped: QR & test
(hero) · **Anbringen** (new, see below) · Design · Bestellung · Modi · Schutzmodus · Daten · Neuer Code ·
Löschen (last, danger zone).

**Anbringen (decal placement guide, new)** — the request asks for a visual guide. One card on the
vehicle detail, under the QR hero: illustration slot `decal-placement`, three short steps (clean the
inside of the windscreen, put the decal in the lower passenger-side corner readable from outside,
test it with „Aufkleber testen“). New app texts in DE and EN; the exact wording is the builder's,
in the website's tone. *(Builder-check call: this is the only new content section.)*

**Konto & Abo** — plan card on top (plan name, status chip, contract number, renewal/end date, „Zahlungsart
ändern“); without a plan the three-step „In drei Schritten geschützt“ and the checkout. Then
grouped sections: Rechnungen · Zusammenfassung per E-Mail · Profil (e-mail, customer number, e-mail
language) · Passkeys · Widerruf · Kündigung.

**Mehr** — grouped list rows with icon, title, one-line summary (as the website's quick links), then
„Abmelden“ at the bottom, app version under it.

**Sign-in** — logo mark large, „ParkShield“ wordmark, one sentence, e-mail field, „Anmeldelink
senden“, the paste-link fallback below a divider.

## 6. Design tokens (`src/theme/tokens.ts`)

Colours are the website's roles, light and dark, 1:1 from `packages/ui/src/theme.css`:
`bg, fg, muted, surface, border, borderStrong, primary, primaryHover, primaryFg, secondary,
secondaryFg, danger, dangerFg, focus, infoBg/infoFg, successBg/successFg, warningBg/warningFg,
dangerBg/dangerText`. Plus two app roles derived from them: `urgent` = `danger`, `brandYellow` =
`#facc15` (the logo's QR square only, never text). A contrast test (like `packages/ui`'s) checks every
text/background pair for AA.

| Token                  | Value                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Spacing                | 4 · 8 · 12 · 16 · 20 · 24 · 32 (screen gutter 16, between cards 12, inside cards 16)    |
| Radius                 | 8 chips/inputs small · 12 buttons/inputs (web `rounded-xl`) · 16 cards (`rounded-2xl`) · 999 pills |
| Type scale (pt / line) | display 30/36 800 · title 24/30 800 · heading 19/25 700 · body 17/24 400 · label 15/20 600 · caption 13/18 500 |
| Touch target           | min 48 × 48 (buttons 52 high, primary action on alert detail 56)                      |
| Elevation              | cards: 1 px `border` + iOS shadow (opacity 0.05, radius 6) / Android elevation 1      |
| Icons                  | website set, 24 grid, stroke 2; sizes 20 (rows), 24 (tabs), 32 (type circle), 48 (hero) |
| Motion                 | press feedback only (opacity 0.85); no decorative motion; respects Reduce Motion      |

**Components** (`src/components/`): `Icon` and `LogoMark` (react-native-svg, website paths), `Screen`,
`Section` (header + optional intro), `Card`, `ListRow` (icon, title, subtitle, chevron), `Button`
(primary · secondary · ghost · danger; sizes md 52 / lg 56), `Chip` (tone), `Segmented`, `Field`,
`Check`, `Choice`, `Banner`, `EmptyState` (illustration slot, title, text, action), `AlertTypeIcon`,
`ProgressBar`, `Illustration` (named slot → placeholder until real art exists).

**Logo rules**: the mark only from the website's `LogoMark` vector (never a PNG), exactly as on the
website (blue gradient shield, white and yellow QR squares; it carries its own background, so there is
no white variant and it is never placed on `primary`); minimum 24 pt; clear space of one QR square
around it. The wordmark is as on the website: „Park“ in `fg` and „Shield“ in `primary`, system font,
weight 800.

**Alert type icons** (website set): blocking → `car` + urgent tint · lights_on → `lightbulb` ·
window_open → `cloudRain` · damage → `alert` · alarm → `bell` · towing_risk → `truck` · custom → `chat`.

## 7. Illustrations and images

No illustrations exist yet. `Illustration` takes a name (`empty-alerts`, `empty-vehicles`,
`decal-placement`, `alert-sent`) and renders a simple vector placeholder built from brand shapes
(shield, QR square, car outline) until real artwork is dropped into `assets/illustrations/<name>.svg`.
The decal placement guide (§5) uses the slot `decal-placement`; the design picker keeps using the
live decal preview from the API.

## 8. Constraints

- Expo SDK 58 in Expo Go: `react-native-svg` is the only new dependency (included in Expo Go).
- All texts through `pt()` (website) or the app dictionary; new app texts in DE and EN.
- Accessibility as on the website (WCAG 2.2 AA): every icon decorative next to a text label, tab bar
  items with accessibility labels and selected state, Dynamic Type not clipped (no fixed heights on
  text containers), dark mode for every token.
- Tests: the existing Jest tests keep passing (labels unchanged); new tests for the tab bar, the open
  alert badge, the token contrast and the `asChild` guard.

## 9. Left to the builder

Exact copy of the few new app texts (empty states, „Mehr“), the placeholder illustration drawings,
spacing details inside each section, and the order of rows within „Mehr“ beyond the list above.
