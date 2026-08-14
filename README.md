# Parthik

Hyperlocal commerce and delivery platform — customer PWA, vendor dashboard, driver dashboard and admin dashboard.

## Status

**Architecture and design phase. No application code has been written yet.**

This is intentional. The [master specification](./docs/PARTHIK_MASTER_SPEC.md) §27 requires requirements, navigation, flows, database entities and the design system to be documented before implementation begins.

| | |
|---|---|
| Documentation | Drafted, awaiting approval |
| Application code | Not started |
| Decisions pending approval | 33 — see [decision register](./docs/ARCHITECTURE.md#16-decision-register) |

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

## Intended stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui · PostgreSQL · Cloudflare Workers via OpenNext · Cloudflare R2.

Several stack details are still open decisions — see the decision register before assuming any of them are settled.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production. Protected |
| `develop` | Integration / staging |
| `feature/*`, `fix/*`, `docs/*` | Work branches, merged via PR |
