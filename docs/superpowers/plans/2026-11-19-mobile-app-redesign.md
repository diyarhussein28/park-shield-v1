# Owner app redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ParkShield owner app (`apps/mobile`) the website's brand and a four-tab layout with scannable cards, without changing any behaviour.

**Architecture:** Expo Router `Tabs` in a `(tabs)` route group with a custom, testable tab bar (`BrandTabBar`); every other screen stays in the root stack and is pushed above the tabs. A tokens module mirrors `packages/ui/src/theme.css`; icons and the logo are the website's SVG paths drawn with `react-native-svg`. Screens are restyled in place; data and API calls stay as they are.

**Tech Stack:** Expo SDK 58, expo-router 58, React Native 0.88, react-native-svg (new), Jest (jest-expo, RNTL 14: `render` and `fireEvent` are async).

**Spec:** `docs/superpowers/specs/2026-11-19-mobile-app-redesign-design.md`

## Global Constraints

- No API changes, no new functionality, no storage, no tracking. All three owner replies (`coming`, `in_30_min`, `not_nearby`) stay.
- Languages: German and English only; website texts through `pt()` (`src/lib/portal-i18n.ts`), new app texts in both `de` and `en` of `src/lib/i18n.ts` (the parity test fails otherwise).
- Colour roles 1:1 from `packages/ui/src/theme.css` (light and dark); app extras only `urgent` (= danger) and `brandYellow` `#facc15` (logo only, never text).
- Spacing 4 · 8 · 12 · 16 · 20 · 24 · 32; radius 8 · 12 · 16 · 999; type display 30/36 800 · title 24/30 800 · heading 19/25 700 · body 17/24 400 · label 15/20 600 · caption 13/18 500.
- Touch targets ≥ 48 × 48; buttons 52 high, the alert's „Ich komme“ 56.
- Logo: the website's `LogoMark` vector only, ≥ 24 pt, no white variant, never on `primary`; wordmark „Park“ in `fg` + „Shield“ in `primary`, weight 800.
- Tab labels: „Warnungen“/„Alerts“, „Fahrzeuge“/„Vehicles“, „Konto“/„Account“, „Mehr“/„More“; one line each.
- Every icon is decorative next to a text label; no `<Link asChild>` (guard test exists); no decorative motion.
- Do not commit: the owner has not approved commits yet. Each task ends with a checkpoint (all checks green) instead.
- Checks for every task: `npx tsc --noEmit -p .` and `npx jest` in `apps/mobile` pass; `npx prettier --check apps/mobile` passes.

## Review Focus

- Largest Dynamic Type size: tab labels and buttons must not wrap or clip → tab labels use `numberOfLines={1}` + `adjustsFontSizeToFit` (test in Task 4).
- Dark mode: every token pair readable → the contrast test runs on light and dark (Task 1).
- Push tap or deep link on a cold start to `/alerts/<id>`: must open the alert above the tabs, not a blank tab → route-location test (Task 4).
- First run without a subscription: Warnungen must lead to the checkout, not show "no alerts" → feed test (Task 5).
- More than 99 open alerts, or none: badge shows „99+“ / no badge → tab bar test (Task 4).

---

### Task 1: Design tokens

**Files:**
- Create: `apps/mobile/src/theme/tokens.ts`
- Create: `apps/mobile/src/theme/tokens.test.ts`
- Modify: `apps/mobile/src/components/ui.tsx` (remove the local `light`/`dark` objects; re-export `useTheme`, `Theme` from `@/theme/tokens`)
- Modify: every screen/component using `c.okBg c.okFg c.warnBg c.warnFg c.errBg c.errFg` (→ `successBg successFg warningBg warningFg dangerBg dangerText`)

**Interfaces:**
- Produces: `export const light: Theme`, `export const dark: Theme`, `export type Theme = { bg; fg; muted; surface; border; borderStrong; primary; primaryHover; primaryFg; secondary; secondaryFg; danger; dangerFg; focus; infoBg; infoFg; successBg; successFg; warningBg; warningFg; dangerBg; dangerText; urgent; brandYellow }` (all `string`), `export function useTheme(): Theme`, `export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 }`, `export const radius = { sm: 8, md: 12, lg: 16, pill: 999 }`, `export const type = { display, title, heading, body, label, caption }` (each `{ fontSize, lineHeight, fontWeight }`), `export const touch = { min: 48, button: 52, primaryAction: 56 }`.

- [ ] **Step 1: Write the failing tests** in `tokens.test.ts`:
  - `it('mirrors the website colours (light and dark)')`: read `../../../../packages/ui/src/theme.css`, parse every `--ps-<name>: #xxxxxx;` in the light block and in the `prefers-color-scheme: dark` block, map kebab-case to camelCase (`border-strong` → `borderStrong`), and `expect(light[key]).toBe(value)` / `expect(dark[key]).toBe(value)` for each; `expect(light.urgent).toBe(light.danger)`.
  - `it('every text/background pair meets WCAG AA in both themes')`: for `[fg,bg] [fg,surface] [muted,bg] [muted,surface] [primary,bg] [primary,surface] [primaryFg,primary] [dangerFg,danger] [infoFg,infoBg] [successFg,successBg] [warningFg,warningBg] [dangerText,dangerBg]` assert contrast ≥ 4.5 (WCAG relative luminance, as in `packages/ui/src/contrast.test.ts`).
- [ ] **Step 2: Run** `npx jest src/theme` → FAIL (module not found).
- [ ] **Step 3: Implement `tokens.ts`** with the values from `theme.css`; `useTheme()` returns `dark` when `useColorScheme() === 'dark'`.
- [ ] **Step 4: Point `ui.tsx` and the token users at the new names**; run `npx jest` and `npx tsc --noEmit -p .` → PASS.
- [ ] **Step 5: Checkpoint** (all checks green, no commit).

### Task 2: Icons, logo, alert-type icons, illustration slots

**Files:**
- Create: `apps/mobile/src/components/icons.tsx`, `apps/mobile/src/components/illustration.tsx`, `apps/mobile/src/components/icons.test.tsx`
- Modify: `apps/mobile/package.json` (`npx expo install react-native-svg`), `apps/mobile/jest.setup.ts` (mock `react-native-svg`: `Svg, Path, Rect, Circle, G, Defs, LinearGradient, Stop` as `View`-based components that pass props through)

**Interfaces:**
- Produces: `type IconName` (the website's names: `shield shieldCheck bell phone mail chat eyeOff lock users zap qr check arrowRight play pause menu close plus car lightbulb cloudRain truck globe home clock card download help logout database scan chevronDown arrowLeft alert`), `Icon({ name, size = 24, color }: { name: IconName; size?: number; color: string })` (stroke 2, round caps/joins, `accessible={false}`), `LogoMark({ size = 32 })`, `Wordmark({ size = 22 })` („Park“ fg + „Shield“ primary), `alertTypeIcon(code: string): IconName`, `AlertTypeIcon({ code, urgent, size = 32 })` (icon in a tinted circle: `infoBg`/`primary`, urgent `dangerBg`/`urgent`), `Illustration({ name }: { name: 'empty-alerts' | 'empty-vehicles' | 'decal-placement' | 'alert-sent' })` (placeholder vector from shield, QR square and car outline, `accessibilityElementsHidden`, 160 pt high).

- [ ] **Step 1: Write the failing tests** in `icons.test.tsx`:
  - `alertTypeIcon` maps `blocking→car, lights_on→lightbulb, window_open→cloudRain, damage→alert, alarm→bell, towing_risk→truck, custom→chat`, unknown code → `alert`.
  - `it('has every icon of the website')`: read `../../../web/components/icons.tsx`, collect the keys of `paths`, and expect `Object.keys(ICON_PATHS).sort()` to equal them.
  - `LogoMark` renders the website's shield path `M16 2 4 6.5v8.6C4 22.4 9.1 28.2 16 30c6.9-1.8 12-7.6 12-14.9V6.5L16 2Z` and the yellow square `#facc15`.
- [ ] **Step 2: Run** `npx jest src/components/icons` → FAIL.
- [ ] **Step 3: Implement** `icons.tsx` (export `ICON_PATHS` copied verbatim from `apps/web/components/icons.tsx`; `LogoMark` with a unique gradient id per instance via `useId`) and `illustration.tsx`.
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 3: UI kit

**Files:**
- Modify: `apps/mobile/src/components/ui.tsx`, `apps/mobile/src/components/form.tsx`
- Create: `apps/mobile/src/components/ui.test.tsx`

**Interfaces:**
- Consumes: Task 1 tokens, Task 2 `Icon`, `Illustration`.
- Produces (existing names keep their props): `Screen`, `Title` (type.title), `P`, `Card` (radius 16, padding 16, 1 px `border`, iOS shadow opacity 0.05 radius 6, Android elevation 1), `Button({ …, variant: 'primary' | 'secondary' | 'ghost' | 'danger', size?: 'md' | 'lg' })` (heights 52 / 56, radius 12), `Banner({ tone: 'info' | 'ok' | 'warn' | 'err' })`, `Loading`; new `Section({ title, intro?, children })`, `EmptyState({ illustration, title, text, action?: { label; onPress } })`, `ProgressBar({ percent, label })` (accessibilityRole `progressbar`), `Chip({ children, tone: 'info' | 'ok' | 'warn' | 'urgent' | 'neutral' })`; in `form.tsx`: `ListRow({ icon?: IconName, title, text?, onPress, badge? })` (replaces `MenuRow`, keep `MenuRow` as an alias until Task 8), `Segmented<T>({ legend, options, value, onChange, label })` (accessibilityRole `radio` per segment, for 2–3 options), `Badge` becomes an alias of `Chip`.

- [ ] **Step 1: Write the failing tests** in `ui.test.tsx`: `Button` size `lg` has `minHeight: 56`, `md` 52, `ghost` has no border; `EmptyState` renders title, text and an action button that calls `onPress`; `Segmented` marks the chosen option `accessibilityState.checked: true` and calls `onChange('en')` on press; `ProgressBar` exposes `accessibilityValue { min: 0, max: 100, now: 40 }`; `ListRow` with `text` has `accessibilityLabel` `"Title, text"`.
- [ ] **Step 2: Run** `npx jest src/components/ui` → FAIL.
- [ ] **Step 3: Implement** the components with the token values (Global Constraints); press feedback opacity 0.85 only.
- [ ] **Step 4: Run** `npx jest` → PASS (existing screen tests unchanged).
- [ ] **Step 5: Checkpoint.**

### Task 4: Tab navigation

**Files:**
- Create: `apps/mobile/src/app/(tabs)/_layout.tsx`, `apps/mobile/src/app/(tabs)/mehr.tsx`, `apps/mobile/src/components/tab-bar.tsx`, `apps/mobile/src/lib/alerts-store.tsx`, `apps/mobile/src/__tests__/navigation.test.tsx`
- Move: `src/app/index.tsx` → `src/app/(tabs)/index.tsx`, `src/app/fahrzeuge.tsx` → `src/app/(tabs)/fahrzeuge.tsx`, `src/app/konto.tsx` → `src/app/(tabs)/konto.tsx` (update test imports: `@/app/(tabs)/…`)
- Delete: `src/app/uebersicht.tsx` (its parts land in Tasks 5, 7, 8)
- Modify: `src/app/_layout.tsx` (Stack: `(tabs)` with `headerShown: false`; remove the `index`, `fahrzeuge`, `konto`, `uebersicht` entries; keep all pushed screens), `src/lib/i18n.ts` (`tabAlerts tabVehicles tabAccount tabMore`), `AGENTS.md` (app section: the four tabs, `BrandTabBar`, tokens file)

**Interfaces:**
- Consumes: Task 2 `Icon`, Task 3 `ListRow`, `Section`.
- Produces: `openAlertCount(alerts: AlertListItem[]): number` (not `acknowledged` and `status !== 'expired'`); `AlertsProvider` + `useAlerts(): { data: AlertList | null; error: boolean; reload: () => Promise<void>; open: number }` (loads `GET /v1/app/alerts`; mounted in `(tabs)/_layout.tsx`); `BrandTabBar(props: BottomTabBarProps & { badges?: Record<string, number> })` with tab order `index · fahrzeuge · konto · mehr` and icons `bell · car · card · menu`.

- [ ] **Step 1: Write the failing tests** in `navigation.test.tsx`:
  - `openAlertCount` counts open alerts only (acknowledged and expired excluded).
  - `BrandTabBar` (render with a fake `state` of four routes, `navigation.emit` returning `{ defaultPrevented: false }` and `navigation.navigate` mocks): each tab has `accessibilityRole="tab"`, the label text, `accessibilityState.selected` on the active one; pressing „Konto“ calls `navigate('konto')`; labels have `numberOfLines: 1` and `adjustsFontSizeToFit: true`; badge `{ index: 3 }` shows „3“ and its accessibilityLabel includes it; `{ index: 120 }` shows „99+“; `0` shows no badge.
  - `it('push targets stay outside the tab group')`: `alerts/[id].tsx`, `chat/[id].tsx`, `fahrzeug/[id].tsx`, `app/alerts/[id].tsx` exist under `src/app` and not under `src/app/(tabs)`; `uebersicht.tsx` no longer exists.
- [ ] **Step 2: Run** `npx jest src/__tests__/navigation` → FAIL.
- [ ] **Step 3: Implement** the store, the tab bar (height ≥ 56 + bottom safe area, active tint `primary`, inactive `muted`, top border `border`, background `bg`), `(tabs)/_layout.tsx` (`<Tabs tabBar={(p) => <BrandTabBar {...p} badges={{ index: open }} />}>`, headers on with the website titles), `mehr.tsx` as a placeholder list (filled in Task 8), and move the routes.
- [ ] **Step 4: Run** `npx jest`, `npx tsc --noEmit -p .` → PASS; `npx expo export --platform ios --output-dir <scratchpad>` → "Exported".
- [ ] **Step 5: Checkpoint.**

### Task 5: Warnungen feed

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/index.tsx`
- Create: `apps/mobile/src/components/setup-guide.tsx` (moved from `uebersicht.tsx`), `apps/mobile/src/components/alert-card.tsx`, `apps/mobile/src/__tests__/feed.test.tsx`
- Modify: `apps/mobile/src/__tests__/home.test.tsx` (now only the alert tap; menu assertions move to Task 8), `src/lib/i18n.ts` (`emptyAlertsTitle`, `emptyAlertsText`, `emptyAlertsAction`)

**Interfaces:**
- Consumes: `useAlerts()` (Task 4), `AlertTypeIcon`, `LogoMark`, `Wordmark`, `Chip`, `EmptyState`, `ProgressBar`, `PastDue` (`components/subscription.tsx`).
- Produces: `AlertCard({ alert, onPress })` (type icon, type name, nickname, time, status chip from the existing `statusLabel`, „Test“ chip, 4 pt `urgent` leading stripe when `severity === 'urgent'`; accessibilityLabel unchanged: `"<type>, <nickname>, <status>"`); `SetupGuide({ protection, vehicles, onGo })`.

- [ ] **Step 1: Write the failing tests** in `feed.test.tsx` (mock `GET /v1/app/alerts`, `/v1/billing/subscription`, `/v1/me/protection`, `/v1/vehicles`):
  - without a plan: shows `pt('portal.startTitle')` and a button `pt('portal.start1Go')`; pressing it calls `router.navigate('/konto')`; the empty-alerts text is not shown.
  - with a plan, no alerts, protection 100 %: shows `t('emptyAlertsTitle')`; the action calls `router.navigate('/fahrzeuge')`.
  - with a plan and protection 50 %: shows `pt('protection.percent', { percent: 50 })`.
  - `status: 'past_due'`: shows `pt('account.pastDueNotice')`.
  - an urgent alert card has the stripe (`testID="urgent-stripe"`); a test alert shows the `t('test')` chip.
  - API error: shows `t('error')` banner and the tab content stays rendered.
- [ ] **Step 2: Run** `npx jest src/__tests__/feed` → FAIL.
- [ ] **Step 3: Implement**: header title row with `LogoMark size 28` + `Wordmark` (via `Stack.Screen`/`Tabs` header `headerTitle`), banners order (past due, welcome, push off / no Firebase), start card or set-up guide, alert cards, pull to refresh, empty state with `Illustration name="empty-alerts"`.
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 6: Alert detail and chat

**Files:**
- Modify: `apps/mobile/src/app/alerts/[id].tsx`, `apps/mobile/src/app/chat/[id].tsx`, `apps/mobile/src/__tests__/alert-screen.test.tsx`

**Interfaces:**
- Consumes: `AlertTypeIcon` (size 48), `Chip`, `Button` (`size="lg"`), `Card`.

- [ ] **Step 1: Write the failing test** in `alert-screen.test.tsx`: `it('urgent actions come first, in order')` — the pressable labels in render order are `t('coming')`, then the chat button (`t('chatOpen')` or `t('chatContinue')`), then `t('in30')` and `t('notNearby')`; `t('coming')` has `minHeight: 56`. Existing tests keep passing unchanged.
- [ ] **Step 2: Run** `npx jest src/__tests__/alert-screen` → FAIL.
- [ ] **Step 3: Implement**: hero card (icon 48, type, vehicle, time, status chip; message / Protected Mode „Anzeigen“; photos), action block (primary lg, secondary, then a row with the two tertiary buttons that stacks at `fontScale > 1.3`), success state after „Ich komme“; chat: bubbles with radius 16, quick replies as `Chip`-styled pressables (≥ 48 high) above the input. No logic changes.
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 7: Fahrzeuge tab and vehicle detail

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/fahrzeuge.tsx`, `apps/mobile/src/app/fahrzeug/[id].tsx`
- Create: `apps/mobile/src/components/how-it-works.tsx` (moved from `uebersicht.tsx`), `apps/mobile/src/components/decal-guide.tsx`
- Modify: `apps/mobile/src/__tests__/portal-screens.test.tsx`, `src/lib/i18n.ts` (`emptyVehiclesTitle`, `emptyVehiclesText`, `decalGuideTitle`, `decalGuideStep1`, `decalGuideStep2`, `decalGuideStep3`)

**Interfaces:**
- Consumes: `Card`, `Chip`, `EmptyState`, `Illustration`, `Section`, `useTheme`, `authHeaders` (QR thumbnail = decal SVG via `expo-image`, as on the vehicle detail).
- Produces: `HowItWorks()` (`portal.howTitle`, `portal.howIntro`, three steps `portal.how1Title…how3Text`), `DecalGuide()` (`Illustration name="decal-placement"` + `decalGuideTitle` + three numbered steps).

- [ ] **Step 1: Write the failing tests** (add to `portal-screens.test.tsx`): vehicle card shows a `decal-image` thumbnail; `pt('portal.howTitle')` is on the tab; no vehicles + plan → `t('emptyVehiclesTitle')`; no plan → `pt('vehicles.noSubscription')` and a button `pt('portal.planTitle')` that calls `router.navigate('/konto')`; vehicle detail shows `t('decalGuideTitle')` between the QR hero and `pt('decal.title')`. Existing assertions keep passing.
- [ ] **Step 2: Run** `npx jest src/__tests__/portal-screens` → FAIL.
- [ ] **Step 3: Implement** the cards (thumbnail 72 pt left, text right, status chip, „Aufkleber und Details ›“ = `pt('vehicles.open')`), the add-vehicle card, `HowItWorks`, the empty state, and on the detail the section order of the spec (QR & test · Anbringen · Design · Bestellung · Modi · Schutzmodus · Daten · Neuer Code · Löschen). Guide copy (DE/EN), website tone, e.g. „Innenseite der Scheibe reinigen“, „Unten auf der Beifahrerseite anbringen, von außen lesbar“, „Mit ‚Aufkleber testen‘ prüfen“.
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 8: Konto tab, Mehr tab, sign-in

**Files:**
- Modify: `apps/mobile/src/app/(tabs)/konto.tsx`, `apps/mobile/src/app/(tabs)/mehr.tsx`, `apps/mobile/src/app/anmelden.tsx`, `apps/mobile/src/components/form.tsx` (drop the `MenuRow` alias)
- Modify: `apps/mobile/src/__tests__/portal-screens.test.tsx`, `apps/mobile/src/__tests__/home.test.tsx` (menu assertions → Mehr), `src/lib/i18n.ts` (`appVersion: 'Version {version}'` / `'Version {version}'`)

**Interfaces:**
- Consumes: `SubscriptionInfo`, `CheckoutForm`, `openPaymentPortal` (`components/subscription.tsx`), `ListRow`, `Segmented`, `LogoMark`, `Wordmark`, `APP_VERSION`.

- [ ] **Step 1: Write the failing tests**:
  - Konto with a plan: the first card contains `pt('account.planName', { plan: 'Plus' })` and `pt('account.paymentMethod')`; the e-mail language is a `Segmented` (`Deutsch` / `English`) and saves `{ preferredLang: 'en' }`.
  - Konto without a plan: shows `pt('portal.startTitle')` above the checkout (`pt('checkout.pay')`).
  - Mehr: rows `pt('portal.notifications')`, `pt('portal.contacts')`, `pt('portal.history')`, `pt('deliveryHelp.link')`, `pt('portal.data')`, `t('help')` push `/benachrichtigungen`, `/einstellungen`, `/verlauf`, `/zustellung`, `/daten`, `/hilfe`; `t('signOut')` and `t('appVersion', { version: '1.0.0' })` are shown.
  - Sign-in renders the logo shield path and the wordmark.
- [ ] **Step 2: Run** `npx jest` → FAIL.
- [ ] **Step 3: Implement**: Konto order (plan card or start + checkout, invoices, summary e-mail, profile, passkeys, withdrawal, cancellation, sign-out removed here because it moves to Mehr), Mehr (grouped `ListRow`s with icons `bell users clock alert database help` and the website's one-line summaries `portal.historyText`, `portal.deliveryText`, `portal.dataText`, `channels.summaryPhone`, `contacts.summary`), sign-in (LogoMark 64, Wordmark 28, intro, field, button, divider, paste fallback).
- [ ] **Step 4: Run** `npx jest` → PASS.
- [ ] **Step 5: Checkpoint.**

### Task 9: Verification on build and device

**Files:** none new.

- [ ] **Step 1:** In `apps/mobile`: `npx tsc --noEmit -p .`, `npx jest`, and from the repo root `npx prettier --check .` → all pass.
- [ ] **Step 2:** `npx expo export --platform ios --output-dir <scratchpad>/ios-export` and `--platform android` → both "Exported".
- [ ] **Step 3:** Restart Metro from `apps/mobile` with `--clear` (new dependency) and ask the owner to check on the iPhone, light and dark mode and the largest text size: the four tabs; badge; feed with and without a plan; alert detail actions; a vehicle with QR and guide; Konto; Mehr; sign-in.
- [ ] **Step 4: Checkpoint** — report results; commit only when the owner asks.
