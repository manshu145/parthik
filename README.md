# Parthik

Hyperlocal commerce and delivery platform — customer PWA, vendor dashboard, driver dashboard and admin dashboard.

## Status

**Implementation status reviewed 24 October 2026.** The earlier status text in this README became stale as checkout, orders, payments, database migrations and operational screens were added. Treat the product specification as intended scope, and the branch/CI status below as implementation evidence.

| Area                                                           | Current state                                                                                                                                                                                                                                |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database schema and migrations                                 | Schema, bootstrap SQL and committed migrations exist. The CI PostgreSQL job verifies migrations, seeding and critical SQL against PostgreSQL 16.                                                                                             |
| Authentication and RBAC                                        | Firebase phone-auth/session code and permission engine exist. Real OTP sign-in requires a configured Firebase project, billing, keys and security settings.                                                                                  |
| Checkout, orders and payments                                  | Service/API code exists. CI covers cart persistence, checkout quote, order placement and payment-webhook paths. Live Razorpay credentials and webhook verification remain deployment tasks.                                                  |
| Vendor, driver and admin dashboards                            | The `develop` branch still has gaps/placeholder screens. [PR #17](https://github.com/manshu145/parthik/pull/17) contains a substantial operational-screen implementation, but is not merged yet.                                             |
| Notifications, CMS and marketing                               | Core code exists in the feature work; actual FCM configuration/content and launch policy still need verification. Email and non-OTP order SMS remain blocked decisions.                                                                      |
| Live website                                                   | `https://parthik.com` serves the app from the VPS. A working page is not proof of production commerce readiness: deployed database, production environment and external providers must be verified before accepting real orders.             |
| Deployment approach                                            | Architecture docs target Cloudflare Workers/OpenNext; the feature PR also adds VPS Docker/Caddy deployment files, while the current VPS uses Nginx/systemd. Standardize and document the release target before the final production cutover. |
| Legacy data migration                                          | Deliberately deferred by D-31; no legacy business data should be migrated or overwritten until the old system is backed up and a restore is rehearsed.                                                                                       |

For the branch-by-branch snapshot, production launch gates and decisions still requiring business input, see [Implementation status](./docs/IMPLEMENTATION_STATUS.md).

**Known business blockers:** D-14 GST/tax and invoices; D-19a cancellation/refund policy values; D-25 transactional email; D-32 one-vs-multiple stores per vendor; D-34 order-status SMS. Automated vendor settlement is outside V1. Push/in-app-only notifications mean a customer who declines push may receive no proactive order updates.

## Documentation

Start with **[`docs/`](./docs/README.md)**.

| Document                                       | Contents                                                   |
| ---------------------------------------------- | ---------------------------------------------------------- |
| [Master Spec](./docs/PARTHIK_MASTER_SPEC.md)   | Authoritative product specification                        |
| [Architecture](./docs/ARCHITECTURE.md)         | System design, stack, module boundaries, decision register |
| [Database](./docs/DATABASE.md)                 | Schema, enums, indexes, state machines                     |
| [Routes](./docs/ROUTES.md)                     | Route map, rendering, access control, SEO                  |
| [API Spec](./docs/API_SPEC.md)                 | Endpoints, conventions, error codes, webhooks              |
| [Security](./docs/SECURITY.md)                 | Threat model, auth, RBAC, data protection                  |
| [Development Plan](./docs/DEVELOPMENT_PLAN.md) | Task sequence, workflow, CI/CD, cutover SOP                |
| [Development Guide](./docs/DEVELOPMENT.md)     | Day-to-day mechanics: setup, commands, conventions         |

## Stack

| Layer     | Choice                                                          |
| --------- | --------------------------------------------------------------- |
| Framework | Next.js 16 (App Router), React 19, TypeScript strict            |
| Styling   | Tailwind CSS v4 with design tokens, shadcn/ui primitives        |
| i18n      | next-intl — **English + Hindi** from day one (D-33)             |
| Database  | PostgreSQL via Drizzle ORM, Cloudflare Hyperdrive in production |
| Hosting   | Cloudflare Workers via OpenNext (D-04)                          |
| Identity  | Firebase Authentication (phone OTP) — Parthik owns RBAC         |
| Push      | Firebase Cloud Messaging                                        |
| Maps      | Google Maps Platform — Places, Geocoding, Routes, Route Matrix  |
| Analytics | Firebase Analytics + GA4                                        |
| Logging   | Google Cloud Logging / Monitoring                               |
| Payments  | Razorpay                                                        |
| Storage   | Cloudflare R2                                                   |
| Tests     | Vitest (unit), Playwright (E2E)                                 |

## V1 scope highlights

Single-vendor orders · UPI + Card + COD with cash reconciliation · **Firebase phone-OTP authentication** (no passwords) · zone-based delivery fee with an admin-configurable ₹199 free-delivery threshold · auto-nearest driver dispatch · mandatory delivery OTP · manual vendor settlement · English + Hindi.

**Not in V1:** tax/GST handling (blocked pending accountant confirmation), transactional email, order-status SMS, automated settlement, legacy data migration, languages beyond English and Hindi.

## Getting started

```bash
# 1. Requirements: Node 22+, pnpm 10+
node -v && pnpm -v

# 2. Install
pnpm install

# 3. Configure — every provider is OPTIONAL; the app boots without any of them
cp .env.example .env.local

# 4. Run
pnpm dev            # http://localhost:3000
```

Then check:

- <http://localhost:3000> — English
- <http://localhost:3000/hi> — Hindi
- <http://localhost:3000/api/v1/health> — liveness
- <http://localhost:3000/api/v1/health/deep> — which providers are configured

**The application runs with no credentials at all.** Unconfigured providers report themselves as `not_configured` at `/api/v1/health/deep` and raise a typed `ConfigurationError` (503) only if something actually tries to use them. This is intentional so a new developer can work without collecting third-party keys first.

## Commands

| Command                          | Purpose                                                         |
| -------------------------------- | --------------------------------------------------------------- |
| `pnpm dev`                       | Development server                                              |
| `pnpm build`                     | Production build                                                |
| `pnpm typecheck`                 | `tsc --noEmit`                                                  |
| `pnpm lint`                      | ESLint, including architectural import boundaries               |
| `pnpm format` / `format:check`   | Prettier                                                        |
| `pnpm test`                      | Unit tests                                                      |
| `pnpm test:e2e`                  | Playwright E2E                                                  |
| `pnpm verify`                    | typecheck + lint + format + test + build                        |
| `pnpm cf:build`                  | Build for Cloudflare Workers                                    |
| `pnpm cf:preview`                | Run the Workers build locally                                   |
| `pnpm db:check`                  | Validate the Drizzle schema without touching a database         |
| `pnpm seed`                      | Load deterministic reference data (needs `DATABASE_URL`)        |
| `bash scripts/verify-runtime.sh` | Boot the built app and smoke-test routes, i18n, headers, health |
| `bash scripts/check-secrets.sh`  | Fail if credentials were committed                              |

`pnpm db:generate` / `db:migrate` exist but **no migrations have been generated yet** — that step requires explicit authorization.

## Project structure

```text
app/                    Routing and composition only
  [locale]/             Locale-scoped pages (en unprefixed, /hi prefixed)
  api/v1/               Route handlers
components/
  ui/                   shadcn/ui primitives
  feedback/             The eight required UX states
  layout/               Shell pieces
i18n/                   Locale routing, request config, navigation helpers
messages/               en.json, hi.json — UI strings
lib/
  config/               THE ONLY place that reads process.env
  errors/               Error taxonomy
  logger/               Structured JSON logging with redaction
  db/                   Drizzle client, repository base, tenant scope
  firebase/             Client init, ID-token verifier, Identity REST, FCM
  google/               Service-account access tokens
  maps/                 Provider interfaces + Google adapter
  analytics/            Event allowlist + GA4 Measurement Protocol
  observability/        Health report, Cloud Logging sink
  http/                 Response envelope, security headers, route access
db/
  schema/               Drizzle table definitions, one file per domain
  seed/                 Deterministic reference data + dev-only demo data
modules/                Business logic — one directory per domain
tests/unit, tests/e2e
docs/                   Architecture, database, routes, API, security, plan
```

### Architectural rules that are enforced, not just documented

ESLint fails the build on any of these:

- `app/**` may not import repositories or the database layer — go through a service.
- `components/**` may not import business modules or the database.
- Only `modules/**/*.repository.ts` may import `db/**`.
- Nothing outside `lib/config/**` may read `process.env`.

## Key design decisions worth knowing before you write code

- **Money is integer paise**, never a float, behind a branded `Paise` type. Use `lib/money.ts`.
- **Firebase verifies identity; Parthik owns authorization.** The Firebase ID token is exchanged for a Parthik session at `POST /api/v1/auth/session`; roles live in PostgreSQL, never in Firebase custom claims.
- **Middleware cannot touch the database.** Node middleware is unsupported by the OpenNext adapter, so `middleware.ts` does coarse routing only. Real authorization happens in the service layer on every request.
- **Cache keys must include locale and zone.** Omitting locale would serve Hindi users cached English pages.
- **Tax is not implemented.** D-14 is blocked; tax columns exist but stay zero and no tax line renders anywhere. Do not add a tax assumption.
- **Orders are immutable snapshots.** Product names, prices and addresses are copied onto the order so later edits cannot rewrite history.
- **Every feature ships all eight UX states** (loading, empty, success, error, disabled, unauthorized, not found, offline). See `components/feedback/`.

## Branches

| Branch                         | Purpose                      |
| ------------------------------ | ---------------------------- |
| `main`                         | Production. Protected        |
| `develop`                      | Integration / staging        |
| `feature/*`, `fix/*`, `docs/*` | Work branches, merged via PR |
