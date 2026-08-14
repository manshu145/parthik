# Parthik Documentation

Architecture and design documentation for the Parthik rebuild.

**Status: architecture APPROVED (2026-08-14).** 28 of 33 decisions settled, 3 blocked, 6 open sub-items. **No application code and no database migrations exist yet** — both are deliberately withheld.

## Read in this order

| Document | Contents |
|---|---|
| [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) | The authoritative product specification. Everything else interprets it |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, runtime constraints, module boundaries, caching, storage, cross-cutting services, localisation — **and §16 Approved Decisions** |
| [`DATABASE.md`](./DATABASE.md) | Logical schema, enums, indexes, state machines, inventory reservation, COD cash ledger, translation tables, retention |
| [`ROUTES.md`](./ROUTES.md) | Every route, its rendering strategy, access control, locale routing and SEO treatment |
| [`API_SPEC.md`](./API_SPEC.md) | Transport rules, response envelope, error codes, idempotency, endpoints, COD and cash reconciliation, webhooks |
| [`SECURITY.md`](./SECURITY.md) | Threat model, auth, RBAC, rate limits, COD cash integrity, data protection, pre-production checklist |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | Task sequence with dependency status, CI/CD, Definition of Done, cutover SOP, risk register |

## Start here

**[`ARCHITECTURE.md` §16 — Approved Decisions](./ARCHITECTURE.md#16-approved-decisions)** is the authoritative decision record.

## 🔴 Blocked — work stops on these

| Decision | Blocks |
|---|---|
| **D-08** auth implementation library | **TASK 003 and everything after it — the critical path** |
| **D-14** GST/tax model | Invoices, tax display, GST reporting. No tax assumption is implemented |
| **D-32** one store per vendor or many | Vendor dashboard UI shape only |

Plus **D-24a** (MSG91 vs 2Factor): not architecturally blocking, but DLT registration has the longest external lead time in the project and gates all authentication.

## Key V1 decisions at a glance

Single-vendor orders · UPI + Card + **COD** · Razorpay · Drizzle + Hyperdrive · Cloudflare Workers/OpenNext · **phone OTP only, no passwords** · stock reserved at order creation · zone-based delivery fee with an admin-configurable ₹199 free-delivery threshold · auto-nearest dispatch with timeout and fallback · mandatory delivery OTP · manual vendor settlement · **English + Hindi from day one** · no legacy data migration yet.

## Status

| Item | Status |
|---|---|
| Documentation | **Approved** v1.0 |
| Decisions resolved | 28 of 33 |
| Application code | Not started |
| Database migrations | **Not generated** — withheld by instruction |
| Legacy data | **Not migrated** — deferred by D-31 |
| Production / DNS | **Untouched** |
| Next task | Complete **TASK 001** scaffold — see [`DEVELOPMENT_PLAN.md` §11](./DEVELOPMENT_PLAN.md) |
