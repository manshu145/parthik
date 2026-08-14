# Parthik — Technical Architecture

**Status:** Draft for approval
**Version:** 0.1
**Authority:** [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) is the product authority. This document is the technical interpretation of it.
**Companion documents:** [`DATABASE.md`](./DATABASE.md) · [`ROUTES.md`](./ROUTES.md) · [`API_SPEC.md`](./API_SPEC.md) · [`SECURITY.md`](./SECURITY.md) · [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)

> **No application code has been written.** This document set is deliverable for TASK 001 (architecture initialization) only. Implementation starts after the decisions in [§16 Decision Register](#16-decision-register) are approved.

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

Deferred per master spec §42, and the schema must not block them: multi-city expansion, multiple stores per vendor UI, delivery slots, subscriptions, loyalty, referrals, wallet, gift cards, membership, recommendation engine, AI support, WhatsApp ordering, native apps, advanced routing, automated vendor settlement, franchise management.

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

Single repository (not a multi-package monorepo) — see [D-06](#16-decision-register).

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
| Managed host | **[D-01](#16-decision-register)** |
| ORM | **[D-02](#16-decision-register)** — leaning Drizzle for Workers fit |
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
| **Application cache** | Redis-compatible HTTP store (**[D-03](#16-decision-register)**) | Sessions, rate-limit counters, OTP attempt counters, idempotency keys, distributed locks, serviceability lookups, hot config/feature flags, cart totals memo | TTL + explicit delete on write |

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
| Stock / availability | 15–30 s or uncached | **[D-16](#16-decision-register)** affects this |
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
- Image transformation/delivery: **[D-07](#16-decision-register)**.

---

## 10. Background jobs and scheduling

| Need | Mechanism |
|---|---|
| Async fan-out (notifications, analytics forwarding, webhook retries, cache warm) | Cloudflare **Queues** producer in request path, consumer Worker |
| Scheduled work (coupon/campaign expiry, low-stock scan, payout digest, session/OTP cleanup, location-data retention purge, sitemap refresh, report rollups) | Cloudflare **Cron Triggers** |
| Immediate-but-non-blocking work | Next.js `after()` for small post-response work; anything retryable goes to the queue instead |

Job contracts live in `lib/queue/jobs.ts` as versioned, Zod-validated payloads. Every consumer is **idempotent** (queues are at-least-once). Failures retry with backoff, then land in a dead-letter queue surfaced on the admin **System Health** screen. Job runs are logged with correlation ids.

Queue choice: **[D-05](#16-decision-register)**.

---

## 11. Cross-cutting services

### 11.1 Authentication and RBAC

Summarized here, specified in [`SECURITY.md`](./SECURITY.md).

- Identity supports **phone OTP** and **email** login, matching existing behaviour.
- Sessions are **server-side records** in Postgres, cached for fast reads, referenced by an opaque signed HTTP-only cookie. Because middleware cannot reach the DB, the cookie also carries a small signed claim set (`userId`, `roles`, `sessionId`, `exp`) used **only** for coarse routing decisions; every service call revalidates against the session store.
- RBAC is **permission-based**, not role-string-based: roles are bundles of granular permissions (`order:refund`, `product:publish`, `vendor:approve`). Checks are `can(actor, permission, resource)` in the service layer.
- One user may hold multiple roles (a vendor owner who is also a customer). The active dashboard context is derived from the route and validated, never from client state.
- Auth library: **[D-08](#16-decision-register)**; password vs passwordless email: **[D-09](#16-decision-register)**; session strategy confirmation: **[D-10](#16-decision-register)**.

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

Provider selection: **[D-13](#16-decision-register)**. COD support: **[D-12](#16-decision-register)**.

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
- Providers: SMS **[D-24](#16-decision-register)**, Email **[D-25](#16-decision-register)**, Push **[D-26](#16-decision-register)**.

### 11.4 Location and serviceability

Location is a first-class subsystem (master spec §11):

- Sources: browser geolocation, manual selection, address search/autocomplete, saved addresses.
- Serviceability resolves a coordinate/pincode to a `DeliveryZone`, which determines store availability, delivery fee band and ETA.
- **Serviceability is re-verified at checkout and again at order creation**, because zones, store hours and stock change between browsing and paying.
- Driver location is stored coarsely, with a retention window and purge job, and is only exposed to the parties who operationally need it.

Zone model: **[D-17](#16-decision-register)**. Maps/geocoding provider: **[D-23](#16-decision-register)**. Location retention: **[D-29](#16-decision-register)**.

### 11.5 Orders and delivery

The order state machine from master spec §13 is implemented as an explicit transition table (allowed transitions, who may trigger each, required side effects). Illegal transitions raise `StateTransitionError`. Every transition writes an `OrderStatusHistory` row with actor, reason and timestamp. Delivery has its own parallel machine linked to the order.

Full transition tables: [`DATABASE.md` §7](./DATABASE.md). Dispatch strategy: **[D-18](#16-decision-register)**. Delivery proof: **[D-20](#16-decision-register)**.

### 11.6 Marketing, CMS and SEO

- **CMS is database-driven and admin-managed** (master spec §19). Banners, home sections and their ordering/visibility are data, not code — the homepage renders from a stored layout document. See **[D-30](#16-decision-register)**.
- Coupons and promotions are evaluated by the shared `pricing`/`promotion` engine with a declarative rule set (min cart, max discount, first-order, user/category/product/vendor scope, usage and per-user limits, expiry, zone restriction).
- SEO: dynamic `generateMetadata` per route, canonicals, `sitemap.ts`, `robots.ts`, Open Graph/Twitter cards, JSON-LD (Product, Breadcrumb, Organization/LocalBusiness), clean slugs with a `Redirect` table for slug changes, and **`noindex` on every authenticated surface** (master spec §20, §39). Details in [`ROUTES.md`](./ROUTES.md).

### 11.7 Analytics

A thin `track(event, properties)` interface with a strict allowlist of the events in master spec §36, defined once in `lib/analytics/events.ts`. Server-side emission for trustworthy commercial events (`order_created`, `payment_success`), client-side for interaction events. No PII beyond a pseudonymous id; no card/OTP/address contents ever. Provider: **[D-28](#16-decision-register)**.

### 11.8 Logging and observability

- **Structured JSON logs** with a mandatory context object: `requestId`, `route`, `actorId`, `actorRole`, plus `orderId` / `paymentId` / `deliveryId` / `vendorId` where relevant (master spec §30).
- `requestId` is generated in middleware, propagated through services and queue jobs, and returned in a response header so a support ticket can be traced end-to-end.
- **Never logged:** OTP codes, session tokens, passwords, full card data, provider secrets, full customer addresses at info level.
- **Audit log** is separate from application logs and lives in Postgres: every admin action, every permission-sensitive mutation, every order/payment state change, with actor, before/after diff, IP and user agent. Audit rows are append-only.
- Webhook log retains raw payload + signature verification result for dispute resolution.
- `GET /api/health` (liveness) and `GET /api/health/deep` (DB, cache, storage, queue depth, provider reachability) feed the admin **System Health** screen.
- Error tracking/APM: **[D-27](#16-decision-register)**.

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

## 16. Decision register

Every item below is a real fork where the master spec is silent, offers alternatives, or states a business rule that only you can set. **None has been silently chosen.** Where I have a technical recommendation I have said so and why, but nothing is implemented until you approve.

`Needed by` indicates the latest point work can proceed without it.

### A. Platform and infrastructure

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **D-01** | Managed PostgreSQL host | Neon · Supabase Postgres · AWS RDS/Aurora · PlanetScale Postgres · self-hosted | **Neon or Supabase**, both proven behind Hyperdrive. Prefer one with an ap-south (Mumbai) region for latency, plus PITR backups. Self-hosting adds ops burden with no V1 benefit. | TASK 002 (schema) |
| **D-02** | ORM | Drizzle · Prisma | **Drizzle.** Lighter on Workers, no engine/adapter indirection, SQL-transparent migrations, better cold-start profile. Prisma is more familiar and has a stronger studio/ecosystem but historically needs adapter configuration on Workers. Master spec allows either — this must be fixed before any schema code. | TASK 002 |
| **D-03** | Application cache / KV | Upstash Redis (HTTP) · Cloudflare KV + Durable Objects · managed Redis via Hyperdrive-style proxy | **Upstash Redis.** Workers cannot open arbitrary TCP; Upstash's REST API works from Workers and its rate-limit SDK covers a mandated requirement. Cloudflare KV is eventually consistent and unsuitable for rate limits, idempotency and locks. | TASK 003 (auth/sessions) |
| **D-04** | Confirm deployment target | Cloudflare Workers + OpenNext · Vercel · Node container (Fly/Render) behind Cloudflare | **Confirm Workers + OpenNext** as the spec states, with eyes open: Node Middleware is unsupported, some Node APIs are limited, and ISR/DO costs need monitoring. If you want the lowest-friction Next.js hosting and only Cloudflare DNS/WAF/R2, that is a different architecture — decide now, not in Phase 9. | Immediately (TASK 001) |
| **D-05** | Background jobs / queue | Cloudflare Queues + Cron Triggers · Upstash QStash · external worker service | **Cloudflare Queues + Cron Triggers**, colocated with the runtime, with a queue abstraction so this is swappable. | TASK 010 (orders) |
| **D-06** | Repository layout | Single repo (spec's suggested tree) · pnpm monorepo | **Single repo.** One deployable, no package-boundary overhead. Revisit only when a separate API service or native app appears. | Immediately |
| **D-07** | Image transformation/delivery | Cloudflare Images · R2 + custom Next image loader + CDN resize · `next/image` default | **Cloudflare Images** (or Image Resizing) with a custom loader — the default Next optimizer is a poor fit on Workers. Has a per-image cost implication you should see before approving. | TASK 006 (catalog) |
| **D-32** | Multiple stores per vendor in V1 | One store per vendor (simpler UI) · schema supports N, UI exposes 1 | **Schema supports N, V1 UI exposes one store per vendor.** Keeps master spec §42 open without building it. Confirm no vendor needs two locations at launch. | TASK 002 |

### B. Identity and access

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **D-08** | Auth implementation | Better Auth · Auth.js v5 · fully in-house sessions | **Better Auth** or **in-house**. We need phone-OTP as a first-class method, multi-role users, DB sessions and granular RBAC; Auth.js is optimized for OAuth providers and fits this shape least well. In-house gives total control at the cost of writing security-critical code ourselves. | TASK 003 |
| **D-09** | Email login credential | Email + password · email OTP/magic link only · both | Spec says "email login" and hedges on retaining passwords. **Recommend email + password with a strong hashing choice (argon2id/scrypt available on Workers)** only if existing users have passwords to migrate; otherwise passwordless removes a whole class of risk. Ties to **D-31**. | TASK 003 |
| **D-10** | Session strategy | Opaque DB session + cache (with a small signed claim cookie for middleware gating) · pure stateless JWT | **DB session + signed claim cookie**, as described in §11.1 — gives real server-side revocation (needed for "logout everywhere", ban, role change) while working within the middleware constraint. Confirm session lifetime and idle timeout per role (admins should be shorter). | TASK 003 |

### C. Commerce business rules — highest risk, please read carefully

These are product/finance rules, not technical preferences. Getting them wrong is expensive to unwind after launch.

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **D-11** | Multi-vendor cart | Single-vendor cart (block mixing) · multi-vendor cart that splits into one order per vendor · multi-vendor single order | **Single vendor per order in V1**, with the schema shaped so a parent order group can be added later. Splitting affects delivery fees, driver assignment, coupons, refunds, payouts and the entire order UI. This is the single most structural open question. | TASK 008 (cart) |
| **D-12** | Payment timing / COD | Prepaid only · COD only · both | Master spec's state machine starts at `PENDING_PAYMENT`, but hyperlocal India usually needs COD. **If COD is required, the state machine needs a documented entry path and drivers need cash-collection + reconciliation** — which is extra scope. Please confirm explicitly. | TASK 009 (checkout) |
| **D-13** | Payment provider for V1 | Razorpay · Cashfree · PhonePe/PayU · Stripe | **Razorpay or Cashfree** for Indian UPI/cards/netbanking coverage and refund APIs. Architecture is provider-agnostic; we still need one concrete adapter, with a merchant account and webhook secret. | TASK 011 |
| **D-14** | Tax / GST model | No tax in V1 · GST-exclusive per product with HSN · GST-inclusive display · marketplace vs vendor as seller of record | **Needs your accountant's answer, not mine.** Determines price display, invoice format, whether Parthik or the vendor issues the tax invoice, and TCS obligations. Schema will carry HSN, tax rate and per-line tax breakup regardless. | TASK 009 |
| **D-15** | Commission and payout model | Flat % per order · category-wise % · subscription · per-order fee. Plus: settlement cycle, who bears delivery fee and coupon discount | Required to compute vendor payouts and driver earnings at all. **V1 recommendation: compute and display payable amounts, settle manually outside the system**, with automated settlement deferred (master spec §42). | TASK 012 (vendor) |
| **D-16** | Inventory semantics | Reserve on order creation · decrement on vendor acceptance · decrement on delivery. Plus: allow overselling? track stock at all for some categories? | **Reserve at order creation with a short hold, release on failure/cancel.** Prevents the classic double-sell during payment. Confirm whether every product is genuinely stock-tracked. | TASK 008 |
| **D-17** | Serviceability and delivery-fee model | Pincode allowlist per zone · radius from store · polygon zones (PostGIS) · distance-based fee slabs | **V1: pincode + radius, PostGIS-ready columns.** Polygons are more accurate but need map tooling in admin. Also confirm the fee rules: current site shows free delivery above ₹199 plus a default charge — is fee flat, distance-banded, or vendor-specific? | TASK 005 (location) |
| **D-18** | Driver dispatch strategy | Manual admin assignment · auto-assign nearest available · broadcast to eligible drivers, first-accept wins | **Manual + broadcast-accept in V1**, auto-routing later. Determines whether we need continuous driver location, an assignment timeout/re-offer loop, and a fairness policy. | TASK 013 (driver) |
| **D-19** | Cancellation and refund policy | Who may cancel at which status, refund %, time windows, restocking, driver compensation | Spec says "cancel where policy permits" without defining the policy. **Needs explicit rules per status**; implementation will encode them as a table, not scattered conditionals. | TASK 010 |
| **D-20** | Delivery proof requirement | OTP always · OTP for prepaid only · photo/signature for high-value · customer tap-confirm | **OTP as default with photo fallback.** Affects the driver UI, the customer order screen, and dispute handling. | TASK 013 |

### D. Supporting services

| # | Decision | Options | Recommendation | Needed by |
|---|---|---|---|---|
| **D-21** | Product search | Postgres full-text + `pg_trgm` · Typesense/Meilisearch · Algolia | **Postgres first.** At hyperlocal catalog sizes it is sufficient, avoids a second datastore, and the search interface stays swappable behind the `catalog` module. | TASK 007 |
| **D-22** | Live order tracking transport | Client polling · SSE · Durable Object WebSockets · third-party realtime | **Polling (adaptive interval) in V1.** Simple, cheap, robust on mobile networks. Upgrade if you want true live driver-on-map tracking — which also raises D-29. | TASK 010 |
| **D-23** | Maps / geocoding / autocomplete | Google Maps Platform · Ola Maps/MapmyIndia · OSM + Nominatim/Photon · Mapbox | **Google** for Indian address-autocomplete quality, or **Ola/MapmyIndia** for cost. This is a recurring per-request cost and needs a billing decision plus key restrictions. | TASK 005 |
| **D-24** | SMS / OTP provider | MSG91 · 2Factor · Twilio · AWS SNS · Kaleyra | **An India-focused provider** (MSG91/2Factor) for transactional SMS. **Note: DLT registration of sender ID and templates is mandatory in India and takes lead time — start this early.** | TASK 003 |
| **D-25** | Email provider | Resend · AWS SES · Postmark · Brevo | **Resend** for speed of setup, **SES** for volume economics. Needs domain verification with SPF/DKIM/DMARC. | TASK 003 |
| **D-26** | Push notifications | Web Push (VAPID) · Firebase Cloud Messaging | **Web Push for the PWA in V1**, behind a flag; FCM only if native apps are planned. Note iOS Safari requires the PWA to be installed. | TASK 016 |
| **D-27** | Error tracking / APM | Sentry · Cloudflare Logpush + Baselime/observability · self-hosted GlitchTip | **Sentry** for actionable stack traces with source maps; Cloudflare-native logging alone is weaker for debugging. | TASK 001 (foundation) |
| **D-28** | Product analytics | PostHog · GA4 · Cloudflare Web Analytics · warehouse-only | **PostHog** (funnels + events matching master spec §36) or GA4 if marketing already relies on it. Also decide the consent/privacy stance. | TASK 017 |
| **D-29** | Driver location retention | Not stored · stored only during active delivery, purged after N days · full history | **Store only during active delivery, purge after a short window** (privacy-minimal per master spec §15). **You must set N** — it interacts with dispute resolution needs. | TASK 013 |
| **D-30** | CMS approach | DB-driven admin CMS (build it) · headless CMS (Sanity/Payload/Strapi) | **DB-driven admin CMS.** Spec requires admin-editable pages, banners and home layout inside the admin dashboard; a headless CMS adds a second system and auth surface. | TASK 015 |
| **D-31** | Legacy data migration scope | Nothing (fresh start) · users only · users + addresses + orders + catalog + coupons | **Needs your call**, and it drives D-09 (password hashes), URL/redirect mapping for SEO, and how much of Phase 0 audit work is real. Master spec §31 requires backup-and-verify before any of it. | Before Phase 2 |
| **D-33** | Localisation | English only · English + Hindi · English + Hindi + regional | The master spec never mentions language, so I have **assumed English-only, INR, IST** for V1. Flagging rather than deciding silently: multi-language changes the route shape (`/[locale]/…`), every CMS/product/template record, and the notification template key. **Cheap now, expensive later.** | Immediately (affects route structure in TASK 004) |

---

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
