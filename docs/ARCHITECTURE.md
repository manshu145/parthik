# Parthik — Technical Architecture

**Status:** **APPROVED** — Google-first service strategy · 30 of 36 decisions settled
**Version:** 1.1
**Approved:** 2026-08-14 · **Revised:** 2026-08-14 (Google-first)
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
| Identity | **Firebase Authentication** (phone OTP), verified server-side via Web Crypto |
| Push | **Firebase Cloud Messaging** |
| Analytics | **Firebase Analytics + Google Analytics 4** |
| Maps | **Google Maps Platform** — Maps JS, Places, Geocoding, Routes, Route Matrix |
| Logging/monitoring | **Google Cloud Logging, Cloud Monitoring, Error Reporting** |
| Payments | **Razorpay** (retained as external — Google is not a payment gateway) |

Sources: [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare), [Cloudflare's OpenNext adapter announcement](https://blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/), [Next.js adapters](https://nextjs.org/nextjs-across-platforms). *Content was rephrased for compliance with licensing restrictions.*

### 4.2 Platform constraints that shape the design

These are not preferences — they are hard limits of the target runtime, and several design choices below exist only because of them.

| Constraint | Consequence for Parthik |
|---|---|
| **Node Middleware is not yet supported by the OpenNext Cloudflare adapter.** `middleware.ts` therefore runs in the constrained edge environment. | Middleware performs **coarse, stateless route gating only** — it reads a signed session cookie and redirects unauthenticated/wrong-role traffic. It must not query Postgres or the cache. Authoritative permission checks happen in the service layer on every request. See [`SECURITY.md` §4](./SECURITY.md). |
| **Workers cannot open arbitrary outbound TCP connections.** | Postgres is reached through a **Hyperdrive binding** (which provides the pooled connection and terminates the TCP side). The cache must expose an **HTTP/REST** API — a self-hosted TCP-only Redis is not directly usable. |
| **Firebase Admin SDK cannot run on Workers** (Node dependencies), and Firebase publishes no standard JWKS document | ID tokens are verified manually against Google's x509 certs with **Web Crypto**; privileged Firebase operations go through the **Identity Platform REST API** with a service-account-signed JWT (D-36). See [§11.1](#111-authentication-and-rbac) |
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

**Firebase Authentication owns identity; Parthik owns authorization.** That split is the whole design, and keeping it clean is what stops Firebase from becoming a dependency for every permission check.

| Concern | Owner |
|---|---|
| Credential handling, OTP generation and SMS delivery, phone verification | **Firebase Authentication** |
| User record, roles, permissions, vendor/driver scope, session lifecycle, business state | **Parthik (PostgreSQL)** |

#### Sign-in flow

```text
1. Browser  → Firebase JS SDK: signInWithPhoneNumber(+91…)
              (reCAPTCHA verifier — mandated by Firebase for web)
2. Firebase → sends OTP SMS, returns confirmationResult
3. Browser  → confirmationResult.confirm(code) → Firebase ID token (JWT, ~1 h)
4. Browser  → POST /api/v1/auth/session   { idToken }
5. Worker   → verify the ID token signature, issuer, audience and expiry
              against Google's public x509 certs (Web Crypto, cached)
6. Worker   → find or create the Parthik user by firebase_uid
              (phone comes from the verified token, never from the client)
7. Worker   → create a Parthik session row + set our signed HttpOnly cookie
8. Response → session cookie; the Firebase ID token is NOT used again
```

#### Why we exchange the Firebase token for our own session

Using Firebase ID tokens directly as the session would break four things already approved:

1. **Revocation.** D-10 requires "logout everywhere", ban and role-change to take effect immediately. Firebase ID tokens are valid for ~1 hour and cannot be invalidated mid-life without a per-request Firebase lookup.
2. **Role-specific lifetimes.** D-10 sets admin sessions to 8 hours with a 30-minute idle timeout. Firebase has no such notion.
3. **Middleware gating.** Our middleware cannot query a database ([§4.2](#42-platform-constraints-that-shape-the-design)); it reads our own signed cookie claims. Verifying a Firebase JWT on every request in middleware would mean network calls at the edge.
4. **Latency and coupling.** Firebase availability would become a hard dependency of every authenticated page load, not just of sign-in.

So Firebase is authoritative **at the moment of authentication**, and our session is authoritative thereafter. Sessions, `user_roles` and permissions work exactly as previously specified.

#### Platform constraint: the Admin SDK does not run on Workers

The Firebase Admin SDK depends on Node APIs unavailable in the Workers runtime, and Firebase does not publish a standard JWKS document. Consequences (D-36):

| Need | Approach |
|---|---|
| Verify an ID token | Fetch Google's x509 signing certs, convert to a `CryptoKey`, verify RS256 with **Web Crypto**. Certs cached in the app cache and refreshed on `max-age` |
| User lookup, disable/enable, set custom claims, bulk import | **Identity Platform REST API**, authenticated with a short-lived JWT signed from a service-account key held as a Worker secret |
| Revoke Firebase refresh tokens | REST API; combined with revoking our own session row |

We do **not** put roles in Firebase custom claims. Roles live in `user_roles` in PostgreSQL, because they are scoped (per vendor), auditable and change without touching an external system. Custom claims would be a second source of truth for authorization — exactly what §2 principle 1 forbids.

#### RBAC (unchanged)

Permission-based, not role-string-based: `can(actor, 'order:refund', resource)`. Roles bundle granular permissions; a user may hold several; the active dashboard context derives from the route and is validated server-side. See [`SECURITY.md` §5](./SECURITY.md).

#### Identity consequences to be aware of

- **Phone-only sign-in in V1.** Email OTP would need email delivery, which is blocked (D-25).
- **OTP message content is Google's.** We cannot set sender ID, wording, or reliably the language — a real loss versus a DLT-registered template, and it interacts with the bilingual requirement (D-33): the OTP SMS itself will not be reliably Hindi.
- **Firebase Phone Auth SMS is billed per verification** through Identity Platform pricing once past the free tier. Abuse protection (§11.1 rate limits, reCAPTCHA, App Check) protects a real cost, not just a queue.
- **Legacy migration (D-31)** will require importing existing users into Firebase via the REST bulk-import path, keyed on phone number, before their Parthik rows can authenticate.

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

- Channels for V1: **FCM push and In-app only.** 🔴 **Email is blocked (D-25) and non-OTP SMS is blocked (D-34)** — both ship as interfaces with no adapter. WhatsApp remains an adapter slot only (master spec §21).
- **Consequence worth stating plainly:** with email and SMS both unavailable, a customer who declines push permission receives **no proactive order notification**. In-app is the only guaranteed surface. This is a product decision to confirm, not merely a technical gap.
- **OTP is no longer a notification-service concern** — Firebase delivers login OTP directly (D-24). The notification service handles **delivery OTP** (D-20) and order lifecycle events only.
- Templates are **admin-editable with variables**, versioned; editing a template never requires a deploy.
- Transactional notifications (OTP, order lifecycle, payment, refund) ignore marketing opt-outs; campaign notifications respect them.
- OTP delivery is rate-limited and abuse-protected independently of the generic notification path.
- Providers: Push **Firebase Cloud Messaging** (D-26). Login OTP **Firebase Phone Auth** (D-24). Email 🔴 **blocked** (D-25). Non-OTP SMS 🔴 **blocked** (D-34).
- Templates are stored per `(event_key, channel, locale)` and must exist in **English and Hindi** for transactional events (D-33).

### 11.4 Location and serviceability

Location is a first-class subsystem (master spec §11):

- Sources: **browser Geolocation API** for detection, **Google Places Autocomplete** for address search, **Google Geocoding** for coordinate↔address resolution, manual selection, saved addresses.
- **Google Routes API** provides road distance and ETA for distance-based delivery fees and delivery estimates; **Route Matrix** ranks candidate drivers for auto-nearest dispatch (D-18).
- Serviceability resolves a coordinate/pincode to a `DeliveryZone`, which determines store availability, delivery fee band and ETA.
- **Serviceability is re-verified at checkout and again at order creation**, because zones, store hours and stock change between browsing and paying.
- Driver location is stored coarsely, with a retention window and purge job, and is only exposed to the parties who operationally need it.

Zone model: **zone-based fee, ₹199 free-delivery threshold, admin-configurable** (D-17 approved).

**Google Maps Platform is the only maps provider (D-23).** API usage discipline, because these are metered per request:

| API | Use | Cost control |
|---|---|---|
| Maps JavaScript | Map display, address pin | Client-side, restricted key by HTTP referrer |
| **Places** Autocomplete | Address search | **Session tokens** to bill as one session rather than per keystroke; debounced client-side |
| **Geocoding** | Pincode/coordinate resolution, address validation on save | **Server-side proxied**, results cached (addresses rarely move) |
| **Routes** | Delivery distance, ETA | Server-side, cached per store↔zone pair |
| **Route Matrix** | Rank drivers for dispatch | **Haversine pre-filter to the top N candidates first**, then one Matrix call — never a Matrix call across every online driver |

Server-side keys never reach the browser; the browser key is referrer-restricted and separate. Location retention: **active delivery only, purged after 7 days** (D-29 approved) — with the ephemeral online-position exception required by auto-dispatch, see §16.7 C-1.

### 11.5 Orders and delivery

The order state machine from master spec §13 is implemented as an explicit transition table (allowed transitions, who may trigger each, required side effects). Illegal transitions raise `StateTransitionError`. Every transition writes an `OrderStatusHistory` row with actor, reason and timestamp. Delivery has its own parallel machine linked to the order.

Full transition tables: [`DATABASE.md` §7](./DATABASE.md). Dispatch: **auto-nearest eligible driver with offer timeout and fallback reassignment, terminating in manual admin assignment** (D-18 approved). Proof: **delivery OTP mandatory**, photo/signature as optional exception mechanisms (D-20 approved).

### 11.6 Marketing, CMS and SEO

- **CMS is database-driven and admin-managed** (master spec §19). Banners, home sections and their ordering/visibility are data, not code — the homepage renders from a stored layout document (D-30 approved).
- Coupons and promotions are evaluated by the shared `pricing`/`promotion` engine with a declarative rule set (min cart, max discount, first-order, user/category/product/vendor scope, usage and per-user limits, expiry, zone restriction).
- SEO: dynamic `generateMetadata` per route, canonicals, `sitemap.ts`, `robots.ts`, Open Graph/Twitter cards, JSON-LD (Product, Breadcrumb, Organization/LocalBusiness), clean slugs with a `Redirect` table for slug changes, and **`noindex` on every authenticated surface** (master spec §20, §39). Details in [`ROUTES.md`](./ROUTES.md).

### 11.7 Analytics

**Firebase Analytics + Google Analytics 4** (D-28). On web these are effectively the same pipeline, configured once. A thin `track(event, properties)` interface in `lib/analytics/` keeps call sites provider-agnostic, with the strict event allowlist from master spec §36.

| Event class | Emission |
|---|---|
| Interaction (`page_view`, `search`, `product_view`, `add_to_cart`, `location_selected`) | Client-side via the GA4/Firebase SDK |
| Commercial truth (`order_created`, `payment_success`, `order_delivered`, `order_cancelled`) | **Server-side via the GA4 Measurement Protocol**, so an ad-blocker or a closed tab cannot lose a conversion |

**The important architectural point: GA4 is not the source of business truth.** The admin dashboard KPIs from master spec §16 — GMV, net sales, AOV, cancellation rate, refund value, delivery success rate — are computed from **PostgreSQL**, which is authoritative, unsampled and reconcilable with payments. GA4 is for marketing attribution and behavioural funnels only.

This is why dropping PostHog costs relatively little: the numbers the business runs on were never going to come from a client-side analytics tool.

**BigQuery is kept future-ready, not built:** GA4 has a native BigQuery export, and a Postgres→BigQuery path can be added later for blended product/operational analysis. No BigQuery dependency exists in V1.

Privacy is unchanged: pseudonymous ids only, no PII, no card/OTP/address contents in any event (master spec §36). Consent handling must be defined before launch since GA4 sets cookies.

### 11.8 Logging and observability

- **Structured JSON logs** with a mandatory context object: `requestId`, `route`, `actorId`, `actorRole`, plus `orderId` / `paymentId` / `deliveryId` / `vendorId` where relevant (master spec §30).
- `requestId` is generated in middleware, propagated through services and queue jobs, and returned in a response header so a support ticket can be traced end-to-end.
- **Never logged:** OTP codes, session tokens, passwords, full card data, provider secrets, full customer addresses at info level.
- **Audit log** is separate from application logs and lives in Postgres: every admin action, every permission-sensitive mutation, every order/payment state change, with actor, before/after diff, IP and user agent. Audit rows are append-only.
- Webhook log retains raw payload + signature verification result for dispute resolution.
- `GET /api/health` (liveness) and `GET /api/health/deep` (DB, cache, storage, queue depth, provider reachability) feed the admin **System Health** screen.
- **Google Cloud Logging + Cloud Monitoring + Error Reporting** (D-27). Workers do not write to Cloud Logging natively, so logs are shipped by a **tail consumer Worker** posting structured entries to the Cloud Logging API (with Cloudflare Logpush to GCS/BigQuery as the bulk/archive path). Errors formatted to Error Reporting's expected structure get grouped automatically, and Cloud Monitoring owns the alert policies in §11.8.
- 🔴 **Known gap (D-27a): browser-side error tracking.** Cloud Monitoring covers the server well but gives no source-mapped JavaScript stack traces from customers' devices, and **Crashlytics is mobile-only — it does not cover web**. Interim approach: a `/api/v1/client-errors` endpoint forwarding to Cloud Logging **without symbolication**. This is the one capability genuinely missing from the Google toolchain, flagged per your "unless demonstrated unavailable" instruction.

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

Installable manifest, icons, theme/splash, **offline app shell**, and network-aware error states. The service worker caches the shell and static assets only. Checkout, payment and any authenticated mutation are explicitly **not** offline-capable (master spec §38) — they show an honest offline state.

**FCM integration detail:** Firebase Messaging expects a `firebase-messaging-sw.js` service worker, which would collide with our PWA service worker if both registered at the scope root. We register **one** service worker and pull the Firebase messaging logic into it via `importScripts`, so there is a single worker owning caching and push. Push ships behind a feature flag. iOS delivers web push only for an **installed** PWA, so push cannot be assumed available — which matters more now that it is the primary outbound channel (D-25/D-34 blocked).

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

Baseline keys (master spec §33), revised for the Google-first strategy:

```text
# Core
DATABASE_URL / HYPERDRIVE_*          PUBLIC_APP_URL
AUTH_SECRET                          CACHE_REST_URL / CACHE_REST_TOKEN

# Firebase — client (safe to expose)
NEXT_PUBLIC_FIREBASE_API_KEY         NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN
NEXT_PUBLIC_FIREBASE_PROJECT_ID      NEXT_PUBLIC_FIREBASE_APP_ID
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID
NEXT_PUBLIC_FCM_VAPID_KEY            NEXT_PUBLIC_RECAPTCHA_SITE_KEY

# Firebase / Google Cloud — server (secret)
FIREBASE_PROJECT_ID                  FIREBASE_SERVICE_ACCOUNT_EMAIL
FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY   # signs JWTs for Identity Platform + FCM
GCP_PROJECT_ID                       GCP_LOGGING_SERVICE_ACCOUNT_KEY

# Google Maps Platform
NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY  # referrer-restricted, display only
GOOGLE_MAPS_SERVER_KEY               # IP-restricted: Places, Geocoding, Routes

# Analytics
NEXT_PUBLIC_GA4_MEASUREMENT_ID       GA4_API_SECRET   # Measurement Protocol

# Payments (external, retained)
RAZORPAY_KEY_ID  RAZORPAY_KEY_SECRET  RAZORPAY_WEBHOOK_SECRET

# Storage + abuse protection
R2_ACCESS_KEY  R2_SECRET_KEY  R2_BUCKET_PUBLIC  R2_BUCKET_PRIVATE
TURNSTILE_SECRET
```

> **Removed:** `OTP_PROVIDER_KEY`, `EMAIL_PROVIDER_KEY`, `SENTRY_DSN`, `POSTHOG_KEY`.
> **Note:** `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` is now the single most sensitive secret in the system — it can mint credentials for any user. It is scoped to the minimum IAM roles needed and rotated on the documented schedule ([`SECURITY.md` §9.1](./SECURITY.md)).

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
| **D-08** | Auth implementation | ✅ **RESOLVED — Firebase Authentication.** Was the critical-path blocker. Firebase owns credential handling and OTP delivery; **Parthik owns RBAC, permissions and all authorization** |
| **D-09** | Primary authentication | **Firebase Phone Authentication is the primary method. No passwords in V1.** No `password_hash`, no reset flow, no credential-stuffing surface. ⚠️ *Email-OTP fallback is now unavailable because email is blocked (D-25) — V1 is **phone-only sign-in*** |
| **D-10** | Sessions | **Firebase ID token is exchanged for a Parthik session.** Role-specific lifetimes retained: customer 30 d rolling · vendor/driver 14 d · **admin 8 h with 30-min idle**. Server-side revocable sessions per [`SECURITY.md` §3](./SECURITY.md). See [§11.1](#111-authentication-and-rbac) for why we do not use Firebase tokens directly as our session |
| **D-36** | Firebase admin operations on Workers | **Identity Platform REST API called from the Worker with a service-account-signed JWT.** The Firebase **Admin SDK cannot run on Workers** (Node dependencies), so user lookup, custom claims and bulk import go through REST rather than the SDK |

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
| **D-21** | Search | **PostgreSQL search initially** (full-text + `pg_trgm`), behind a swappable interface. ⚠️ *Hindi has no Postgres stemmer — see [§16.7](#167-clarifications-required-by-these-approvals)* |
| **D-22** | Order tracking | **Adaptive polling** — interval widens when order state is stable, tightens when a delivery is active |
| **D-23** | Maps/geocoding/routing | **Google Maps Platform only** — Maps JS, **Places** (autocomplete), **Geocoding**, **Routes**, **Route Matrix**. Browser Geolocation for detection. Billable APIs are **server-side proxied**; no other maps provider is introduced |
| **D-24** | OTP delivery | **Firebase Phone Authentication.** ✅ *MSG91 and 2Factor removed.* **We no longer register DLT templates for OTP** — Google operates that delivery path. ⚠️ *We also lose control of OTP sender ID, wording and language* |
| **D-25** | Transactional email | 🔴 **BLOCKED** — see [§16.5](#165-blocked-decisions). **Google operates no first-party transactional email service** |
| **D-26** | Push | **Firebase Cloud Messaging (FCM)** for web push, behind a feature flag. ✅ *Raw Web Push/VAPID replaced* |
| **D-27** | Logging & monitoring | **Google Cloud Logging + Cloud Monitoring + Error Reporting.** ✅ *Sentry removed from V1.* ⚠️ *Browser-side error tracking is a genuine capability gap — see [§16.6](#166-open-sub-items) D-27a* |
| **D-28** | Analytics | **Firebase Analytics + Google Analytics 4**, with **BigQuery export kept future-ready**. ✅ *PostHog removed.* Business KPIs come from **PostgreSQL, not GA4** — see [§11.7](#117-analytics) |
| **D-34** | Non-OTP transactional SMS | 🔴 **BLOCKED** — see [§16.5](#165-blocked-decisions). Firebase covers **OTP only**; order-lifecycle SMS has no Google-native path |
| **D-35** | Bot/abuse protection | **reCAPTCHA (Firebase-mandated for Phone Auth) + Cloudflare Turnstile for non-auth forms.** ⚠️ *Two systems — consolidation option in [§16.6](#166-open-sub-items)* |
| **D-29** | Driver location | **Retained only during an active delivery, purged after 7 days.** ⚠️ *Dispatch requires a narrow exception — see [§16.7](#167-clarifications-required-by-these-approvals)* |
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

#### 🔴 D-25 — Transactional email · BLOCKED (by instruction)

**Finding: Google operates no first-party transactional email service.** Google Cloud's own guidance for sending mail from GCP points at **third-party partners** (SendGrid, Mailgun, Mailjet). The App Engine Mail API is a legacy bundled service, and Gmail/Workspace SMTP relay is built for human correspondence with sending limits and terms that make it unsuitable as a transactional channel. Sources: [Sending email from an instance](https://docs.cloud.google.com/compute/docs/tutorials/sending-mail). *Content was rephrased for compliance with licensing restrictions.*

So a Google-native answer does not exist. The realistic outcome is a third-party provider chosen later, or no email in V1.

**What is affected while blocked:**

| Capability | Status |
|---|---|
| Email OTP fallback sign-in | **Not available.** V1 sign-in is **phone-only** |
| Order confirmation / status emails | Not sent. Push (FCM) + in-app carry order notifications |
| Invoice email | Already blocked by D-14 anyway |
| Vendor/driver onboarding and KYC-status email | Not sent; in-app + push only |
| Support ticket reply notification | In-app + push only |
| Admin alerts | Routed through Cloud Monitoring alerting, not email templates |

The notification service ships with an `EmailChannel` **interface and no adapter**, so adding a provider later is a single implementation and template set — not a redesign. `users.email` is still captured and verifiable for future use.

**Risk to note:** with email blocked and non-OTP SMS blocked (D-34), **push and in-app become the only outbound customer channels.** Push requires notification permission, which a large share of users decline, and iOS requires an installed PWA. Practically, some customers will receive **no** order-status notification at all in V1. That is a product consequence, not just a technical one.

#### 🔴 D-34 — Non-OTP transactional SMS · BLOCKED (new, created by this change)

Firebase Phone Authentication delivers **OTP messages only**. It is not a general-purpose SMS API, so it cannot send "order confirmed", "out for delivery" or "driver assigned".

There is **no Google-native transactional SMS product**. The options are:

| Option | Consequence |
|---|---|
| **No non-OTP SMS in V1** *(recommended given the Google-first strategy)* | Order updates rely on FCM push + in-app. Simplest, cheapest, no DLT work |
| Add a third-party SMS provider for non-OTP only | Reintroduces an external dependency **and our own DLT registration**, now for order templates in **English and Hindi** |

**Important:** [DLT registration is mandatory for all commercial SMS to Indian numbers](https://www.smscountry.com/blog/dlt-registration/), so choosing to send order-status SMS means doing the full DLT process ourselves — sender ID, per-template approval, and template variables. Using Firebase for OTP removes that burden **only if we send no other SMS**. *Content was rephrased for compliance with licensing restrictions.*

#### 🔴 D-32 — Multiple stores per vendor · BLOCKED (low risk, default proposed)

Not addressed in the approval. **Proposed default: schema supports N stores per vendor, V1 UI exposes exactly one.** This costs nothing now and keeps master spec §42 open. Confirm that no launch vendor operates two locations.

**Blocks:** nothing if the default is accepted. Only the vendor UI shape changes if rejected.

### 16.6 Open sub-items

Smaller items inside otherwise-approved decisions. Each has a recommendation; none blocks the immediate next task except D-24.

| Ref | Open question | Recommendation | Blocks |
|---|---|---|---|
| **D-01a** | Which managed Postgres provider | **Neon** or **Supabase**, ap-south region, PITR enabled | TASK 002 |
| **D-03a** | Which HTTP cache provider | **Upstash Redis** — REST API works from Workers, and its rate-limit SDK covers a mandated control | TASK 003 |
| **D-07a** | Image transformation/optimization. R2 is settled as *storage*; how images are **resized and served** is not | **Cloudflare Images** with a custom `next/image` loader — the default Next optimizer is a poor fit on Workers | TASK 006 |
| **D-19a** | Default cancellation/refund **values** — who may cancel at which status, refund percentage per window, restocking, driver compensation | Engine ships with an admin-editable policy table; **launch values need your input**. I will not invent refund percentages | TASK 010 |
| **D-27a** | **Browser-side error tracking.** Cloud Logging/Monitoring/Error Reporting cover the **server** well. They do not give source-mapped JavaScript stack traces from customers' browsers, and **Crashlytics is mobile-only — it does not cover web** | Either accept the gap in V1 (log client errors to our own `/api/v1/client-errors` endpoint → Cloud Logging, without source-map symbolication), or reinstate a browser error tool. **This is the one capability genuinely absent from the Google toolchain**, per your "unless demonstrated unavailable" clause | TASK 019 |
| **D-35a** | Two bot-protection systems: reCAPTCHA is **required** by Firebase Phone Auth; Turnstile was chosen for other forms | Keep both — reCAPTCHA only on the Firebase auth widget, Turnstile on vendor/driver registration, contact and reviews. Alternative is reCAPTCHA everywhere for consistency, at the cost of dropping a free Cloudflare feature | TASK 003 |
| **D-33a** | Locale URL strategy: prefix every locale vs default-unprefixed | **Default-unprefixed.** Preserves existing/legacy URL shapes and their SEO equity | TASK 004 |
| — | Firebase project region and data residency for Identity Platform | Choose an India/Asia region where supported; confirm alongside payment-data localisation | Before production |
| — | Payment-data localisation obligations under Indian regulation | Confirm with Razorpay and counsel. Not something I should assume | Before production |

> **Closed by this change:** ~~D-24a (MSG91 vs 2Factor)~~ — no longer applicable. Firebase Phone Auth replaces both, and **the DLT registration that was the project's longest lead-time item is removed from the critical path** (unless D-34 reintroduces it).

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
| Identity (D-08…D-10, D-36) | **4** | 0 | D-35a |
| Commerce (D-11…D-20) | 9 | **D-14** | D-19a |
| Supporting (D-21…D-35) | **10** | **D-25, D-32, D-34** | D-27a, D-33a |
| **Total** | **30** | **4** | **7** |

### 16.9 Google-first revision summary

| Removed from V1 | Replaced by | Notes |
|---|---|---|
| MSG91 / 2Factor | **Firebase Phone Authentication** | Removes our DLT burden for OTP; loses control of sender ID, wording and language |
| Custom OTP generation/verification | **Firebase** | Our `otp_verifications` table is no longer used for login OTP; it is retained **only** for delivery OTP (D-20) |
| Resend | 🔴 **Nothing — D-25 blocked** | No Google-native transactional email exists |
| Web Push (raw VAPID) | **Firebase Cloud Messaging** | FCM uses VAPID underneath; we gain topics and Google's delivery infrastructure |
| Sentry | **Cloud Logging + Cloud Monitoring + Error Reporting** | Server-side is well covered; browser errors are a gap (D-27a) |
| PostHog | **Firebase Analytics + GA4** (BigQuery future-ready) | Loses product-analytics funnels; **business KPIs already come from PostgreSQL**, so the operational loss is limited |

**Retained deliberately as non-Google**, because each is better than the Google alternative for this system:

| Retained | Why |
|---|---|
| **Cloudflare Workers + OpenNext** | Application delivery already designed and approved (D-04). Cloud Run would be a full re-architecture with no benefit |
| **PostgreSQL + Hyperdrive** | Relational integrity is core to orders, money and stock. Firestore is the wrong data model for this; Cloud SQL would lose the Hyperdrive edge-pooling path |
| **Cloudflare R2** | Zero egress fees and already integrated with Workers. GCS offers no concrete advantage here, and moving would add cross-cloud egress cost |
| **Cloudflare Queues / Cron Triggers** | Colocated with the runtime. Pub/Sub would add cross-cloud latency and auth complexity |
| **Razorpay** | Google is not a payment gateway for this market. Business requirement |
| **Upstash (D-03a)** | Workers cannot open arbitrary TCP; Memorystore is unreachable from Workers without a proxy |
| **Cloudflare Turnstile (D-35)** | Free with the existing edge; used where Firebase does not mandate reCAPTCHA |

This follows the instruction not to adopt Google services merely for consistency where the existing architecture is stronger.
