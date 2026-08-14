# Parthik — Development Plan

**Status:** **APPROVED** · **Version:** 1.0 · **Approved:** 2026-08-14
**Depends on:** [`ARCHITECTURE.md` §16 Approved Decisions](./ARCHITECTURE.md#16-approved-decisions)

> Master spec §27 Step 1 gate is **complete**: 28 of 33 decisions approved.
>
> **Current standing instruction:** no database migrations, no application features, no production/DNS changes, no legacy data migration. TASK 001's remaining scaffold work is the next authorized step.

---

## 1. Current state

| Item | Status |
|---|---|
| GitHub repository `manshu145/parthik` | Active. `main` (production, default) · `develop` (integration) · `docs/architecture` (documentation) |
| Master specification | Committed at `docs/PARTHIK_MASTER_SPEC.md` |
| Architecture documentation | **Approved** — 28 of 33 decisions settled |
| Application code | **None written.** Correct at this stage |
| Database migrations | **None generated.** Explicitly withheld |
| Legacy data | **Not migrated, by decision (D-31).** A separate migration plan follows schema approval |
| Legacy Parthik backup | **Still not verified by me.** Master spec §31 requires source, database, media, config and DNS backups with a rehearsed restore before any replacement work. Please confirm |
| Cloudflare zone / accounts | Not yet provisioned — needed for TASK 001 completion |
| Provider accounts | Razorpay, Resend, Google Maps, Sentry, PostHog chosen; **SMS vendor pick still open (D-24a) and DLT registration has not started** |
| Production domain / DNS | **Untouched, as instructed.** No cutover activity |

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
| Next.js 16 + TypeScript strict scaffold | ✅ **Unblocked** (D-04 approved) |
| OpenNext + Wrangler config for Workers | ✅ **Unblocked** (D-04) |
| Tailwind + design tokens + shadcn/ui init | ⚠️ Needs brand input (colours, logo, typography) — or approval to propose a token set |
| **next-intl setup, `en`/`hi` message catalogs, locale middleware** | ✅ **Unblocked** (D-33) — new scope from the approval |
| ESLint (incl. import-boundary rules) + Prettier + Husky + lint-staged | ✅ Ready |
| `.env.example` + validated config module | ✅ **Unblocked** (all providers chosen except D-24a) |
| Directory structure + module boundaries | ✅ Ready |
| Drizzle setup + Hyperdrive binding + connection helper (**no schema, no migrations**) | ✅ **Unblocked** (D-01/D-02); needs provider pick D-01a for a live URL |
| Auth + RBAC **architecture placeholders only** | ⚠️ Interfaces yes; implementation blocked on **D-08** |
| Error taxonomy + structured logger | ✅ Ready |
| Sentry wiring | ✅ **Unblocked** (D-27) |
| Test setup (Vitest + Playwright) | ✅ Ready |
| README + CI pipeline | ✅ Ready |
| Typecheck, lint, production build green | Gate for closing TASK 001 |

**Exit criteria:** empty-but-real application boots, builds for the Workers target, CI is green, and no commerce feature exists yet.

### Phase 1 — Foundation
- **TASK 002 — Database schema.** All entities from [`DATABASE.md`](./DATABASE.md), **including** translation tables (D-33), cash ledger and deposits (D-12), `cancellation_policies` (D-19), inventory reservation ledger (D-16). Seeds: permissions, roles, zones + ₹199 threshold, categories with EN+HI names, notification templates EN+HI, settings, COD controls. Repository pattern with one reference module.
  ✅ **Dependencies approved** (D-01, D-02, D-11, D-16, D-17, D-33). ⚠️ Needs **D-01a** for a live database. 🔴 **Tax tables created inert — D-14 blocked.**
  🚫 **Migration generation withheld pending explicit authorization.**

### Phase 2 — Identity
- **TASK 003 — Authentication + RBAC.** Phone OTP, **email OTP fallback (no passwords — D-09)**, sessions with role-specific lifetimes (D-10), revocation, rate limiting, permission engine, `can()`/`requirePermission()`, route gating, login/signup/verify UI, security page, locale preference.
  🔴 **BLOCKED on D-08** (auth library) and **D-24a** (SMS vendor → DLT registration). D-03a needed for the cache. **This is the critical path.**

### Phase 3 — Customer core
- **TASK 004 — Customer shell + navigation.** Layouts, bottom nav, desktop header, footer, location selector shell, cart drawer shell, toasts, skeleton/empty/error/offline components, PWA manifest and app shell, **locale switcher and `/hi/` routing**. ✅ Approved. ⚠️ Confirm **D-33a** URL strategy.
- **TASK 005 — Location and serviceability.** Zones, pincodes, detection, address search, address CRUD, serviceability checks, **zone-based fee with the admin-configurable ₹199 threshold**. ✅ Approved (D-17, D-23).
- **TASK 006 — Catalog.** Categories, products, variants, images, **translation-aware reads with EN fallback**, product cards, category pages, product detail, admin/vendor catalog CRUD foundations, ISR + tag revalidation. ✅ Approved. ⚠️ **D-07a** image transformation.
- **TASK 007 — Search.** Per-locale search vectors, `pg_trgm`, suggestions, filters, sort, empty states. ✅ Approved (D-21), with the Hindi stemming limitation documented (C-2).
- **TASK 008 — Cart.** Guest + user carts, merge on login, **single-vendor enforcement (D-11)**, quantity rules, stock validation, the shared pricing engine with unit tests. ✅ Approved. 🔴 Pricing engine ships `NoTaxStrategy` — **D-14 blocked, no tax assumption**.

### Phase 4 — Commerce
- **TASK 009 — Checkout.** Address → ETA → coupon → **payment method (UPI / Card / COD)** → summary → confirm, with re-verification of serviceability, stock and price, plus **COD eligibility checks** (zone, store, max order value). ✅ Approved (D-12, D-17). 🔴 **No tax line rendered — D-14 blocked.**
- **TASK 010 — Orders.** Order creation with idempotency, **stock reservation (D-16)**, dual state-machine entry (prepaid → `PENDING_PAYMENT`, **COD → `CONFIRMED`**), status history, order list/detail/adaptive-polling tracking, **`cancellation_policies` engine**, reorder. ✅ Engine approved. ⚠️ **D-19a policy values needed.** 🚫 **No invoices — D-14.**
- **TASK 011 — Payments.** **Razorpay** adapter, intent creation, webhook verification, reconciliation job, refunds (**with `MANUAL_PAYOUT` mode for COD**), failure recovery, payment logs. ✅ Approved (D-13).
- **TASK 011b — COD cash reconciliation.** *(New scope from D-12.)* Cash ledger, driver cash-in-hand view, declare/verify deposit flow, cash limit enforcement in dispatch, variance reporting, admin reconciliation screens, aged-cash alerts. ✅ Approved.
- **TASK 012 — Coupons and promotions.** Full rule engine per master spec §18 with exhaustive unit tests, **translation-aware coupon copy**. ✅ Approved.

### Phase 5 — Vendor
- **TASK 013 — Vendor dashboard.** Application/KYC, onboarding gate, store profile and hours (**incl. per-store COD toggle**), product management incl. bulk import/export and **Hindi translation fields**, inventory, order workflow, analytics, **payouts view showing calculated-but-manually-settled amounts (D-15)**, documents, support. ✅ Approved. 🔴 **D-32** decides whether the store UI is single or multi.

### Phase 6 — Driver
- **TASK 014 — Driver dashboard.** Application/KYC, availability, **auto-nearest offer queue with timeout/expiry countdown (D-18)**, delivery flow, **mandatory OTP proof with photo/signature exception (D-20)**, **COD collection + cash screens**, earnings ledger, history. ✅ Approved. ⚠️ Dispatch timeout/attempt defaults need confirmation. ⚠️ Confirm whether the driver dashboard is fully Hindi at launch.

### Phase 7 — Admin
- **TASK 015 — Admin dashboard.** KPIs and charts, order control incl. assign/cancel/refund, customer/vendor/driver management with approval queues, catalog moderation, delivery board, zones, payments/refunds/payouts, reviews, support queue, reports, settings, roles and permissions UI, audit log viewer, system health, feature flags.
- **TASK 016 — Marketing and CMS.** Banners, campaigns, CMS pages, home layout builder, blog, redirect manager, **translation management UI + completeness dashboard**. ✅ Approved (D-30, D-33).
- **TASK 017 — Notifications.** Notification service, channel adapters, admin-editable templates **in EN + HI**, preferences, in-app centre, campaign fan-out via queues, web push. ✅ Approved (D-25 Resend, D-26 Web Push). 🔴 **D-24a** and **DLT registration in both languages**.

### Phase 8 — Growth and hardening
- **TASK 018 — SEO.** Metadata, **per-locale canonicals and `hreflang`**, bilingual sitemap, robots, JSON-LD, OG images, redirects, 404, internal linking, Lighthouse budgets. ✅ Approved.
- **TASK 019 — Analytics and observability.** PostHog event tracking, Sentry, request tracing, dashboards, alerts (**incl. cash and dispatch alerts**), health checks. ✅ Approved (D-27, D-28). ⚠️ Consent stance for PostHog needs defining.
- **TASK 020 — Testing completion.** Full unit/integration/E2E suites for the four critical journeys, concurrency tests, a11y and performance checks in CI.

### Phase 9 — Production
- **TASK 021 — Security hardening.** Complete the [`SECURITY.md` §12](./SECURITY.md) checklist incl. the COD cash and OTP items; external review if desired.
- **TASK 022 — Performance and load testing.** Verify budgets, DB indexes under realistic data volume, cache hit rates, Hyperdrive pool behaviour, **translation-join query cost**.
- **TASK 023 — Legacy data migration.** 🚫 **Deferred by D-31.** Not part of the current build. A **separate migration plan** is written and approved *after* the schema is approved, covering users, addresses, historical orders, catalog and coupons. No legacy data is touched before then.
- **TASK 024 — Cloudflare production and cutover.** Zone, WAF, R2, queues, cron, secrets, monitoring, staged DNS cutover with rollback rehearsed. 🚫 **No production or DNS configuration is being touched now, as instructed.**

### Blocked tasks — do not start

| Task | Blocked by |
|---|---|
| **TASK 003** Authentication + RBAC | **D-08** auth library · **D-24a** SMS vendor + DLT |
| Invoice generation, tax display, GST reporting *(within TASK 009/010)* | **D-14** |
| Vendor store UI shape *(within TASK 013)* | **D-32** |
| **TASK 023** Legacy migration | **D-31** — deliberately deferred |
| Migration generation *(within TASK 002)* | Standing instruction |

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
| **SMS vendor pick (D-24a) + DLT registration** | Sender ID and every transactional template pre-registered and approved — now needed in **English AND Hindi**, roughly doubling the template set. Days to weeks | **TASK 003 — blocking, start immediately** |
| **Razorpay merchant account** | KYC, business documents, live-mode activation, webhook secret | TASK 011 |
| Resend domain verification | SPF/DKIM/DMARC records plus warm-up | TASK 003 |
| Google Maps billing + key restrictions | Billing setup, quota, referrer/IP restrictions | TASK 005 |
| Cloudflare account/zone, R2, Queues | Paid plan needed for Queues and Durable Objects | TASK 001 |
| Managed Postgres provisioning (D-01a) | Provider pick, ap-south region, PITR config | TASK 002 |
| **GST/tax determination (D-14)** | **Blocking.** Needs your accountant. Gates invoices and any tax display | TASK 009/010 |
| **Hindi translation content** | Human translation of UI strings, category names and transactional templates. Not a code task — needs a translator | TASK 004/017 |
| Commission rates (D-15) | Commercial decision; needed for calculated payouts | TASK 013 |
| Cancellation/refund values (D-19a) | Business policy decision | TASK 010 |
| Legacy backup + restore rehearsal | Master spec §31 prerequisite, still unconfirmed | Before any future migration |

---

## 8. Data migration and cutover SOP

🚫 **Not active. D-31 defers all legacy migration.** This SOP is the plan to be followed *later*, after the schema is approved and a dedicated migration plan is written and signed off. Recorded here so it is not reinvented.

Per master spec §31 and §46, in order, with no step skipped:

1. Full legacy source backup, stored off the legacy host.
2. Legacy database dump, verified by a **restore test** — an unverified backup is not a backup.
3. Product image and media backup.
4. Environment/config backup.
5. DNS record export.
6. Existing URL inventory → seeds the `redirects` table so SEO survives.
7. User/order data assessment and field-by-field schema mapping.
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
| ~~Unresolved commerce decisions~~ | — | **Resolved.** D-11, D-12, D-16, D-17, D-18, D-19, D-20 approved |
| **D-14 tax still blocked** while commerce is built | Rework of totals display, invoices and possibly `order_items` if it lands after real orders exist | Tax isolated behind `TaxStrategy`; columns pre-created so unblocking is a backfill, not a migration on live financial data. **Resolve before launch, ideally before TASK 009** |
| **D-08 blocks the critical path** | TASK 003 cannot start; everything after it waits | Decide auth library now. Recommendation: in-house, since D-09 removed passwords and OAuth |
| **COD cash leakage** (new risk from D-12) | Direct financial loss, hard to detect late | Append-only ledger, per-driver cash limit gating dispatch, two-step deposit verification, variance and aged-cash alerts (§8.4 of SECURITY.md) |
| **Bilingual scope creep** (new risk from D-33) | Translation debt across every content surface; untranslated strings shipped | Capability built once, content scope explicitly bounded; completeness dashboard makes gaps visible; EN fallback guarantees nothing renders empty |
| **Hindi SMS cost and DLT workload** | Unicode SMS costs more with shorter segments; template set roughly doubles | Budget for it; register templates early; keep transactional copy short |
| **Auto-dispatch quality** (D-18) | Poor assignments, driver dissatisfaction, slow deliveries | `attempt_number` and `distance_at_offer_km` recorded so dispatch is measurable; manual fallback always available |
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

## 10. Outstanding inputs

### 🔴 Blocking — work stops without these

| Need | Blocks | Why it matters |
|---|---|---|
| **D-08** auth library: in-house or Better Auth | **TASK 003 and everything after it** | This is the critical path. My recommendation is now **in-house**, because D-09 removed passwords and there is no OAuth, leaving a library with little to contribute |
| **D-24a** MSG91 or 2Factor, then start DLT registration | TASK 003 | Longest external lead time in the project, now doubled by needing Hindi templates |
| **D-14** GST/tax from your accountant | Invoices, tax display, GST reporting | Everything else is built around it; the longer it stays open the more expensive it gets |

### ⚠️ Needed soon

| Need | Blocks |
|---|---|
| **D-01a** managed Postgres provider (Neon or Supabase, ap-south) | TASK 002 live database |
| **D-03a** cache provider (recommend Upstash) | TASK 003 |
| **D-32** one store per vendor, or many | TASK 013 vendor UI. Default proposed: schema many, UI one |
| **D-19a** cancellation/refund **values** per role × status | TASK 010 |
| **D-33a** confirm default-unprefixed locale URLs | TASK 004 |
| **D-07a** image transformation approach | TASK 006 |
| Brand direction: colours, logo, typography — or approval for me to propose tokens | TASK 001 completion |
| Dispatch defaults: offer timeout, max attempts, escalation window | TASK 014 |
| COD control values: max order value, driver cash limit, deposit grace period | TASK 011b |
| Hindi translator/resource for UI strings, categories and templates | TASK 004/017 |
| Whether the **driver dashboard** must be fully Hindi at launch | TASK 014 |
| PostHog consent stance | TASK 019 |

### Confirmations requested

1. **Clarification C-1** — auto-nearest dispatch needs the ephemeral online-driver position. Confirm the two-class location model in [`ARCHITECTURE.md` §16.7](./ARCHITECTURE.md#167-clarifications-required-by-these-approvals), or D-18 falls back to broadcast-to-zone.
2. **Clarification C-3** — while D-14 is blocked, COD deliveries hand over an order summary that is **not** a tax invoice. Confirm this is operationally acceptable.
3. **Legacy backup** — master spec §31 source/database/media/config/DNS backup with a rehearsed restore. Still unconfirmed.
4. `/orders` vs `/account/orders` consolidation (one canonical route + redirect).
5. Task numbering deviation from master spec §44.
6. Payment-data localisation obligations — confirm with Razorpay and counsel.

---

## 11. Next recommended task

**Complete TASK 001 — the application scaffold**, which is now unblocked apart from brand tokens:

Next.js 16 + TypeScript strict · OpenNext/Wrangler config for Workers · Tailwind + token structure · shadcn/ui init · next-intl with `en`/`hi` catalogs · ESLint import-boundary rules · Prettier/Husky/lint-staged · validated config module + `.env.example` · directory structure and module boundaries · Drizzle client + Hyperdrive binding (**no schema, no migrations**) · error taxonomy · structured logger · Sentry · Vitest + Playwright · CI pipeline · typecheck/lint/build green.

**Explicitly excluded from that task:** database migrations, any schema definition, any commerce feature, any auth implementation (D-08), production/DNS configuration, and legacy data.

Running TASK 001 in parallel with your D-08 and D-24a decisions keeps the critical path moving, since the scaffold does not depend on either.
