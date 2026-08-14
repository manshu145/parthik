# Parthik

Hyperlocal commerce and delivery platform — customer PWA, vendor dashboard, driver dashboard and admin dashboard.

## Status

**Application foundation (TASK 001) implemented. No business features yet.**

That is deliberate. The architecture gate is complete (32 of 36 decisions approved) and this repository now contains a working, verified scaffold. Commerce, vendor, driver and admin features are separate, sequenced tasks.

|                                 |                                            |
| ------------------------------- | ------------------------------------------ |
| Architecture                    | Approved — see [`docs/`](./docs/README.md) |
| Application foundation          | **Implemented** (TASK 001)                 |
| Database schema / migrations    | **Not created** — TASK 002                 |
| Auth flow (sign-in UI)          | **Not implemented** — TASK 003             |
| Commerce, vendor, driver, admin | Not implemented                            |
| Legacy data migration           | Deferred (D-31)                            |
| Production / DNS                | Untouched                                  |

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
| `bash scripts/verify-runtime.sh` | Boot the built app and smoke-test routes, i18n, headers, health |
| `bash scripts/check-secrets.sh`  | Fail if credentials were committed                              |

`pnpm db:generate` / `db:migrate` exist but produce nothing yet — there is no schema until TASK 002.

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
  db/                   Drizzle client (Hyperdrive or DATABASE_URL)
  firebase/             Client init, ID-token verifier, Identity REST, FCM
  google/               Service-account access tokens
  maps/                 Provider interfaces + Google adapter
  analytics/            Event allowlist + GA4 Measurement Protocol
  observability/        Health report, Cloud Logging sink
  http/                 Response envelope, security headers, route access
db/                     Schema barrel (empty) and future migrations
modules/                Business logic — one directory per domain (empty)
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
- **Tax is not implemented.** D-14 is blocked; `NoTaxStrategy` returns zero and no tax line renders anywhere. Do not add a tax assumption.
- **Every feature ships all eight UX states** (loading, empty, success, error, disabled, unauthorized, not found, offline). See `components/feedback/`.

## Documentation

Start at [`docs/README.md`](./docs/README.md). The authoritative decision record is [`docs/ARCHITECTURE.md` §16](./docs/ARCHITECTURE.md#16-approved-decisions).

## Branches

| Branch                         | Purpose                      |
| ------------------------------ | ---------------------------- |
| `main`                         | Production. Protected        |
| `develop`                      | Integration / staging        |
| `feature/*`, `fix/*`, `docs/*` | Work branches, merged via PR |
