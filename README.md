# Parthik

Hyperlocal commerce and delivery platform — customer PWA, vendor dashboard, driver dashboard and admin dashboard.

## Status

**Architecture APPROVED (2026-08-14). No application code has been written yet.**

This is intentional. The [master specification](./docs/PARTHIK_MASTER_SPEC.md) §27 requires requirements, navigation, flows, database entities and the design system to be documented before implementation begins — that gate is now complete.

| | |
|---|---|
| Documentation | **Approved** v1.0 |
| Decisions | **30 of 36 approved** — see [approved decisions](./docs/ARCHITECTURE.md#16-approved-decisions) |
| Blocked | **D-14** GST/tax · **D-25** transactional email · **D-34** order-status SMS · **D-32** multi-store |
| Application code | Not started |
| Database migrations | Not generated — withheld by instruction |
| Legacy data | Not migrated — deferred (D-31) |
| Production / DNS | Untouched |

## Documentation

Start with **[`docs/`](./docs/README.md)**.

| Document | Contents |
|---|---|
| [Master Spec](./docs/PARTHIK_MASTER_SPEC.md) | Authoritative product specification |
| [Architecture](./docs/ARCHITECTURE.md) | System design, stack, module boundaries, decision register |
| [Database](./docs/DATABASE.md) | Schema, enums, indexes, state machines |
| [Routes](./docs/ROUTES.md) | Route map, rendering, access control, SEO |
| [API Spec](./docs/API_SPEC.md) | Endpoints, conventions, error codes, webhooks |
| [Security](./docs/SECURITY.md) | Threat model, auth, RBAC, data protection |
| [Development Plan](./docs/DEVELOPMENT_PLAN.md) | Task sequence, workflow, CI/CD, cutover SOP |

## Stack

**Application delivery:** Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · **Cloudflare Workers via OpenNext** · Cloudflare R2 · Cloudflare Queues
**Data:** **Drizzle ORM** · PostgreSQL via **Cloudflare Hyperdrive**
**Google-first services:** **Firebase Authentication** (phone OTP) · **Firebase Cloud Messaging** · **Firebase Analytics + Google Analytics 4** · **Google Maps Platform** (Maps, Places, Geocoding, Routes, Route Matrix) · **Google Cloud Logging / Monitoring**
**External by necessity:** **Razorpay** (payments)
**Localisation:** English + Hindi (next-intl)

## V1 scope highlights

Single-vendor orders · UPI + Card + COD with cash reconciliation · **Firebase phone-OTP authentication** (no passwords) · zone-based delivery fee with an admin-configurable ₹199 free-delivery threshold · auto-nearest driver dispatch · mandatory delivery OTP · manual vendor settlement · English + Hindi.

**Not in V1:** tax/GST handling (blocked pending accountant confirmation), **transactional email**, **order-status SMS**, automated settlement, legacy data migration, languages beyond English and Hindi.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production. Protected |
| `develop` | Integration / staging |
| `feature/*`, `fix/*`, `docs/*` | Work branches, merged via PR |
