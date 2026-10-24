# Parthik implementation audit — 2026-09-17

**Source of truth:** repository state through `feature/task-013-014-followups`, including open PR #14 and its stacked follow-up PR #16.

## Executive status

Parthik has a strong customer/commerce foundation and unusually good transaction-level coverage for orders, payments, fulfilment, OTP handover and COD cash custody. It is **not production-launch ready yet** because the application surfaces are incomplete and production infrastructure is deliberately not wired.

The correct continuation point is the open fulfilment stack, not `develop` directly:

1. `develop`
2. PR #14 — `feature/task-013-014-fulfilment`
3. PR #16 — `feature/task-013-014-followups`

`main` remains the production branch but is currently far behind `develop`; production promotion must happen only after the feature stack is complete and validated.

## What is genuinely implemented

### Foundation and customer commerce

- Next.js 16 / React 19 / TypeScript strict / Tailwind / next-intl.
- Cloudflare Workers target through OpenNext and Wrangler.
- PostgreSQL schema and forward migrations, exercised against PostgreSQL 16 in CI.
- Firebase phone authentication and Parthik server sessions.
- Permission-based RBAC with vendor tenant scoping and customer ownership checks.
- Location/serviceability abstraction, catalogue, bilingual search, cart, coupons, checkout and orders.
- Razorpay-compatible payment abstraction with signed webhook verification, replay protection, reconciliation and refund handling.
- Stock reservation / release / sale ledger with transactional order transitions.

### Fulfilment and COD custody

- Vendor order queue and named state-machine actions.
- Driver availability, offer list, active-delivery console and delivery steps.
- Delivery OTP hashing, attempt limits and customer regeneration path.
- COD handover transaction: delivery, order, inventory, payment and driver cash ledger move together.
- Driver cash-in-hand screen, deposit declaration, admin verification, variance handling and cash-limit enforcement.
- Customer delivery-code reveal.
- Vendor order detail is now implemented on PR #16.
- Driver delivery history is now implemented on PR #16.

## Critical / high-priority findings

### 1. Production runtime environment is not safe to promote as-is

`wrangler.jsonc` currently hard-codes `APP_ENV` to `development`. The same file is used by Wrangler deployment, so a production deploy without an explicit production environment would retain non-production behavior.

**Required before production:** create an explicit production Wrangler environment/deploy path with `APP_ENV=production`, production bindings and production secrets. Do not rely on dashboard variables that repo configuration can overwrite.

### 2. Cloudflare production resources are not wired

Hyperdrive, R2, Queues, cron triggers and the logging tail consumer are still commented placeholders in `wrangler.jsonc`.

This is acceptable for preview development but blocks real production cutover. TASK 024 must provision and bind these resources deliberately.

### 3. Stacked PRs were not running GitHub CI

The workflow only listened to PRs targeting `main` or `develop`, so PR #16 (base = feature branch) had no CI at all.

**Fixed on PR #16:** CI now runs for every pull request while push CI stays limited to `main` and `develop`.

### 4. `main` is not the current application

At audit time `develop` is 43 commits ahead of `main`, and the open fulfilment stack is further ahead of `develop`.

This is not a defect while development is ongoing, but it is a deployment/release risk. Never use `main` as evidence that the current application has shipped until the stack is merged and release validation has run.

### 5. Most operational dashboards remain placeholders

Real screens currently cover only a subset of Vendor/Driver/Admin.

**Vendor still incomplete:** onboarding/KYC, store profile/hours, product CRUD/import, inventory, categories, analytics, payouts, coupons management, documents, notifications, support and settings.

**Driver still incomplete:** onboarding/KYC, earnings, documents, profile, settings, support and the proof-exception UI. Auto-dispatch timeout/escalation is also not implemented.

**Admin:** cash reconciliation is real, but the majority of orders/customers/vendors/drivers/catalog/delivery/payments/reports/settings/RBAC/audit/system-health/CMS screens remain placeholders.

### 6. Auto-dispatch is incomplete

The self-serve eligibility set and first-accept concurrency guard exist, but D-18's timed nearest-driver offers, expiry, fallback attempts and escalation are not built.

Do not describe dispatch as fully automatic until that state machine exists.

## Data and correctness findings

### Driver-history cursor is not fully stable

`DeliveryRepository.listForDriver()` currently pages only by `createdAt`. Rows sharing the same timestamp at a page boundary can be skipped. The repository already has a shared opaque keyset cursor helper that includes an `id` tie-break and should be used here before exposing deep pagination.

The first history screen currently limits the visible history while this is repaired.

### Earnings data exists but the feature does not

The schema has an append-only `driver_earnings` ledger, but the delivery flow does not yet expose a complete repository/service/API/UI path for driver earnings. This is the next clean Driver slice after history.

### Product decisions still intentionally block features

Do not invent values for:

- **D-14** — tax/GST/invoices.
- **D-15** — settlement/payout operating rules.
- **D-19a** — cancellation/refund values beyond conservative rules.
- **D-32** — single-store vs multi-store vendor management UI.
- Dispatch timeout/attempt defaults where the spec still requires confirmation.

## Security review

### Strong controls already present

- Firebase ID-token verification is isolated and heavily tested.
- Session cookie signature verification and server-side session revalidation.
- Vendor tenancy comes from session grants, never request-supplied vendor IDs.
- Driver actions are ownership-scoped.
- Customer-owned records return not-found across ownership boundaries.
- Payment webhooks are signed, provider-bound, idempotent and replay-safe.
- COD cash is append-only and reconciled through a two-step flow.
- Delivery OTP plaintext is not persisted.
- Secrets scanner runs in CI.

### Security / operations work still required

- Production `APP_ENV` separation as described above.
- Confirm Cloudflare WAF/rate-limit configuration; repository documentation describes it but repo state cannot prove dashboard rules exist.
- Configure production Firebase, Maps, payment and database credentials through secret stores only.
- Provision private R2 before document/proof upload paths are enabled.
- Complete TASK 021 security checklist and production authorization matrix checks.
- Consider making the high-severity dependency audit blocking before release; it currently runs with `continue-on-error`.

## CI and test posture

The repository has a strong layered test setup:

- TypeScript typecheck, ESLint and Prettier.
- Unit tests.
- Next.js production build.
- OpenNext/Cloudflare build.
- Real PostgreSQL migration/query checks.
- Cart, checkout, order, payment and fulfilment/cash end-to-end shell checks.
- Desktop and mobile Playwright.
- Secret scan and dependency audit.

The important correction from this audit is that those checks must run on stacked PRs too; that trigger has now been fixed.

## Documentation drift

`docs/DEVELOPMENT_PLAN.md` still describes an older project state (for example TASK 001–011 built) even though the repository now contains TASK 011b and significant TASK 013/014 implementation.

Treat this audit plus current PRs as the current checkpoint until the main development plan is refreshed.

## Continuation plan

### Stage A — close the current fulfilment stack

1. Keep PR #14 as the fulfilment base.
2. Finish PR #16 follow-ups.
3. Make CI fully green and verify Cloudflare preview deployment.
4. Repair stable driver-history pagination.
5. Implement driver earnings from the existing append-only earnings schema.
6. Complete the remaining unblocked Driver operational screens that do not require new business rules.

### Stage B — complete Vendor operations

Implement store/onboarding gates, products, inventory, categories and documents first. Defer UI shapes that depend on D-32 and financial payout behavior that depends on D-15.

### Stage C — Admin operational core

Prioritize order control, customer/vendor/driver approval queues, delivery board, catalog moderation and system health before marketing/CMS screens.

### Stage D — notifications / observability / hardening

Build FCM + in-app notifications, analytics/Cloud Logging, full testing completion, security hardening and load/performance validation.

### Stage E — production cutover

Only after prior stages:

- explicit production Wrangler environment,
- Hyperdrive/R2/Queues/crons/tail consumer,
- production secrets,
- WAF/rate limits,
- backup/restore verification,
- staging smoke/load/security pass,
- merge/promote to `main`,
- staged DNS cutover with rollback.

## Immediate work performed during this audit

- Implemented vendor order detail.
- Fixed CI so stacked pull requests are validated.
- Implemented driver delivery-history screen without retaining historical customer PII.
- Started validating the follow-up branch through GitHub CI and Cloudflare Workers Builds.
