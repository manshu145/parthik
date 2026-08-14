# Parthik Documentation

Architecture and design documentation for the Parthik rebuild.

**Status: architecture APPROVED, revised for a Google-first service strategy (2026-08-14).** **32 of 36** decisions settled, 4 blocked, 7 open sub-items. **No application code and no database migrations exist yet** — both are deliberately withheld.

## Read in this order

| Document                                             | Contents                                                                                                                                                                               |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`PARTHIK_MASTER_SPEC.md`](./PARTHIK_MASTER_SPEC.md) | The authoritative product specification. Everything else interprets it                                                                                                                 |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md)               | System design, runtime constraints, module boundaries, caching, storage, cross-cutting services, localisation — **§16 Approved Decisions** and **§16.9 Google-first revision summary** |
| [`DATABASE.md`](./DATABASE.md)                       | Logical schema, enums, indexes, state machines, inventory reservation, COD cash ledger, translation tables, retention                                                                  |
| [`ROUTES.md`](./ROUTES.md)                           | Every route, its rendering strategy, access control, locale routing and SEO treatment                                                                                                  |
| [`API_SPEC.md`](./API_SPEC.md)                       | Transport rules, the Firebase token exchange, endpoints, COD and cash reconciliation, webhooks, error codes                                                                            |
| [`SECURITY.md`](./SECURITY.md)                       | Threat model, Firebase token verification, RBAC, rate limits, COD cash integrity, data protection, pre-production checklist                                                            |
| [`DEVELOPMENT_PLAN.md`](./DEVELOPMENT_PLAN.md)       | Task sequence with dependency status, CI/CD, Definition of Done, cutover SOP, risk register                                                                                            |

## Start here

**[`ARCHITECTURE.md` §16 — Approved Decisions](./ARCHITECTURE.md#16-approved-decisions)** is the authoritative decision record.
**[§16.9 — Google-first revision summary](./ARCHITECTURE.md#169-google-first-revision-summary)** shows exactly what was swapped, what was kept, and why.

## Service strategy

**Google-first, with deliberate exceptions.**

| Layer              | Choice                                                                              |
| ------------------ | ----------------------------------------------------------------------------------- |
| Identity           | **Firebase Authentication** — phone OTP. Parthik retains all RBAC and authorization |
| Push               | **Firebase Cloud Messaging**                                                        |
| Analytics          | **Firebase Analytics + GA4**, BigQuery kept future-ready                            |
| Maps               | **Google Maps Platform** — Maps JS, Places, Geocoding, Routes, Route Matrix         |
| Logging/monitoring | **Google Cloud Logging, Cloud Monitoring, Error Reporting**                         |
| App delivery       | **Cloudflare Workers + OpenNext** _(retained — better fit than Cloud Run here)_     |
| Data               | **PostgreSQL + Hyperdrive** _(retained — relational integrity is core)_             |
| Storage / queues   | **Cloudflare R2 + Queues** _(retained — colocated, no egress fees)_                 |
| Payments           | **Razorpay** _(Google is not a payment gateway)_                                    |

Per instruction, Google services were **not** adopted where the existing Cloudflare/PostgreSQL architecture is stronger.

## 🔴 Blocked — work stops on these

| Decision                              | Blocks                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-14** GST/tax model                | Invoices, tax display, GST reporting. No tax assumption is implemented                                                                                              |
| **D-25** Transactional email          | **Google has no first-party transactional email service.** Blocks email OTP fallback, all order emails, and every account-recovery path other than the phone number |
| **D-34** Non-OTP transactional SMS    | Firebase covers OTP only. Order-status SMS has no Google-native path                                                                                                |
| **D-32** One store per vendor or many | Vendor dashboard UI shape only                                                                                                                                      |

> **Combined consequence of D-25 + D-34:** FCM push and in-app are the _only_ outbound channels in V1. A customer who declines notification permission receives **no proactive order updates**. This needs a product decision, not just a technical one.

## Key V1 decisions at a glance

Single-vendor orders · UPI + Card + **COD** with cash reconciliation · Razorpay · Drizzle + Hyperdrive · Cloudflare Workers/OpenNext · **Firebase phone OTP, no passwords** · stock reserved at order creation · zone-based delivery fee with an admin-configurable ₹199 free-delivery threshold · auto-nearest dispatch with timeout and fallback · mandatory delivery OTP · manual vendor settlement · **English + Hindi from day one** · no legacy data migration yet.

## Status

| Item                | Status                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Documentation       | **Approved** v1.1                                                                        |
| Decisions resolved  | **32 of 36**                                                                             |
| Application code    | Not started                                                                              |
| Database migrations | **Not generated** — withheld by instruction                                              |
| Legacy data         | **Not migrated** — deferred by D-31                                                      |
| Production / DNS    | **Untouched**                                                                            |
| Critical path       | ✅ **Clear.** D-08 resolved by Firebase; DLT registration no longer gates authentication |
| Next task           | Complete **TASK 001** scaffold — see [`DEVELOPMENT_PLAN.md` §11](./DEVELOPMENT_PLAN.md)  |

## Pre-code audit (2026-08-14)

A full pre-implementation audit was run across all documents. Outcome: **2 blockers found and fixed, 12 important issues fixed, 8 optional items logged.**

The two blockers were both design errors that would have caused rework during implementation:

1. **OTP entry as a separate `/verify-otp` page** — incompatible with Firebase, whose `confirmationResult` lives in browser memory and is destroyed by navigation. `/login` is now documented as a single client-side state machine.
2. **No Firebase strategy in the test architecture** — every critical E2E journey starts with sign-in, and real SMS cannot be received in CI, so the whole E2E suite was unimplementable. [`ARCHITECTURE.md` §13.1](./ARCHITECTURE.md#131-testing-against-firebase-and-google-services) now specifies the Firebase Auth Emulator, test phone numbers, and adapter-level fakes for Maps/FCM/GA4.

Also added: [**§16.10 Deviations from the master specification**](./ARCHITECTURE.md#1610-deviations-from-the-master-specification) — the master spec mandates SMS and Email notification channels (§21) and V1 ships neither, which needs explicit product sign-off rather than silent omission.

Two items still need **your** decision and were deliberately not resolved: COD cash permission assignment (separation of duties) and the notification-channel deviation V-1.
