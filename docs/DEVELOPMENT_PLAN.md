# Parthik — Development Plan

**Status:** Draft for approval
**Version:** 0.1
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) and its decision register

> Master spec §27 Step 1: **do not code until requirements, navigation, flows, database entities and design system are documented.** This document set completes that gate. Implementation begins only after the decisions in [`ARCHITECTURE.md` §16](./ARCHITECTURE.md) are approved.

---

## 1. Current state

| Item | Status |
|---|---|
| GitHub repository `manshu145/parthik` | Exists, **empty** — no commits before this documentation branch |
| Master specification | Provided; being committed to `docs/PARTHIK_MASTER_SPEC.md` as required by master spec §46.7 |
| Architecture documentation | This set — awaiting approval |
| Application code | **None written.** Correct at this stage |
| Legacy Parthik backup | **Not verified by me.** Master spec §31 requires source, database, media, config and DNS backups with a rehearsed restore *before* any replacement work. Please confirm this is done |
| Cloudflare zone / accounts | Unknown — needed for Phase 1 |
| Provider accounts (payment, SMS, email, maps) | Unknown — several have lead times (see §7) |

---

## 2. Working agreement

Distilled from master spec §28 and §43. These are the rules I will hold myself to on every task.

1. TypeScript strict; no `any` without a justification comment.
2. No secrets in source. No real `.env` committed.
3. No business logic in presentation components.
4. Reuse existing components and services before writing new ones.
5. Validate every external input at the boundary.
6. Authorize server-side, every time, with no convenience bypass.
7. Schema changes only through migration tooling.
8. Every feature ships loading, empty, error, unauthorized and offline states.
9. Every mutation has explicit error handling.
10. No duplicated business logic — pricing/permissions/state transitions live in exactly one place.
11. Tests for critical workflows.
12. Update these documents when architecture changes.
13. No new dependency without justification in the PR.
14. No unrelated refactors inside feature work.
15. No deletion of existing functionality without explicit approval.
16. No mock data in production paths; no TODO placeholders for core business functionality.
17. **If the spec is silent on a business rule, stop and ask.** Do not invent it.

Before implementing any feature I will: identify the module → re-read the relevant architecture rules → inspect existing code → propose the smallest correct change → state the database/API/UI impact → implement → test → typecheck/lint/build → update docs → report changed files and remaining risks (master spec §43).

---

## 3. Task sequence

Mapped directly to master spec §44 and §41. Each task is a PR (or a small series) against `develop`.

### TASK 001 — Repository and architecture initialization  ← *documentation portion delivered*

| Deliverable | Status |
|---|---|
| Architecture documentation set | **Done (this branch)** |
| Master spec committed to `docs/` | **Done (this branch)** |
| Next.js 16 + TypeScript strict scaffold | Blocked on **[D-04]** |
| Tailwind + design tokens + shadcn/ui init | Blocked on token approval |
| ESLint (incl. import-boundary rules) + Prettier + Husky + lint-staged | Ready |
| `.env.example` + validated config module | Blocked on provider decisions |
| Directory structure + module boundaries | Ready |
| Database layer skeleton | Blocked on **[D-01]**, **[D-02]** |
| Auth + RBAC architecture placeholders | Blocked on **[D-08]** |
| Error taxonomy + structured logger | Ready |
| Test setup (Vitest + Playwright) | Ready |
| README + CI pipeline | Ready |
| Typecheck, lint, production build green | Gate for closing TASK 001 |

**Exit criteria:** empty-but-real application boots, builds for the Workers target, CI is green, and no commerce feature exists yet.

### Phase 1 — Foundation
- **TASK 002 — Database schema.** All entities from [`DATABASE.md`](./DATABASE.md), migrations, seeds (permissions, roles, zones, categories, templates, settings), repository pattern established with one reference module. *Blocked on D-01, D-02, D-11, D-14, D-16, D-17.*

### Phase 2 — Identity
- **TASK 003 — Authentication + RBAC.** Phone OTP, email login, sessions, revocation, rate limiting, permission engine, `can()`/`requirePermission()`, route gating, login/signup/verify UI, security page. *Blocked on D-03, D-08, D-09, D-10, D-24, D-25.*

### Phase 3 — Customer core
- **TASK 004 — Customer shell + navigation.** Layouts, bottom nav, desktop header, footer, location selector shell, cart drawer shell, toasts, skeleton/empty/error/offline components, PWA manifest and app shell.
- **TASK 005 — Location and serviceability.** Zones, pincodes, detection, address search, address CRUD, serviceability checks, delivery-fee resolution. *Blocked on D-17, D-23.*
- **TASK 006 — Catalog.** Categories, products, variants, images, product cards, category pages, product detail, admin/vendor catalog CRUD foundations, ISR + tag revalidation. *Blocked on D-07.*
- **TASK 007 — Search.** Indexing, search API, suggestions, filters, sort, empty states. *Blocked on D-21.*
- **TASK 008 — Cart.** Guest + user carts, merge on login, quantity rules, stock validation, the shared pricing engine with unit tests. *Blocked on D-11, D-16.*

### Phase 4 — Commerce
- **TASK 009 — Checkout.** Address → ETA → coupon → payment method → summary → confirm, with re-verification of serviceability, stock and price. *Blocked on D-12, D-14, D-17.*
- **TASK 010 — Orders.** Order creation with idempotency, state machine, status history, customer order list/detail/tracking, cancellation policy, reorder, invoices. *Blocked on D-19, D-22.*
- **TASK 011 — Payments.** Provider adapter, intent creation, webhook verification, reconciliation job, refunds, failure recovery, payment logs. *Blocked on D-13, D-12.*
- **TASK 012 — Coupons and promotions.** Full rule engine per master spec §18 with exhaustive unit tests.

### Phase 5 — Vendor
- **TASK 013 — Vendor dashboard.** Application/KYC, onboarding gate, store profile and hours, product management incl. bulk import/export, inventory, order workflow, analytics, payouts view, documents, support. *Blocked on D-15, D-32.*

### Phase 6 — Driver
- **TASK 014 — Driver dashboard.** Application/KYC, availability, assignment offers, delivery flow, proof capture, earnings ledger, history. *Blocked on D-18, D-20, D-29.*

### Phase 7 — Admin
- **TASK 015 — Admin dashboard.** KPIs and charts, order control incl. assign/cancel/refund, customer/vendor/driver management with approval queues, catalog moderation, delivery board, zones, payments/refunds/payouts, reviews, support queue, reports, settings, roles and permissions UI, audit log viewer, system health, feature flags.
- **TASK 016 — Marketing and CMS.** Banners, campaigns, CMS pages, home layout builder, blog, redirect manager. *Blocked on D-30.*
- **TASK 017 — Notifications.** Notification service, channel adapters, admin-editable templates, preferences, in-app centre, campaign fan-out via queues, web push. *Blocked on D-24, D-25, D-26.*

### Phase 8 — Growth and hardening
- **TASK 018 — SEO.** Metadata, canonicals, sitemap, robots, JSON-LD, OG images, redirects, 404, internal linking, Lighthouse budgets.
- **TASK 019 — Analytics and observability.** Event tracking, error tracking, request tracing, dashboards, alerts, health checks. *Blocked on D-27, D-28.*
- **TASK 020 — Testing completion.** Full unit/integration/E2E suites for the four critical journeys, concurrency tests, a11y and performance checks in CI.

### Phase 9 — Production
- **TASK 021 — Security hardening.** Complete the [`SECURITY.md` §12](./SECURITY.md) checklist; external review if desired.
- **TASK 022 — Performance and load testing.** Verify budgets, DB indexes under realistic data volume, cache hit rates, Hyperdrive pool behaviour.
- **TASK 023 — Data migration.** Only after schema mapping and validation. *Blocked on D-31.*
- **TASK 024 — Cloudflare production and cutover.** Zone, WAF, R2, queues, cron, secrets, monitoring, staged DNS cutover with rollback rehearsed.

> **Sequencing note.** Master spec §44 lists TASK 015 as Marketing/CMS and TASK 017 as SEO. I have kept the same content and ordering intent but numbered continuously (015 admin, 016 CMS, 017 notifications, 018 SEO) because admin must exist before CMS is manageable. Say the word if you'd rather I preserve the original numbering exactly.

**No task is started before its blocking decisions are resolved.** Where a decision arrives late, the affected task moves rather than proceeding on an assumption.

---

## 4. GitHub workflow

### Branches
```text
main       protected · production · deploy requires manual approval
develop    integration · deploys to staging
feature/*  feature/task-006-catalog
fix/*      fix/cart-quantity-rounding
chore/*    chore/upgrade-next
docs/*     docs/architecture
hotfix/*   branched from main, merged to main AND develop
```

### Protection rules for `main` and `develop`
No direct pushes · PR with at least one approval · all required checks green · branch up to date before merge · conversations resolved · linear history (squash merge) · no force push, no deletion.

### Commits
Conventional Commits: `feat(cart): recompute totals server-side on quote`. Type + scope + imperative subject. Body explains **why**. Footer references the task: `Refs: TASK-008`.

### Pull requests
Every PR must state: what changed and why · which TASK · database impact (migrations listed) · API impact (endpoints added/changed) · UI impact with screenshots for visual changes · which of the eight UX states are implemented · tests added · security considerations (new endpoint → auth test?) · docs updated · **remaining risks**.

A PR that touches money, permissions or state transitions requires an explicit reviewer sign-off on that specific logic.

---

## 5. CI/CD

### On every PR
```text
1. install (pnpm, cached)
2. typecheck            tsc --noEmit
3. lint                 eslint (incl. import-boundary rules)
4. format check         prettier --check
5. unit tests           vitest run
6. integration tests    vitest run + ephemeral Postgres
7. build                production build for the Workers target
8. migration safety     detect destructive DDL without an approval label
9. secret scan          block on any hit
10. dependency audit     block on high/critical
11. preview deploy       Cloudflare Workers preview URL
12. E2E                  Playwright against the preview
13. a11y + Lighthouse    budget thresholds on key pages
```

### On merge to `develop`
Full pipeline → migrations applied to staging → deploy to staging → smoke tests → notify.

### On merge to `main`
Full pipeline → **manual approval** → migrations applied to production (forward-only, backward-compatible per the expand/contract rule) → deploy → smoke tests → monitor error rate for a defined window → automated rollback trigger on breach.

Migrations are always deployed in a shape where the **previous** application version still works, so a code rollback never leaves the database ahead of the app in a breaking way.

---

## 6. Definition of Done

From master spec §40. A feature is not done because the UI works. Every item, every time:

- [ ] UI implemented and mobile responsive
- [ ] Client **and** server validation
- [ ] Server-side authorization with an automated denied-role test
- [ ] Database logic with migrations
- [ ] Loading state
- [ ] Empty state that explains the next action
- [ ] Error state with retry
- [ ] Unauthorized and not-found states
- [ ] Audit/event handling where required
- [ ] Analytics events where specified
- [ ] Notifications wired where specified
- [ ] Tests for critical logic
- [ ] SEO handled where relevant
- [ ] Accessibility checked (keyboard, labels, focus, contrast)
- [ ] No console errors, no TypeScript errors, no lint errors
- [ ] Production build succeeds
- [ ] Documentation updated

---

## 7. External dependencies with lead time

These are the items that will delay the project if started late, and none of them are things I can complete on my own.

| Item | Why it takes time | Needed by |
|---|---|---|
| **DLT registration for SMS** (India) | Sender ID and every transactional template must be pre-registered and approved; typically days to weeks | TASK 003 — **start now** |
| Payment gateway merchant account | KYC, business documents, activation of live mode | TASK 011 |
| Email domain verification | SPF/DKIM/DMARC DNS records plus warm-up | TASK 003 |
| Maps API billing account + key restrictions | Billing setup, quota and referrer restrictions | TASK 005 |
| Cloudflare account/zone, R2, Queues | Paid plan for Queues/Durable Objects | TASK 001 |
| Managed Postgres provisioning | Region choice, backup config | TASK 002 |
| Legacy backup + restore rehearsal | Master spec §31 prerequisite | Before any migration |
| GST/tax determination | Needs your accountant | TASK 009 |
| Commission and payout terms | Commercial decision | TASK 013 |

---

## 8. Data migration and cutover SOP

Per master spec §31 and §46, in order, with no step skipped:

1. Full legacy source backup, stored off the legacy host.
2. Legacy database dump, verified by a **restore test** — an unverified backup is not a backup.
3. Product image and media backup.
4. Environment/config backup.
5. DNS record export.
6. Existing URL inventory → seeds the `redirects` table so SEO survives.
7. User/order data assessment and field-by-field schema mapping (**[D-31]**).
8. Coupon/vendor/driver data export.
9. Dry-run migration into staging; reconcile record counts and financial totals against the legacy system.
10. Fix mapping gaps; repeat the dry run until reconciliation is exact.
11. Customer, vendor, driver, admin, payment, order and **rollback** acceptance checks on staging.
12. Production migration with a maintenance window and a tested rollback plan.
13. Staged DNS cutover with a lowered TTL beforehand.
14. Post-cutover monitoring window with defined rollback triggers.

**The old Parthik stays live and its database is not deleted until every check above passes** (master spec §31, §46 production cutover rule).

---

## 9. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Unresolved commerce decisions (D-11, D-12, D-14, D-16) | Rework across cart, checkout, orders, payouts | Resolve before TASK 008. These are the expensive ones |
| OpenNext/Workers constraint discovered late (e.g. a needed Node API, middleware limitation, ISR cost) | Late platform change | Build a thin end-to-end vertical slice on Workers in TASK 001/002 and validate before volume work |
| Hyperdrive/Postgres connection saturation under load | Production outage at peak | Load test in TASK 022; tune pool; keep queries indexed and short |
| DLT/SMS approval delay | Blocks all authentication | Start registration immediately; keep an email-OTP fallback path |
| SMS cost attack | Direct financial loss | Rate limits, Turnstile, spend alerts from day one, not after launch |
| Payment edge cases (lost webhook, partial refund, COD reconciliation) | Financial discrepancy | Reconciliation job, payment event log, integration tests for each failure mode |
| Legacy data quality worse than expected | Migration slips, bad production data | Early assessment in Phase 0; reconcile in staging before committing |
| Scope creep from master spec §42 future modules | Timeline slip | Explicit non-goals in [`ARCHITECTURE.md` §1](./ARCHITECTURE.md); new scope is a new decision |
| Single-maintainer bus factor | Continuity | These documents, plus tests and audit trails, are the handover artefact |
| ISR/Durable Object cost surprise | Unexpected bill | Monitor in staging with production-shaped traffic before cutover |

---

## 10. What I need from you to start

**Blocking TASK 001 completion (the code scaffold):**
- **[D-04]** confirm Cloudflare Workers + OpenNext as the deployment target
- **[D-01]** managed Postgres host, **[D-02]** ORM, **[D-03]** cache provider
- **[D-06]** single repo (default: yes), **[D-27]** error tracking
- Design direction input: brand colours, logo, typography preference — or approval to propose a token set for review

**Blocking Phase 2 (identity):**
- **[D-08]**, **[D-09]**, **[D-10]** auth approach and session lifetimes
- **[D-24]**, **[D-25]** SMS and email providers — **DLT registration should start today**

**Blocking Phase 3–4 (the expensive ones — please prioritise these):**
- **[D-11]** multi-vendor cart, **[D-12]** COD, **[D-14]** GST model, **[D-16]** inventory semantics, **[D-17]** zone and delivery-fee model, **[D-19]** cancellation/refund policy

**Also confirm:**
- Legacy Parthik backup is complete and a restore has been tested (master spec §31)
- **[D-31]** how much legacy data migrates
- Whether the task numbering deviation in §3 is acceptable
- Whether English-only V1 is correct (**[D-33]** localisation)
