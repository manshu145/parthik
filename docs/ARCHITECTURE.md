# Parthik — Technical Architecture

**Status:** **APPROVED** (28 of 33 decisions) — 3 blocked, 6 open sub-items
**Version:** 1.0
**Approved:** 2026-08-14
**Authority:** [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) is the product authority. This document is the technical interpretation of it.
**Companion documents:** [`DATABASE.md`](./DATABASE.md) · [`ROUTES.md`](./ROUTES.md) · [`API_SPEC.md`](./API_SPEC.md) · [`SECURITY.md`](./SECURITY.md) · [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)

> **No application code has been written yet.** Architecture decisions are now approved — see [§16 Approved Decisions](#16-approved-decisions). Implementation may begin on tasks whose dependencies are all approved; tasks blocked by **D-08** (auth library), **D-14** (GST/tax) or **D-32** (multi-store) do not proceed. Database migrations are explicitly **not** generated yet.

---

## 1. Scope and non-goals

### In scope for V1

| Surface | Content |
|---|---|
| Public website | Home, categories, product pages, offers, legal/CMS pages, blog, vendor/driver registration |
| Customer app (PWA) | Location, catalog, search, favorites, cart, checkout, payments, orders, tracking, account, support |
| Vendor dashboard | Onboarding/KYC, store, products, inventory, orders, analytics, payouts (read-only), documents, support |
| Driver dashboard | Onboarding/KYC, availability, assignments, pickup, delivery, proof, earnings, history |
| Admin dashboard | Business KPIs, users, vendors, drivers, orders, catalog, delivery, payments, marketing, CMS, reviews, support, notifications, reports, settings, RBAC, audit logs, system health |
| Platform | Auth + RBAC, notifications, SEO, analytics events, logging/observability, testing, CI/CD |

### Explicit non-goals for V1

Deferred per master spec §42, and the schema must not block them: multi-city expansion, multiple stores per vendor UI, delivery slots, subscriptions, loyalty, referrals, wallet, gift cards, membership, recommendation engine, AI support, WhatsApp ordering, native apps, advanced routing, franchise management.

Additionally excluded from V1 by explicit approval:

| Excluded | Decision |
|---|---|
| **Automated vendor settlement** — amounts are calculated and displayed; money moves manually | D-15 |
| **Tax calculation, GST handling and tax invoices** — not implemented, not assumed | D-14 (blocked) |
| **Legacy data migration** — no legacy data is migrated; a separate plan follows schema approval | D-31 |
| **Languages beyond English and Hindi** — architecture allows them, V1 does not ship them | D-33 |
| **Multi-vendor carts and split orders** — one vendor per order | D-11 |

**Rule:** anything not described in the master spec or this document set is *not* to be invented during implementation. Where the spec is silent on a business rule, the implementation stops and asks (master spec §28.18, §43).

---

## 2. Architectural principles

1. **The database is the source of truth; the client is never trusted.** Roles, prices, discounts, stock and order state are always recomputed server-side.
2. **Layered, one direction only.** `UI → route handler / server action → service → repository → database`. A layer never calls upward and never skips a layer downward. UI components contain no business logic (master spec §28.4).
3. **Modules own their domain.** Cross-module access goes through the other module's *service* interface, never directly into its tables. This is what allows a module to be extracted into a separate API service later (master spec §5).
4. **Server-first rendering.** React Server Components by default; `"use client"` only for genuine interactivity. Public commerce pages must be indexable HTML.
5. **Every state change is explainable.** Order/delivery/payment transitions are validated against a state machine, written in a transaction with a history row, and audited.
6. **Money is never a float.** All monetary values are integer **paise** (`bigint`/`integer`) with currency `INR`. Formatting happens only at the presentation edge.
7. **Idempotency for anything that costs money.** Order creation, payment capture, refunds and webhooks are idempotent by key.
8. **Fail closed.** Missing permission, missing config, unknown state → deny and log, never "allow because it's easier".
9. **One way to do each thing.** One form stack, one validation library, one data-fetching pattern per context, one design token source.

---

## 3. System context

```text
                    Customers · Vendors · Drivers · Admins
                                    │  HTTPS
                                    ▼
                        ┌───────────────────────┐
                        │      Cloudflare        │
                        │  DNS · TLS · CDN       │
                        │  WAF · Bot · Turnstile │
                        │  Rate limiting (edge)  │
                        └───────────┬───────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │   Next.js 16 (App Router)      │
                    │   on Cloudflare Workers        │
                    │   via @opennextjs/cloudflare   │
                    │                                │
                    │  RSC · Route Handlers ·        │
                    │  Server Actions · middleware   │
                    └───┬────────┬────────┬─────────┘
                        │        │        │
        ┌───────────────┘        │        └────────────────┐
        ▼                        ▼                         ▼
┌───────────────┐      ┌──────────────────┐      ┌──────────────────┐
│  PostgreSQL   │      │  Cache / KV      │      │  Cloudflare R2   │
│  via          │      │  (Redis-compat,  │      │  product images  │
│  Hyperdrive   │      │   HTTP API)      │      │  KYC docs        │
│               │      │  sessions, rate  │      │  delivery proofs │
│  system of    │      │  limits, hot     │      │  CMS media       │
│  record       │      │  reads, locks    │      │  (private+public)│
└───────────────┘      └──────────────────┘      └──────────────────┘
                        │
                        ▼
        ┌───────────────────────────────────────────┐
        │  Cloudflare Queues (async) + Cron Triggers│
        │  notifications · order events · reports   │
        │  coupon expiry · stock checks · cleanup   │
        └──────────────────┬────────────────────────┘
                           ▼
        ┌───────────────────────────────────────────┐
        │  External providers (adapter interfaces)   │
        │  Payments · SMS/OTP · Email · Push ·      │
        │  Maps/geocoding · Error tracking ·        │
        │  Product analytics                        │
        └───────────────────────────────────────────┘
```

---

## 4. Runtime and deployment

### 4.1 Chosen platform

| Concern | Decision |
|---|---|
| Framework | Next.js **16.x** (latest stable), App Router only. No Pages Router. |
| Language | TypeScript, `strict: true`, no `any` without a written justification comment |
| Adapter | `@opennextjs/cloudflare` (OpenNext), targeting **Cloudflare Workers** |
| Next runtime | **Node.js runtime** (not Edge runtime) — required by the OpenNext Cloudflare adapter and needed for the Postgres driver |
| Build/deploy | `opennextjs-cloudflare build` / `deploy`; Wrangler is not invoked directly |
| Node version | Node 22 LTS locally and in CI, `nodejs_compat` flag enabled on the Worker |
| Package manager | pnpm, with a committed lockfile |

Sources: [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare), [Cloudflare's OpenNext adapter announcement](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/), [Next.js adapters](https://nextjs.org/nextjs-across-platforms). *Content was rephrased for compliance with licensing restrictions.*

### 4.2 Platform constraints that shape the design

These are not preferences — they are hard limits of the target runtime, and several design choices below exist only because of them.

| Constraint | Consequence for Parthik |
|---|---|
| **Node Middleware is not yet supported by the OpenNext Cloudflare adapter.** `middleware.ts` therefore runs in the constrained edge environment. | Middleware performs **coarse, stateless route gating only** — it reads a signed session cookie and redirects unauthenticated/wrong-role traffic. It must not query Postgres or the cache. Authoritative permission checks happen in the service layer on every request. See [`SECURITY.md` §4](./SECURITY.md). |
| **Workers cannot open arbitrary outbound TCP connections.** | Postgres is reached through a **Hyperdrive binding** (which provides the pooled connection and terminates the TCP side). The cache must expose an **HTTP/REST** API — a self-hosted TCP-only Redis is not directly usable. |
| Serverless request isolates, no long-lived process | No in-process job runner (BullMQ-style workers are not viable). Background work uses **Cloudflare Queues** consumers; scheduled work uses **Cron Triggers**. |
| Per-request CPU/time limits | No synchronous heavy work in the request path: report generation, bulk product import, bulk notification fan-out are all queued. |
| ISR/tag-cache state lives in Cloudflare primitives | Incremental cache in **R2**; revalidation queue / tag cache via **Durable Objects**. Note the DO-backed revalidation queue can keep a Durable Object warm and become a visible cost line — must be watched in staging before production. |

### 4.3 Environments

| Environment | Trigger | Data | Notes |
|---|---|---|---|
| `development` | local `next dev` (and `opennextjs-cloudflare preview` for runtime parity checks) | local Postgres in Docker, seeded | Providers in sandbox/mock adapter mode |
| `preview` | every PR | shared preview Postgres, non-production data | One Worker preview URL per PR; `noindex` enforced globally |
| `staging` | merge to `develop` | staging Postgres, production-shaped seed | Full provider sandbox keys, used for UAT and rollback drills |
| `production` | merge to `main`, manual approval gate | production Postgres | Domain cutover only after §41 Phase 9 checks pass |

Preview and staging must never share a database, cache namespace, R2 bucket or provider webhook endpoint with production.

---

## 5. Repository structure

Single repository (not a multi-package monorepo) — **D-06 approved**.

```text
parthik/
├── app/                          # Next.js App Router — routing + composition only
│   ├── (marketing)/              # public CMS/legal/blog pages
│   ├── (shop)/                   # public commerce: home, categories, products, search, offers
│   ├── (customer)/               # authenticated: account, cart, checkout, orders, favorites
│   ├── vendor/                   # vendor dashboard
│   ├── driver/                   # driver dashboard
│   ├── admin/                    # admin dashboard
│   ├── api/                      # route handlers (see API_SPEC.md)
│   ├── layout.tsx
│   ├── not-found.tsx
│   ├── error.tsx
│   ├── sitemap.ts
│   ├── robots.ts
│   └── manifest.ts
│
├── modules/                      # ALL business logic lives here
│   └── <domain>/
│       ├── <domain>.schema.ts     # Zod input/output contracts
│       ├── <domain>.service.ts    # business rules, orchestration, permissions
│       ├── <domain>.repository.ts # the only place that touches the DB for this domain
│       ├── <domain>.types.ts
│       ├── <domain>.policy.ts     # who may do what within this domain
│       └── __tests__/
│
├── components/
│   ├── ui/                       # shadcn/ui primitives (generated, then owned)
│   ├── forms/                    # RHF + Zod field wrappers
│   ├── commerce/                 # product card, price block, cart line, quantity stepper
│   ├── dashboard/                # data table, KPI card, chart wrappers, filters
│   ├── layout/                   # headers, bottom nav, sidebars, footers
│   └── feedback/                 # skeletons, empty, error, unauthorized, offline states
│
├── lib/
│   ├── auth/                     # session, cookie, RBAC helpers
│   ├── db/                       # client, transaction helper
│   ├── cache/                    # cache client, key registry, locks
│   ├── storage/                  # R2 adapter, signed URLs, upload validation
│   ├── queue/                    # queue producer + job contracts
│   ├── payments/                 # provider-agnostic interface + adapters
│   ├── notifications/            # channel interface + adapters + template renderer
│   ├── analytics/                # event tracker interface
│   ├── logger/                   # structured logging, request context
│   ├── errors/                   # error taxonomy
│   ├── config/                    # validated env access
│   ├── money.ts                  # paise arithmetic + formatting
│   └── utils/
│
├── db/
│   ├── schema/                   # table definitions per domain
│   ├── migrations/               # generated SQL, committed, never edited by hand
│   ├── seed/
│   └── index.ts
│
├── hooks/                        # client-side React hooks only
├── types/                        # shared/global types
├── public/                       # static assets, PWA icons, service worker
├── docs/                         # this document set
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/                      # migration, seed, backup, import/export CLIs
├── .github/workflows/
├── .env.example
├── open-next.config.ts
├── wrangler.jsonc
└── README.md
```

### 5.1 Enforced boundaries

Import rules, enforced by ESLint `no-restricted-imports` and reviewed in every PR:

| Rule | Rationale |
|---|---|
| `app/**` may import from `modules/**` (services only), `components/**`, `lib/**` | Routing composes; it does not decide |
| `app/**` must **not** import `modules/**/*.repository.ts` or `db/**` | Prevents route handlers from bypassing business rules |
| `components/**` must **not** import `modules/**` or `db/**` | Keeps UI presentational and reusable |
| `modules/<a>` must **not** import `modules/<b>/*.repository.ts` | Cross-domain access goes through services; preserves future extraction |
| `modules/**/*.repository.ts` is the only code allowed to import `db/**` | Single data-access chokepoint for indexes, tenancy filters, soft deletes |
| Nothing outside `lib/config` may read `process.env` | All config is validated once at the boundary |

### 5.2 Module inventory

`identity`, `customer`, `location`, `catalog`, `inventory`, `cart`, `pricing`, `promotion`, `order`, `payment`, `vendor`, `store`, `delivery`, `driver`, `review`, `cms`, `notification`, `support`, `analytics`, `admin`, `audit`.

`pricing` is deliberately its own module: cart totals, delivery fee, coupon evaluation and tax are one shared, unit-tested engine used identically by cart preview, checkout, order creation and admin re-quoting. Duplicating this logic is the single most likely source of financial bugs.

---

## 6. Application layers

### 6.1 Request lifecycle

```text
Request
  │
  ├─ Cloudflare edge:   WAF, bot management, edge rate limit, TLS, cache
  │
  ├─ middleware.ts:     coarse route gate from signed cookie (no DB), request-id,
  │                     security headers, locale/no-index for private areas
  │
  ├─ Route (RSC page | route handler | server action)
  │     └─ parse + validate input with Zod  → 422 on failure
  │
  ├─ Service layer:     authorize(actor, permission, resource)
  │                     load state, apply business rules,
  │                     validate state transition,
  │                     open transaction
  │
  ├─ Repository layer:  parameterized queries, tenancy scoping, soft-delete filters
  │
  ├─ Post-commit:       enqueue side effects (notifications, analytics, webhooks)
  │                     via after() / queue producer — never inside the transaction
  │
  └─ Response:          typed envelope, structured log line with request + actor + entity ids
```

### 6.2 Route Handlers vs Server Actions

Both are used, with a rule to avoid ambiguity:

| Use | For |
|---|---|
| **Server Actions** | Form-driven mutations inside our own UI where the result is a redirect or revalidation: address CRUD, cart mutation, profile update, vendor product edit, admin settings |
| **Route Handlers (`app/api/**`)** | Anything with an external or non-form caller: payment webhooks, provider callbacks, PWA/service-worker fetches, polling endpoints (order tracking, driver assignment), file upload signing, health checks, sitemap/feed generation, and any endpoint a future mobile app would need |

Both paths call the **same service functions**. A service function never knows which transport invoked it. Server Actions are treated as public HTTP endpoints for security purposes: they validate input and re-authorize (see [`SECURITY.md` §5](./SECURITY.md)).

### 6.3 Data fetching

| Context | Mechanism |
|---|---|
| Public commerce pages | RSC + `fetch`/`use cache` with tag-based revalidation; ISR where content is stable |
| Authenticated page shells | RSC reading services directly, `no-store` |
| Interactive client state (cart drawer, search-as-you-type, dashboard tables, live tracking, driver queue) | TanStack Query against route handlers |
| Mutations | Server Actions with `useActionState`, or TanStack mutations against route handlers |

TanStack Query is introduced only where client-side server state genuinely exists (master spec §4). It is not a blanket replacement for RSC data loading.

### 6.4 Error taxonomy

One error class hierarchy in `lib/errors`, mapped centrally to HTTP status and user-facing copy:

| Error | HTTP | Meaning |
|---|---|---|
| `ValidationError` | 422 | Input failed Zod validation; carries field errors |
| `AuthenticationError` | 401 | No/invalid session |
| `AuthorizationError` | 403 | Authenticated but lacks permission |
| `NotFoundError` | 404 | Missing, or hidden-by-permission (returned as 404 to avoid enumeration) |
| `ConflictError` | 409 | Version/state conflict, duplicate, idempotency replay mismatch |
| `StateTransitionError` | 409 | Illegal order/delivery/payment transition |
| `BusinessRuleError` | 400 | Rule violated: min order, unserviceable pincode, coupon ineligible, out of stock |
| `RateLimitError` | 429 | Throttled; includes `Retry-After` |
| `ProviderError` | 502 | Upstream payment/SMS/maps failure; internally retried where safe |
| `InternalError` | 500 | Unexpected; never leaks internals to the client |

Internal messages are logged; client responses carry a stable machine-readable `code` plus safe copy. Every UI surface must render the mapped state (master spec §25, §40).

---

## 7. Data layer

### 7.1 Database

PostgreSQL is the system of record. Object storage is never used as a database (master spec §32).

| Aspect | Decision |
|---|---|
| Engine | PostgreSQL 16+ |
| Connectivity | Cloudflare **Hyperdrive** binding, pooled; driver is `postgres`/`pg` over the Hyperdrive socket |
| Access pattern | Repository layer only |
| Migrations | Generated SQL files, committed, applied by CI. Never `db push` against staging/production (master spec §28.8) |
| Managed host | Managed PostgreSQL, ap-south preferred, PITR enabled (**D-01 approved**; provider pick open — D-01a) |
| ORM | **Drizzle ORM** (D-02 approved) |
| Row-Level Security | Not used in V1; tenancy is enforced in the repository layer. Rationale and revisit criteria in [`SECURITY.md` §9](./SECURITY.md) |

Full table design, enums, indexes and conventions: [`DATABASE.md`](./DATABASE.md).

### 7.2 Transaction rules

1. One business operation = one transaction. Order placement writes order, items, status history, payment intent, inventory movement and coupon usage atomically.
2. **No external I/O inside a transaction** — no SMS, no payment call, no R2 write. Side effects are enqueued after commit.
3. Concurrency control is explicit per case: `SELECT … FOR UPDATE` on the stock row for inventory, unique constraints for idempotency and coupon-per-user limits, optimistic `version` column for admin edits to orders.
4. Money-affecting operations recompute totals server-side inside the transaction from current catalog/promotion state; client-supplied totals are only ever compared, never trusted.

---

## 8. Cache strategy

Three distinct layers, deliberately separated because they fail differently.

| Layer | Technology | Contents | Invalidation |
|---|---|---|---|
| **Edge/CDN** | Cloudflare CDN | Static assets, images, immutable build output, public HTML where safe | Immutable hashed URLs; purge on deploy |
| **Next.js data/route cache** | OpenNext: R2 incremental cache + Durable Object tag cache | ISR pages, `use cache` results: CMS pages, category trees, product detail, home layout, offers | Tag-based `revalidateTag` on admin/vendor publish |
| **Application cache** | Redis-compatible **HTTP** store (D-03 approved; provider pick open — D-03a) | Sessions, rate-limit counters, OTP attempt counters, idempotency keys, distributed locks, serviceability lookups, hot config/feature flags, cart totals memo | TTL + explicit delete on write |

### 8.1 Rules

- **Never cache anything user-specific in a shared/edge cache.** Cart, account, orders and dashboards are always `Cache-Control: private, no-store`.
- **Cache keys are centrally registered** in `lib/cache/keys.ts` with an app-wide version prefix (`v1:`), so a schema change can invalidate everything by bumping the prefix.
- **The cache is never authoritative for money or stock.** Price and availability are re-read from Postgres at add-to-cart, at checkout quote and again at order creation.
- **Every cached read has a documented staleness budget.** A category tree may be minutes stale; product availability may not.
- **Degraded mode:** a cache outage must slow the app, not break it. Cache reads fall through to Postgres. The exceptions are rate limiting and idempotency, which **fail closed** — if the store is unavailable, sensitive endpoints (OTP, payment, order creation) reject rather than run unprotected.

### 8.2 Indicative TTLs (tunable)

| Data | TTL | Notes |
|---|---|---|
| CMS page / legal content | 1 h + tag purge | Published from admin |
| Home layout, banners, offers | 5 min + tag purge | Campaign-sensitive |
| Category tree | 30 min + tag purge | |
| Product detail (non-stock fields) | 10 min + tag purge | Stock rendered separately |
| Stock / availability | 15–30 s, and **uncached at checkout** | D-16 reserves stock, so availability must be authoritative at order time |
| Serviceability by pincode | 1 h | Re-verified at checkout regardless (master spec §11) |
| Session | Session lifetime | See [`SECURITY.md` §3](./SECURITY.md) |
| Feature flags / admin settings | 60 s | Fast propagation for maintenance mode |

---

## 9. Object storage (Cloudflare R2)

Two buckets, split by sensitivity — this split is what prevents a KYC document or delivery photo from ever being publicly addressable.

| Bucket | Contents | Access |
|---|---|---|
| `parthik-public` | Product images, banners, CMS media, category icons, blog images | Public read via CDN/custom domain; writes only through signed server-issued uploads |
| `parthik-private` | Vendor KYC documents, bank proofs, driver licence/RC/insurance, delivery proof photos/signatures, generated reports, bulk import files | **No public access.** Reads only via short-lived signed URLs issued after a permission check |

Rules:

- Uploads are always **server-mediated**: the client requests an upload authorization, the server validates declared MIME type and size, applies the permitted-type allowlist, and issues a scoped, short-lived credential. The server re-validates the stored object's real content type afterwards.
- Keys are structured and non-guessable: `products/{productId}/{ulid}.{ext}`, `vendors/{vendorId}/kyc/{docType}/{ulid}.{ext}`, `deliveries/{deliveryId}/proof/{ulid}.{ext}`.
- The database stores the key and metadata, never a long-lived public URL for private objects.
- Deletion is logical first (row soft-deleted), physical later via a scheduled cleanup job, so an accidental delete is recoverable.
- Storage is **Cloudflare R2** (D-07 approved). Image **transformation/optimization** is still open (D-07a).

---

## 10. Background jobs and scheduling

| Need | Mechanism |
|---|---|
| Async fan-out (notifications, analytics forwarding, webhook retries, cache warm) | Cloudflare **Queues** producer in request path, consumer Worker |
| Scheduled work (coupon/campaign expiry, low-stock scan, payout digest, session/OTP cleanup, location-data retention purge, sitemap refresh, report rollups) | Cloudflare **Cron Triggers** |
| Immediate-but-non-blocking work | Next.js `after()` for small post-response work; anything retryable goes to the queue instead |

Job contracts live in `lib/queue/jobs.ts` as versioned, Zod-validated payloads. Every consumer is **idempotent** (queues are at-least-once). Failures retry with backoff, then land in a dead-letter queue surfaced on the admin **System Health** screen. Job runs are logged with correlation ids.

Queue choice: **Cloudflare Queues + Cron Triggers** (D-05 approved).

---

## 11. Cross-cutting services

### 11.1 Authentication and RBAC

Summarized here, specified in [`SECURITY.md`](./SECURITY.md).

- Identity supports **phone OTP** and **email** login, matching existing behaviour.
- Sessions are **server-side records** in Postgres, cached for fast reads, referenced by an opaque signed HTTP-only cookie. Because middleware cannot reach the DB, the cookie also carries a small signed claim set (`userId`, `roles`, `sessionId`, `exp`) used **only** for coarse routing decisions; every service call revalidates against the session store.
- RBAC is **permission-based**, not role-string-based: roles are bundles of granular permissions (`order:refund`, `product:publish`, `vendor:approve`). Checks are `can(actor, permission, resource)` in the service layer.
- One user may hold multiple roles (a vendor owner who is also a customer). The active dashboard context is derived from the route and validated, never from client state.
- **D-09 approved: phone OTP is primary and passwords are not used in V1.** Email is a verified contact channel with optional email-OTP fallback. **D-10 approved:** customer 30 d, vendor/driver 14 d, admin 8 h with a 30-minute idle timeout.
- Auth implementation library is 🔴 **BLOCKED (D-08)**; in-house sessions are now recommended because the passwordless/OAuth-free design leaves a library little to do.

### 11.2 Payments

Provider-agnostic interface so checkout never changes when a provider does (master spec §22):

```text
PaymentProvider
  createIntent(order, amount, currency, idempotencyKey) → { providerRef, clientPayload }
  verifyWebhook(rawBody, signature, secret)            → VerifiedEvent
  fetchPaymentStatus(providerRef)                       → PaymentStatus
  refund(paymentRef, amount, idempotencyKey)            → RefundResult
  fetchRefundStatus(refundRef)                          → RefundStatus
```

Lifecycle, exactly as master spec §22 requires — the **webhook is the only trusted source of payment truth**:

```text
create order (PENDING_PAYMENT, idempotency key)
  → create payment intent (provider)
  → client completes payment
  → provider webhook received (raw body preserved)
  → verify signature + replay protection
  → mark payment PAID/FAILED (idempotent, transactional)
  → transition order CONFIRMED / PAYMENT_FAILED
  → enqueue notifications + analytics
```

Also required: a **reconciliation job** that polls provider status for payments stuck in `PENDING` past a threshold (webhooks do get lost), a `PaymentEvent` log of every raw provider interaction, and failed-payment recovery (retry link on the order).

Provider: **Razorpay** (D-13 approved). Methods: **UPI, Card and COD** (D-12 approved) — the COD flow is specified in §11.2.1.

### 11.2.1 COD (Cash on Delivery)

COD is not "a payment method option" — it is a second, parallel money path with its own state entry, its own failure modes and a physical cash custody chain. Treating it as a checkbox on checkout is how COD reconciliation goes wrong.

**Order entry path.** Prepaid orders start at `PENDING_PAYMENT` and reach `CONFIRMED` only via a verified webhook. COD orders have no upstream payment to wait for, so they are created **directly as `CONFIRMED`** in the same transaction, with a `payments` row of `method = COD`, `status = PENDING`. That payment row becomes `PAID` only when a driver confirms cash collection at delivery.

```text
PREPAID:  create order (PENDING_PAYMENT) → intent → webhook verified → CONFIRMED
COD:      create order (CONFIRMED, payment COD/PENDING) → … → delivered
                                                              → cash collected
                                                              → payment PAID
```

**Cash custody chain.** Cash physically held by a driver is a liability the platform must track, so every movement is an append-only ledger entry rather than a mutable balance:

```text
driver collects cash at delivery   → driver_cash_ledger  COLLECTION  (+)
driver deposits to office/bank     → cash_deposits (pending verification)
admin verifies the deposit         → driver_cash_ledger  DEPOSIT     (−)
shortfall / correction             → driver_cash_ledger  ADJUSTMENT  (±)

cash in hand = SUM(driver_cash_ledger.amount_paise)
```

**Controls** (all admin-configurable; **launch values need confirmation**):

| Control | Purpose |
|---|---|
| Max COD order value | Caps exposure per order |
| Driver cash-in-hand limit | A driver over the limit is **not eligible for further COD dispatch** until they deposit — this is the main protection against accumulating loss |
| COD availability per zone | Some zones may be prepaid-only |
| Deposit verification | Two-step: driver declares, admin verifies. A declared deposit is not a settled deposit |

**Interaction with delivery proof (D-20).** Delivery OTP is mandatory regardless of payment method. For COD the driver additionally confirms the collected amount; a mismatch between expected and collected is recorded rather than silently accepted, and surfaces on the admin reconciliation screen.

**Interaction with refunds.** A COD order has no captured gateway payment, so a post-delivery refund cannot be an API-initiated gateway reversal. It becomes a **manual payout** recorded against the order with its own approval trail. This is documented rather than automated in V1.

**Interaction with D-14 (blocked).** Drivers hand over an **order summary, explicitly not labelled a tax invoice** — see §16.7 C-3.

### 11.2.2 Tax handling while D-14 is blocked

Tax is **not implemented**, and deliberately not faked:

- The pricing engine exposes a `TaxStrategy` interface with one implementation, `NoTaxStrategy`, returning zero.
- Tax columns exist in the schema but stay zero/nullable. No rate is inferred from category or price.
- **No tax line renders in any customer-facing total.** Displaying "₹0 GST" would itself assert a tax treatment.
- **No invoices are generated.** Order summaries are produced instead, never labelled as tax invoices.

When D-14 is answered, a real `TaxStrategy` is added and invoice generation is built. Nothing else in checkout needs to change, which is the point of isolating it behind an interface.

### 11.3 Notifications

A single notification service; call sites emit **events**, never channel-specific calls.

```text
notify(event, recipient, context)
  → resolve NotificationTemplate(event, channel, locale)
  → check CustomerNotificationPreference / role defaults
  → render variables (strict: unknown variable = error, not blank)
  → enqueue per-channel job
  → channel adapter (SMS | Email | Push | InApp)
  → persist Notification row with delivery status + provider id
```

- Channels for V1: **SMS, Email, In-app, Web Push**. WhatsApp is an adapter slot only (master spec §21).
- Templates are **admin-editable with variables**, versioned; editing a template never requires a deploy.
- Transactional notifications (OTP, order lifecycle, payment, refund) ignore marketing opt-outs; campaign notifications respect them.
- OTP delivery is rate-limited and abuse-protected independently of the generic notification path.
- Providers: SMS **MSG91 or 2Factor** (D-24 approved, final pick open — D-24a, *urgent, gates DLT registration*), Email **Resend** (D-25), Push **Web Push/VAPID** (D-26).
- Templates are stored per `(event_key, channel, locale)` and must exist in **English and Hindi** for transactional events (D-33).

### 11.4 Location and serviceability

Location is a first-class subsystem (master spec §11):

- Sources: browser geolocation, manual selection, address search/autocomplete, saved addresses.
- Serviceability resolves a coordinate/pincode to a `DeliveryZone`, which determines store availability, delivery fee band and ETA.
- **Serviceability is re-verified at checkout and again at order creation**, because zones, store hours and stock change between browsing and paying.
- Driver location is stored coarsely, with a retention window and purge job, and is only exposed to the parties who operationally need it.

Zone model: **zone-based fee, ₹199 free-delivery threshold, admin-configurable** (D-17 approved). Maps: **Google Maps Platform, server-side proxied** (D-23 approved). Location retention: **active delivery only, purged after 7 days** (D-29 approved) — with the ephemeral online-position exception required by auto-dispatch, see §16.7 C-1.

### 11.5 Orders and delivery

The order state machine from master spec §13 is implemented as an explicit transition table (allowed transitions, who may trigger each, required side effects). Illegal transitions raise `StateTransitionError`. Every transition writes an `OrderStatusHistory` row with actor, reason and timestamp. Delivery has its own parallel machine linked to the order.

Full transition tables: [`DATABASE.md` §7](./DATABASE.md). Dispatch: **auto-nearest eligible driver with offer timeout and fallback reassignment, terminating in manual admin assignment** (D-18 approved). Proof: **delivery OTP mandatory**, photo/signature as optional exception mechanisms (D-20 approved).

### 11.6 Marketing, CMS and SEO

- **CMS is database-driven and admin-managed** (master spec §19). Banners, home sections and their ordering/visibility are data, not code — the homepage renders from a stored layout document (D-30 approved).
- Coupons and promotions are evaluated by the shared `pricing`/`promotion` engine with a declarative rule set (min cart, max discount, first-order, user/category/product/vendor scope, usage and per-user limits, expiry, zone restriction).
- SEO: dynamic `generateMetadata` per route, canonicals, `sitemap.ts`, `robots.ts`, Open Graph/Twitter cards, JSON-LD (Product, Breadcrumb, Organization/LocalBusiness), clean slugs with a `Redirect` table for slug changes, and **`noindex` on every authenticated surface** (master spec §20, §39). Details in [`ROUTES.md`](./ROUTES.md).

### 11.7 Analytics

A thin `track(event, properties)` interface with a strict allowlist of the events in master spec §36, defined once in `lib/analytics/events.ts`. Server-side emission for trustworthy commercial events (`order_created`, `payment_success`), client-side for interaction events. No PII beyond a pseudonymous id; no card/OTP/address contents ever. Provider: **PostHog** (D-28 approved).

### 11.8 Logging and observability

- **Structured JSON logs** with a mandatory context object: `requestId`, `route`, `actorId`, `actorRole`, plus `orderId` / `paymentId` / `deliveryId` / `vendorId` where relevant (master spec §30).
- `requestId` is generated in middleware, propagated through services and queue jobs, and returned in a response header so a support ticket can be traced end-to-end.
- **Never logged:** OTP codes, session tokens, passwords, full card data, provider secrets, full customer addresses at info level.
- **Audit log** is separate from application logs and lives in Postgres: every admin action, every permission-sensitive mutation, every order/payment state change, with actor, before/after diff, IP and user agent. Audit rows are append-only.
- Webhook log retains raw payload + signature verification result for dispute resolution.
- `GET /api/health` (liveness) and `GET /api/health/deep` (DB, cache, storage, queue depth, provider reachability) feed the admin **System Health** screen.
- Error tracking/APM: **Sentry** (D-27 approved), with source maps uploaded from CI.

---

## 12. Frontend architecture

### 12.1 UI system

| Concern | Decision |
|---|---|
| Styling | Tailwind CSS, configured from design tokens; no ad-hoc hex values or magic spacing in components |
| Components | shadcn/ui primitives, copied into `components/ui` and owned by us |
| Tokens | Single source in `styles/tokens.css` (CSS variables) consumed by Tailwind: colour, typography, radius, shadow, spacing, breakpoints, z-index, motion (master spec §24) |
| Forms | React Hook Form + Zod resolver, **sharing the exact schema used by the server** |
| Tables | One `DataTable` primitive with server-side pagination/sort/filter, used by all three dashboards |
| Charts | One chart wrapper, lazy-loaded, never in the initial bundle |
| Icons | One icon set |
| Toasts/dialogs | One provider each, app-wide |

**Every interactive component must implement all eight states** from master spec §25: loading (skeleton), empty (with a next action), success, error (with retry), disabled, unauthorized, not found, offline. This is part of the Definition of Done, not a follow-up task.

### 12.2 Four experiences, one component library

| Surface | Layout | Priority |
|---|---|---|
| Public/shop | Mobile-first, bottom nav (Home · Categories · Offers · Cart · Account), desktop header with location + search | SEO, first-load speed, minimal JS |
| Customer authenticated | Same shell, private, `no-store` | Correctness of price/stock/state |
| Vendor / Admin | Responsive sidebar dashboard, dense data tables | Throughput, bulk actions, safety confirmations |
| Driver | Single-column, large tap targets, one primary action per screen, works on poor networks | Reliability offline-ish, glanceability |

Favorites is reachable from Account and product cards; the bottom nav stays at five items per master spec §7.

### 12.3 PWA

Installable manifest, icons, theme/splash, **offline app shell**, and network-aware error states. The service worker caches the shell and static assets only. Checkout, payment and any authenticated mutation are explicitly **not** offline-capable (master spec §38) — they show an honest offline state. Push notifications ship behind a flag.

### 12.4 Performance budget

Public pages: server-rendered, images optimized and lazy-loaded below the fold, route-level code splitting, charts/editors/maps dynamically imported, debounced search, paginated lists everywhere, and no unbounded queries. Optimistic UI is allowed only for reversible actions (favorites, quantity) — never for payment or order state.

### 12.5 Accessibility

Semantic HTML, labelled inputs, visible focus, keyboard-operable dialogs/menus, `aria-live` for async status, alt text, colour never the sole state indicator, and adequate touch targets (master spec §26). Automated a11y checks run in CI on key pages; they supplement, not replace, manual keyboard testing.

### 12.6 Localisation (EN + HI)

**D-33 approved: English + Hindi from the beginning**, architected so further Indian languages need no structural change. Building this in from day one is far cheaper than retrofitting — every content table, route and template would otherwise need reworking.

The important distinction is **capability** (must be complete now) versus **content** (deliberately bounded for V1).

#### Locale model

| Item | Decision |
|---|---|
| Supported locales | `en` (default, fallback) · `hi` |
| Locale codes | BCP-47: `en-IN`, `hi-IN`; short form `en`/`hi` in URLs and storage |
| URL strategy | **Default-unprefixed**: `/products/x` is English, `/hi/products/x` is Hindi (D-33a — preserves legacy URL shapes and their SEO equity) |
| Resolution order | Explicit URL prefix → user preference (`users.locale`) → `locale` cookie → `Accept-Language` → `en` |
| Fallback | Per-field fallback to `en` when a translation is missing. **Never render an empty string or a raw key** |
| Formatting | `Intl` APIs with the resolved locale — currency always INR, timezone always IST |
| Library | `next-intl` (App Router support, RSC-compatible, type-safe message keys) |

#### Where translations live

Two distinct mechanisms, chosen by who authors the text:

| Content | Mechanism | Authored by |
|---|---|---|
| **UI strings** — labels, buttons, validation messages, empty/error states, email/SMS body chrome | Message catalogs in the repo (`messages/en.json`, `messages/hi.json`), type-checked | Developers |
| **Data content** — category and product names/descriptions, CMS pages, blog, banners, FAQs, notification templates | `*_translations` tables keyed `(entity_id, locale)` — see [`DATABASE.md` §10.1](./DATABASE.md) | Admins and vendors |

Translation tables, not `name_en`/`name_hi` columns: adding Marathi becomes inserting rows, not an `ALTER TABLE` plus a code change across every query.

#### V1 content scope — deliberately bounded

| Content | English | Hindi |
|---|---|---|
| UI strings | Required | **Required** |
| Transactional notification templates (OTP, order lifecycle, payment, delivery) | Required | **Required** |
| Legal/CMS pages | Required | Optional, falls back to EN |
| Category names | Required | **Required** (small, high-visibility set) |
| Product names/descriptions | Required | Optional, falls back to EN |
| Blog | Required | Not translated in V1 |
| Admin/vendor/driver dashboard chrome | Required | Optional — see below |

This is what "manageable scope" means concretely: the **customer-facing** surface is fully bilingual, while long-tail vendor-authored catalog text and editorial content fall back to English until translated. A vendor is never blocked from listing a product because they cannot write Hindi.

> **Confirm:** should the **driver** dashboard be fully Hindi at launch? Drivers are the role most likely to prefer Hindi, which argues yes; it is also a meaningful extra translation surface. I have scoped it as optional-with-fallback rather than decide for you.

#### Consequences elsewhere

- **SEO:** `hreflang` pairs on every public page, per-locale sitemap entries, correct `<html lang>`, locale-specific canonicals ([`ROUTES.md` §11](./ROUTES.md)).
- **Search:** Hindi has no Postgres stemmer — `simple` config + `pg_trgm`, see §16.7 C-2.
- **Notifications:** template lookup includes locale; SMS DLT templates must be registered **per language**, which adds to the D-24a registration workload. Hindi SMS is Unicode and costs more per message and has a shorter segment length — a real operational cost worth knowing.
- **Testing:** locale resolution and fallback are unit-tested; E2E covers one critical journey in Hindi.

---

## 13. Testing architecture

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | Pricing, delivery fee, coupon/promotion rules, tax, permission checks, order/delivery transition tables, inventory math, money utilities |
| Integration | Vitest + real Postgres (Docker/Testcontainers), transaction-rollback per test | Signup/login/OTP, cart, checkout quote, order creation + idempotency, payment webhook (incl. replay and bad signature), vendor order flow, driver delivery flow, refund, RBAC enforcement per endpoint |
| E2E | Playwright against a preview deployment | The four critical journeys from master spec §29 (customer browse→order, vendor accept→ready, driver online→delivered, admin order→assign→monitor) |
| Contract | Vitest | Provider adapters against recorded fixtures, so a provider swap is verifiable |
| A11y / perf | axe + Lighthouse CI | Key public pages, budget thresholds enforced |

Coverage is targeted, not global: the pricing, permission and state-machine modules are the ones that must be near-exhaustively tested. No mock data in production code paths (master spec §43).

---

## 14. GitHub workflow

Branches `main` (protected, production) ← `develop` (staging) ← `feature/*` / `fix/*`. Conventional Commits. Every change goes branch → code → test → PR → review → merge (master spec §27).

Required CI checks on every PR: install, typecheck, lint, format check, unit + integration tests, production build, migration-safety check, secret scan. E2E runs against the PR preview. Merge to `main` requires a green pipeline plus manual approval.

Full workflow, PR template, CI stages and release process: [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md).

---

## 15. Configuration and secrets

All configuration is read **once** through `lib/config`, validated with Zod at startup; the app refuses to boot on invalid/missing config rather than failing later at runtime. `.env.example` is committed with every key documented and no real values. Secrets live in Cloudflare Worker secrets and GitHub Actions secrets only — never in source, never in client bundles. Only `NEXT_PUBLIC_*` values are exposed to the browser, and they must contain nothing sensitive.

Baseline keys (master spec §33): `DATABASE_URL`, `HYPERDRIVE_*`, `REDIS_URL`/`CACHE_REST_URL`+token, `AUTH_SECRET`, `OTP_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`, `PAYMENT_KEY_ID`, `PAYMENT_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `R2_ACCESS_KEY`, `R2_SECRET_KEY`, `R2_BUCKET_PUBLIC`, `R2_BUCKET_PRIVATE`, `MAPS_API_KEY`, `PUBLIC_APP_URL`, `SENTRY_DSN`, `ANALYTICS_KEY`, `TURNSTILE_SECRET`.

Secret rotation procedure and least-privilege scoping: [`SECURITY.md` §11](./SECURITY.md).

---

## 16. Approved decisions

**Approval date:** 2026-08-14 · **Approved by:** Product owner · **Total:** 33 decisions — **28 approved, 2 blocked, 3 approved with an open sub-item**

This section replaces the former open decision register. It is the authoritative record: implementation follows this table, and any change to it requires a new approval and a documentation update in the same PR.

### 16.1 Platform and infrastructure — APPROVED

| # | Decision | **Approved outcome** |
|---|---|---|
| **D-01** | PostgreSQL | **Managed PostgreSQL accessed through Cloudflare Hyperdrive.** Prefer an ap-south (Mumbai) region and PITR backups. ⚠️ *Specific provider not yet named — see [§16.6](#166-open-sub-items)* |
| **D-02** | ORM | **Drizzle ORM.** All schema definitions and generated migrations use Drizzle |
| **D-03** | Cache | **HTTP-based Redis-compatible store** (Workers cannot open arbitrary TCP). Used for sessions, rate limits, OTP counters, idempotency, locks, hot config. ⚠️ *Specific provider not yet named — see [§16.6](#166-open-sub-items)* |
| **D-04** | Deployment target | **Cloudflare Workers + OpenNext** (`@opennextjs/cloudflare`), Next.js Node.js runtime. Confirms the platform constraints in [§4.2](#42-platform-constraints-that-shape-the-design) as binding |
| **D-05** | Background jobs | **Cloudflare Queues** for async work + **Cron Triggers** for scheduled work, behind a swappable queue abstraction |
| **D-06** | Repository layout | **Single GitHub repository** |
| **D-07** | Object storage | **Cloudflare R2**, two buckets (public assets / private documents) per [§9](#9-object-storage-cloudflare-r2). ⚠️ *Image **transformation/optimization** remains open — see [§16.6](#166-open-sub-items)* |

### 16.2 Identity and access

| # | Decision | **Approved outcome** |
|---|---|---|
| **D-09** | Primary authentication | **Phone OTP is the primary authentication method. Passwords are NOT required for V1.** No `password_hash` usage, no password reset flow, no credential-stuffing surface. Email becomes a verified contact channel and an optional email-OTP fallback, not a password credential |
| **D-10** | Sessions | **Role-specific session lifetimes.** Approved values: customer 30 days rolling · vendor/driver 14 days · **admin 8 hours with a 30-minute idle timeout**. Server-side revocable sessions per [`SECURITY.md` §3](./SECURITY.md) |
| **D-08** | Auth implementation library | 🔴 **BLOCKED** — see [§16.5](#165-blocked-decisions) |

### 16.3 Commerce business rules — APPROVED

| # | Decision | **Approved outcome** |
|---|---|---|
| **D-11** | Cart/order scope | **Single-vendor cart per order.** Mixing vendors in one cart is blocked with `MIXED_VENDOR_CART`. Schema keeps a future order-group parent possible but V1 does not build it |
| **D-12** | Payment methods | **UPI + Card + COD.** COD requires a distinct order-state entry path, driver cash collection, and cash reconciliation — all specified in [§11.2](#112-payments), [`DATABASE.md` §6/§8](./DATABASE.md) and [`API_SPEC.md` §6](./API_SPEC.md) |
| **D-13** | Payment provider | **Razorpay** as the V1 adapter, behind the provider-agnostic interface |
| **D-15** | Vendor settlement | **Manual settlement.** The system calculates and displays payable amounts, produces statements and payout batches, but performs **no automated money movement**. Commission rate is stored per vendor and admin-configurable |
| **D-16** | Inventory | **Reserve at order/payment initiation; release on payment failure or cancellation** per the documented rules in [`DATABASE.md` §6.1](./DATABASE.md). Reservation converts to a sale on delivery |
| **D-17** | Delivery fee | **Zone-based fee with a ₹199 free-delivery threshold** as the initial business rule, **fully admin-configurable** per zone (base fee, threshold, minimum order, per-km, cap). Serviceability by pincode + radius, PostGIS-ready |
| **D-18** | Driver dispatch | **Auto-assign to the nearest eligible driver, with an offer timeout and fallback reassignment**, terminating in manual admin assignment. ⚠️ *Interacts with D-29 — see [§16.4](#167-clarifications-required-by-these-approvals)* |
| **D-19** | Cancellation/refund | **Configurable policy engine** with distinct customer, vendor and admin permissions. ⚠️ *The default policy values are not yet set — see [§16.6](#166-open-sub-items)* |
| **D-20** | Delivery proof | **Delivery OTP is mandatory.** Photo and signature are optional exception mechanisms (OTP unavailable, disputed handover), never the primary path |
| **D-14** | GST / tax model | 🔴 **BLOCKED** — see [§16.5](#165-blocked-decisions) |

### 16.4 Supporting services — APPROVED

| # | Decision | **Approved outcome** |
|---|---|---|
| **D-21** | Search | **PostgreSQL search initially** (full-text + `pg_trgm`), behind a swappable interface. ⚠️ *Hindi has no Postgres stemmer — see [§16.4](#167-clarifications-required-by-these-approvals)* |
| **D-22** | Order tracking | **Adaptive polling** — interval widens when order state is stable, tightens when a delivery is active |
| **D-23** | Maps/geocoding | **Google Maps Platform**, called **server-side only** through our proxy so the key is never in the browser; responses cached, requests rate-limited |
| **D-24** | SMS/OTP | **MSG91 or 2Factor.** ⚠️ *One must be chosen before DLT registration can start — see [§16.6](#166-open-sub-items)* |
| **D-25** | Email | **Resend**, with SPF/DKIM/DMARC domain verification |
| **D-26** | Push | **Web Push (VAPID)** for the PWA, behind a feature flag |
| **D-27** | Error tracking | **Sentry**, with source maps uploaded from CI |
| **D-28** | Product analytics | **PostHog** |
| **D-29** | Driver location | **Retained only during an active delivery, purged after 7 days.** ⚠️ *Dispatch requires a narrow exception — see [§16.4](#167-clarifications-required-by-these-approvals)* |
| **D-30** | CMS | **Database-driven CMS** managed inside the admin dashboard |
| **D-31** | Legacy data migration | **Deferred.** No legacy data is migrated now. Foundation and schema are built first; after schema approval, a **separate legacy migration plan** covering users, addresses, historical orders, catalog and coupons is written and approved before any migration work |
| **D-33** | Localisation | **English + Hindi from the beginning** (changed from the original English-only assumption). Architecture must not block additional Indian languages. V1 translation *content* scope is deliberately bounded — see [§12.6](#126-localisation-en-hi) |
| **D-32** | Multiple stores per vendor | 🔴 **BLOCKED** (low risk) — see [§16.5](#165-blocked-decisions) |

### 16.5 Blocked decisions

Work that depends on these does not proceed. No assumption is implemented in their place.

#### 🔴 D-14 — GST / tax model · BLOCKED pending accountant confirmation

**Explicitly instructed: do not implement tax assumptions.**

How the build proceeds without it:

| Aspect | V1 behaviour while blocked |
|---|---|
| Schema | Tax columns **exist but stay nullable/zero**: `products.hsn_code`, `products.tax_rate`, `order_items.tax_rate`, `order_items.tax_amount_paise`, `orders.taxable_amount_paise`, `orders.tax_amount_paise`, `tax_rates` table |
| Pricing engine | A `TaxStrategy` interface with a single `NoTaxStrategy` implementation returning **zero**. No rate is guessed, no inclusive/exclusive assumption is coded |
| Customer UI | **No tax line is displayed.** A zero tax row is not shown as "₹0 GST", because that is itself a claim about tax treatment |
| Invoices | **Not generated.** `invoices` table and `seller_type` exist; no tax invoice is produced or emailed. Customers get an order summary, explicitly not labelled a tax invoice |
| Blocks | Invoice generation, GST reporting, TCS handling, and the final form of the checkout total breakup |

**To unblock, we need:** inclusive or exclusive pricing · per-product GST rates and HSN codes · whether Parthik or the vendor is the seller of record on the invoice · TCS/TDS obligations · invoice numbering and format requirements.

#### 🔴 D-08 — Auth implementation library · BLOCKED (not addressed in approval)

D-09 settled the *method* (phone OTP primary, no passwords) but not *what builds it*. Options remain **Better Auth** vs **fully in-house sessions**; Auth.js is effectively eliminated because the approved design has no OAuth and no passwords.

Given D-09, the surface we need is now considerably smaller — OTP issue/verify, session create/revoke, multi-role — which **strengthens the in-house case**, since a library's main value (OAuth providers, password flows, adapters) is largely unused. **My recommendation is now in-house sessions**, built on the schema already specified, with the OTP and session logic covered by the [`SECURITY.md`](./SECURITY.md) controls and integration tests.

**Blocks:** TASK 003 (Authentication + RBAC).

#### 🔴 D-32 — Multiple stores per vendor · BLOCKED (low risk, default proposed)

Not addressed in the approval. **Proposed default: schema supports N stores per vendor, V1 UI exposes exactly one.** This costs nothing now and keeps master spec §42 open. Confirm that no launch vendor operates two locations.

**Blocks:** nothing if the default is accepted. Only the vendor UI shape changes if rejected.

### 16.6 Open sub-items

Smaller items inside otherwise-approved decisions. Each has a recommendation; none blocks the immediate next task except D-24.

| Ref | Open question | Recommendation | Blocks |
|---|---|---|---|
| **D-01a** | Which managed Postgres provider | **Neon** or **Supabase**, ap-south region, PITR enabled | TASK 002 |
| **D-03a** | Which HTTP cache provider | **Upstash Redis** — REST API works from Workers, and its rate-limit SDK covers a mandated control | TASK 003 |
| **D-07a** | Image transformation/optimization. R2 is settled as *storage*; how images are **resized and served** is not | **Cloudflare Images** with a custom `next/image` loader — the default Next optimizer is a poor fit on Workers. Has a per-image cost worth seeing first | TASK 006 |
| **D-19a** | Default cancellation/refund **values** — who may cancel at which status, refund percentage per window, restocking, driver compensation. The *engine* is approved; the *numbers* are undefined | Engine ships with an admin-editable policy table; **launch values need your input**. I will not invent refund percentages | TASK 010 |
| **D-24a** | MSG91 **or** 2Factor — one must be picked | **MSG91** for broader template/campaign tooling; 2Factor is leaner if OTP is the only use. **DLT registration cannot start until this is chosen, and it gates all authentication** | TASK 003 — *urgent* |
| **D-33a** | Locale URL strategy: prefix every locale (`/en/…`, `/hi/…`) vs default-unprefixed (`/…` = English, `/hi/…` = Hindi) | **Default-unprefixed.** Preserves existing/legacy URL shapes and their SEO equity, which matters for the D-31 migration and the `redirects` table | TASK 004 |
| — | Payment-data localisation obligations under Indian regulation | Confirm with Razorpay and counsel. Not something I should assume | Before production |

### 16.7 Clarifications required by these approvals

Three approved decisions interact in ways that need an explicit resolution. I am recording my resolution rather than choosing silently — please confirm.

#### ⚠️ C-1 · D-18 (auto-nearest dispatch) vs D-29 (location only during active delivery)

**The conflict:** auto-assigning the *nearest* driver requires knowing where online drivers are **before** any delivery is assigned to them. Read literally, D-29 forbids exactly that data.

**Proposed resolution — two distinct data classes:**

| Data | Scope | Retention |
|---|---|---|
| **Current position** (single overwritten row, no history) | Drivers with availability `ONLINE`, required for dispatch | Overwritten on each ping; **deleted the moment the driver goes offline**. No trail, never queryable historically |
| **Location trail** (`delivery_status_history` coordinates, ping history) | Only while a delivery is `ASSIGNED`…`DELIVERED` | **Purged after 7 days** per D-29 |

This preserves the privacy intent — no long-term movement history of any driver — while making auto-dispatch possible. Drivers must be told their live position is used for assignment while online. **If you intend D-29 to forbid even the ephemeral online position, auto-nearest dispatch is not implementable and D-18 must fall back to broadcast-to-zone.**

#### ⚠️ C-2 · D-21 (Postgres search) vs D-33 (Hindi content)

PostgreSQL ships no Hindi stemmer or text-search configuration. Approved resolution: Hindi search uses the `simple` configuration plus `pg_trgm` trigram matching, which handles substring and fuzzy matching but **not** morphological stemming. English search uses the `english` configuration and is unaffected. Practically, Hindi product search will be adequate for short catalog names and weaker for descriptive phrases. If Hindi search quality proves insufficient, the swappable search interface allows moving to Typesense/Meilisearch (both have better multilingual support) without touching call sites.

#### ⚠️ C-3 · D-12 (COD) vs D-14 (tax blocked)

COD is approved and buildable, but COD orders often need a payment receipt at the doorstep. Since invoices are blocked by D-14, drivers deliver with an **order summary only, explicitly not a tax invoice**. Confirm this is acceptable operationally, or D-14 becomes urgent rather than merely blocking.

### 16.8 Approval traceability

| Group | Approved | Blocked | Open sub-item |
|---|---|---|---|
| Platform (D-01…D-07) | 7 | 0 | D-01a, D-03a, D-07a |
| Identity (D-08…D-10) | 2 | **D-08** | — |
| Commerce (D-11…D-20) | 9 | **D-14** | D-19a |
| Supporting (D-21…D-33) | 12 | **D-32** | D-24a, D-33a |
| **Total** | **28** | **3** | **6** |
## 17. Traceability to the master spec

| Master spec section | Where addressed |
|---|---|
| §4 Tech stack | §4, §5, §7, §12, §13 |
| §5 High-level architecture | §3, §4, §6 |
| §6 Database entities | [`DATABASE.md`](./DATABASE.md) |
| §7–§12 Customer nav, pages, home, product, location, cart/checkout | §11.4, §12.2, [`ROUTES.md`](./ROUTES.md) |
| §13 Order state machine | §11.5, [`DATABASE.md` §7](./DATABASE.md) |
| §14–§17 Vendor, driver, admin dashboards | §12.2, [`ROUTES.md`](./ROUTES.md), [`API_SPEC.md`](./API_SPEC.md) |
| §18–§19 Marketing, CMS | §11.6 |
| §20 SEO | §11.6, [`ROUTES.md`](./ROUTES.md) |
| §21 Notifications | §11.3 |
| §22 Payments | §11.2 |
| §23 Security | [`SECURITY.md`](./SECURITY.md) |
| §24–§26 Design system, UX states, a11y | §12 |
| §27–§28 SOP, Kiro rules | [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) |
| §29 Testing | §13 |
| §30 Observability | §11.8 |
| §31 Backup/migration | [`DEVELOPMENT_PLAN.md` §8](./DEVELOPMENT_PLAN.md), D-31 |
| §32–§33 Deployment, environments | §4.3, §15 |
| §34–§35 Admin settings, support | [`DATABASE.md`](./DATABASE.md), [`ROUTES.md`](./ROUTES.md) |
| §36 Analytics events | §11.7 |
| §37–§38 Performance, PWA | §12.3, §12.4 |
| §39 Route security | [`ROUTES.md`](./ROUTES.md), [`SECURITY.md`](./SECURITY.md) |
| §40–§41 DoD, build order | [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) |
| §42 Future modules | §1 non-goals, D-11/D-32 |
| §44 First execution plan | [`DEVELOPMENT_PLAN.md` §3](./DEVELOPMENT_PLAN.md) |
