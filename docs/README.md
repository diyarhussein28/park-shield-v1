# ParkShield — Project Documentation (SRS-PARK-DE-2026-V3)

This folder is the single source of truth for building ParkShield. It supersedes V1 and V2 entirely. If anything conflicts with older documents, these files win.

**Status:** November 2026 · **Market:** Germany, then EU · **Model:** paid annual subscriptions only

## How to use these docs

| File | Read it when you are… |
|---|---|
| [00-overview.md](00-overview.md) | New to the project, or deciding whether something is in scope |
| [01-requirements.md](01-requirements.md) | Building any feature (scanner, owner portal, notifications, ops app, support) |
| [02-architecture.md](02-architecture.md) | Designing modules, data flow, security, or infrastructure |
| [03-user-stories.md](03-user-stories.md) | Planning or implementing sprint work; checking acceptance criteria |
| [04-legal-privacy.md](04-legal-privacy.md) | Touching personal data, retention, consent, billing law, or GDPR requests |
| [05-business.md](05-business.md) | Working on pricing, plans, limits, costs, roadmap, KPIs |
| [`../db/migrations/20261109000000_schema_v3.sql`](../db/migrations/20261109000000_schema_v3.sql) | Working with the database (46 tables, PostgreSQL 18) |

## Conventions

- **Requirement IDs** are stable: `SC-` scanner, `OW-` owner, `NT-` notifications, `PA-` parking assistant, `AD-` ops/admin, `SP-` support, `US-` user stories. Reference them in commits, PRs and tests.
- **Priority:** MoSCoW (Must / Should / Could). **Phase:** 1 = MVP (Plus launch), 2 = Premium, "after G3" = Business (only if decision gate G3 passes).
- **Money:** euros. Consumer prices include 19% VAT; costs exclude VAT.
- **German UI strings** are quoted verbatim (e.g. "Ich komme") and must be used as written.
- Legal sections are an implementation plan, **not legal advice**. Final wording comes from the lawyer and DPO in Phase 0.

## Hard rules for anyone (human or AI) writing code

1. Never store raw secrets (tokens, links): store SHA-256 hashes only. The one exception is the decal code: it is also stored encrypted (`code_enc`) so decal files can be re-rendered. Lookups always use the hash.
2. Never store full scanner IP addresses, device fingerprints, or tracking cookies.
3. Sensitive fields (`*_enc`) are AES-256-GCM encrypted at the application level; lookups use `*_bidx` blind indexes.
4. No personal data in logs.
5. Every ops/admin endpoint checks a specific permission (not a role name) and writes an audit log entry, including read events.
6. Limits, channel kill switches and timeouts are read from `app_settings`, never hard-coded.
7. Anything listed under "What we will not build" in `00-overview.md` needs a written ADR before it is reconsidered.
