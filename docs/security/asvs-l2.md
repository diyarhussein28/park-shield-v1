# OWASP ASVS 4.0.3 Level 2 – self-assessment (US-45)

Status 2026-11-10, before the external pentest. "Test" names the automated check that guards the
control; everything listed as a test runs in CI. Gaps are listed at the end with the decision taken.

| Chapter | Control in ParkShield | Evidence / test |
| --- | --- | --- |
| V1 Architecture | Public API and api-ops are separate deployments; api-ops binds to WireGuard only; Caddy answers `/ops/*` with 404 on public hosts. Threat model in `pentest-scope.md`. | `ops.test.ts` (no ops route on the public API, Caddy rule) |
| V2.1 Passwords | Not applicable: customers use magic links or passkeys, staff passkeys only. | – |
| V2.2 General authentication | Magic-link request: captcha, 5/h per address, 30/h per IP, identical answer for unknown addresses. Completing a sign-in (link, passkey) 60 per 10 min per IP; staff sign-in and invitations 30 per 10 min per peer. New-device e-mail on sign-in. | `security/hardening.test.ts`, `auth.test.ts` |
| V2.5 / 2.7 Recovery, out-of-band | Magic link: 256-bit, single use, 15 min, in the URL fragment (never logged), consumed only by an explicit POST. | `auth.test.ts` |
| V2.9 / passkeys | WebAuthn with user verification required for staff on the ops RP ID; customers optional. | `ops.test.ts`, `sprint8.spec.ts` |
| V3 Sessions | 256-bit random tokens, only SHA-256 stored; `HttpOnly`, `Secure` in production, `SameSite=Lax` (customers) / `Strict` (staff); customer 30 days, staff 30 min idle and 12 h absolute; logout revokes server-side; export and deletion need a sign-in less than 15 min old. Double-submit CSRF on every write with a session. | `auth.test.ts`, `ops.test.ts`, `sprint8.spec.ts` |
| V4 Access control | api-ops fails closed (a route without policy is refused); permissions, never role names; exactly the declared permissions open a route; four-eyes break-glass (no self-approval, 15 min, field-specific); customers reach only their own objects. | `security/ops-authz.test.ts` (route × permission matrix, CSRF, 401), `security/hardening.test.ts` (IDOR), `ops-tools.test.ts` |
| V5 Validation, encoding, injection | zod schemas on every body and query; Kysely parameterised queries only; React escaping, scanner page escapes every value and uses hash-based CSP; free text filtered for insults/threats; body limit 64 KB. | unit tests per module, `scan.test.ts` |
| V6 Cryptography | AES-256-GCM field encryption with key versions; HMAC blind indexes; HMAC-derived reply/DSR tokens; constant-time comparisons for tokens, CSRF and webhook secrets; keys only from SOPS-encrypted secrets. | `crypto.test.ts` |
| V7 Errors and logging | No personal data in logs (route pattern only, no IP, headers, bodies); Caddy access log without IP/URI; errors return codes, never stacks. Audit log of actions and reads, append-only for every role (incl. TRUNCATE), hash-chained copy in an Object Lock bucket. | `health.test.ts` (log content), `security/hardening.test.ts`, `back-office.test.ts` |
| V8 Data protection | `Cache-Control: no-store` on every API response; masking in ops (AD-05); retention function (24 h scanner refs, 7 days texts, 90 days alerts/addresses, 12 months audit); export and deletion incl. processors. | `retention.test.ts`, `privacy.test.ts` |
| V9 Communication | TLS 1.3 only at Caddy, HSTS 2 years with preload; internal traffic over the private network / WireGuard; PostgreSQL `hostssl` with scram-sha-256. | `infra/ansible/roles/caddy`, `pg_hba.conf.j2` |
| V10 Malicious code | Lockfile, `npm audit --omit=dev`, OSV scanner, Semgrep (TypeScript, Node, React, OWASP Top 10, secrets) in CI; Renovate (`renovate.json`) once the GitHub repository exists. | `.github/workflows/ci.yml` |
| V11 Business logic | Scanner limits (per vehicle, per scanner, per vehicle per day), captcha, abuse patterns and blocks; fair-use counters reserved atomically; refunds serialised per contract and recomputed under the lock; single-use tokens. | `scan.test.ts`, `preferences.test.ts` (fair use), `back-office.test.ts` |
| V12 Files and resources | No user file uploads in the MVP; PDFs generated server-side; outbound requests only to configured providers and to push endpoints from an allow-list (SSRF). | `security/hardening.test.ts` (push allow-list) |
| V13 API | JSON only; no CORS; CSRF guard; every unauthenticated route listed with its control (rate limit, token, signature). | `security/routes.test.ts` |
| V14 Configuration | Strict nonce-based CSP on web and ops (`'strict-dynamic'`, no `unsafe-eval` in production), deny-all CSP on API responses, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP; dev helpers never registered in production; production refuses to start with fake providers; `security.txt` with expiry check in CI. | `security/routes.test.ts`, `security/hardening.test.ts`, `e2e/tests/security.spec.ts`, `security/hardening.test.ts` (fakes refused in production) |

## Gaps and decisions

| Item | Decision |
| --- | --- |
| 3.4.4 `__Host-` cookie prefix | Not used yet. Cookies are already host-only (no `Domain`), `Path=/`, `Secure` in production. Rename to `__Host-ps_session` / `__Host-ps_ops_session` together with the first production deployment, when local development also runs on HTTPS. |
| `style-src 'unsafe-inline'` | Kept: React style attributes (progress bar) cannot carry a nonce, and a nonce in `style-src` disables `'unsafe-inline'` in browsers. Scripts stay strict. Risk: CSS injection only, no script execution. |
| Valid scanner codes are not rate-limited on page views | Accepted: the target is 10,000 scans/min; misses are limited per IP (`scan.not_found`), creating alerts is limited three ways. Load-shedding at Caddy is part of the load-test package. |
| Webhook from 360dialog authenticated by a path secret | Meta's signature header is not forwarded by the BSP; the secret is long, random, compared in constant time and never logged (the access log drops URIs). |
| External verification | The external pentest (incl. ops app) and later a private bug bounty (AD, 02-architecture §11) verify this list independently. |
