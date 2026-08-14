# Parthik Documentation

Architecture and design documentation for the Parthik rebuild.

**Status: architecture APPROVED, revised for a Google-first service strategy (2026-08-14).** 30 of 36 decisions settled, 4 blocked, 7 open sub-items. **No application code and no database migrations exist yet** — both are deliberately withheld.

## Read in this order

| Document | Contents |
|---|---|
| [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) | The authoritative product specification. Everything else interprets it |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | System design, runtime constraints, module boundaries, caching, storage, cross-cutting services, localisation — **§16 Approved Decisions** and **§16.9 Google-first revision summary** |
| [`DATABASE.md`](./DATABASE.md) | Logical schema, enums, indexes, state machines, inventory reservation, COD cash ledger, translation tables, retention |
| [`ROUTES.md`](./ROUTES.md) | Every route, its rendering strategy, access control, locale routing and SEO treatment |
| [`API_SPEC.md`](./API_SPEC.md) | Transport rules, the Firebase token exchange, endpoints, COD and cash reconciliation, webhooks, error codes |
| [`SECURITY.md`](./SECURITY.md) | Threat model, Firebase token verification, RBAC, rate limits, COD cash integrity, data protection, pre-production checklist |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md) | Task sequence with dependency status, CI/CD, Definition of Done, cutover SOP, risk register |

## Start here

**[`ARCHITECTURE.md` §16 — Approved Decisions](./ARCHITECTURE.md#16-approved-decisions)** is the authoritative decision record.
**[§16.9 — Google-first revision summary](./ARCHITECTURE.md#169-google-first-revision-summary)** shows exactly what was swapped, what was kept, and why.

## Service strategy

**Google-first, with deliberate exceptions.**

| Layer | Choice |
|---|---|
| Identity | **Firebase Authentication** — phone OTP. Parthik retains all RBAC and authorization |
| Push | **Firebase Cloud Messaging** |
| Analytics | **Firebase Analytics + GA4**, BigQuery kept future-ready |
| Maps | **Google Maps Platform** — Maps JS, Places, Geocoding, Routes, Route Matrix |
| Logging/monitoring | **Google Cloud Logging, Cloud Monitoring, Error Reporting** |
| App delivery | **Cloudflare Workers + OpenNext** *(retained — better fit than Cloud Run here)* |
| Data | **PostgreSQL + Hyperdrive** *(retained — relational integrity is core)* |
| Storage / queues | **Cloudflare R2 + Queues** *(retained — colocated, no egress fees)* |
| Payments | **Razorpay** *(Google is not a payment gateway)* |

Per instruction, Google services were **not** adopted where the existing Cloudflare/PostgreSQL architecture is stronger.

## 🔴 Blocked — work stops on these

| Decision | Blocks |
|---|---|
| **D-14** GST/tax model | Invoices, tax display, GST reporting. No tax assumption is implemented |
| **D-25** Transactional email | **Google has no first-party transactional email service.** Blocks email OTP fallback, all order emails, and every account-recovery path other than the phone number |
| **D-34** Non-OTP transactional SMS | Firebase covers OTP only. Order-status SMS has no Google-native path |
| **D-32** One store per vendor or many | Vendor dashboard UI shape only |

> **Combined consequence of D-25 + D-34:** FCM push and in-app are the *only* outbound channels in V1. A customer who declines notification permission receives **no proactive order updates**. This needs a product decision, not just a technical one.

## Key V1 decisions at a glance

Single-vendor orders · UPI + Card + **COD** with cash reconciliation · Razorpay · Drizzle + Hyperdrive · Cloudflare Workers/OpenNext · **Firebase phone OTP, no passwords** · stock reserved at order creation · zone-based delivery fee with an admin-configurable ₹199 free-delivery threshold · auto-nearest dispatch with timeout and fallback · mandatory delivery OTP · manual vendor settlement · **English + Hindi from day one** · no legacy data migration yet.

## Status

| Item | Status |
|---|---|
| Documentation | **Approved** v1.1 |
| Decisions resolved | 30 of 36 |
| Application code | Not started |
| Database migrations | **Not generated** — withheld by instruction |
| Legacy data | **Not migrated** — deferred by D-31 |
| Production / DNS | **Untouched** |
| Critical path | ✅ **Clear.** D-08 resolved by Firebase; DLT registration no longer gates authentication |
| Next task | Complete **TASK 001** scaffold — see [`DEVELOPMENT_PLAN.md` §11](./DEVELOPMENT_PLAN.md) |
