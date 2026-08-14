# Parthik — Route Map, Rendering & Access Control

**Status:** Draft for approval
**Version:** 0.1
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`SECURITY.md`](./SECURITY.md)

---

## 1. Rendering and access legend

| Code | Rendering |
|---|---|
| `STATIC` | Prerendered at build time |
| `ISR` | Prerendered, revalidated by tag/time |
| `SSR` | Rendered per request (dynamic) |
| `SSR-PRIVATE` | Per request, `Cache-Control: private, no-store` |
| `CSR` | Server shell + client-side data via TanStack Query |

| Code | Access |
|---|---|
| `PUBLIC` | Anyone |
| `CUSTOMER` | Authenticated user with `CUSTOMER` role |
| `VENDOR` | `VENDOR_OWNER` / `VENDOR_STAFF`, scoped to their own vendor, **approved** status |
| `DRIVER` | `DRIVER` role, **approved** status |
| `ADMIN` | Any admin role, further gated per-page by permission |
| `GUEST-OK` | Works unauthenticated; escalates to login at the point of commitment |

**Indexability rule (master spec §20, §39):** only `PUBLIC` routes may be indexed. Every authenticated surface emits `robots: noindex, nofollow` from its layout and is excluded from the sitemap. All preview/staging deployments emit `noindex` globally regardless of route.

---

## 2. Route group structure

```text
app/
├── (marketing)/          PUBLIC   CMS, legal, blog, registration funnels
├── (shop)/               PUBLIC   home, categories, products, search, offers
├── (customer)/           mixed    cart, checkout, orders, account, favorites
├── vendor/               VENDOR
├── driver/               DRIVER
├── admin/                ADMIN
└── api/                  see API_SPEC.md
```

Route groups exist so each surface gets its **own layout, its own error boundary, its own metadata defaults and its own cache posture** — the shop layout is aggressively cacheable, the customer layout never is.

---

## 3. Public marketing routes — `(marketing)`

| Path | Render | Access | Notes |
|---|---|---|---|
| `/about` | ISR | PUBLIC | CMS-driven (`cms_pages`) |
| `/contact` | ISR + form | PUBLIC | Form → support ticket; Turnstile-protected |
| `/faq` | ISR | PUBLIC | From `faqs`; FAQPage JSON-LD |
| `/privacy` | ISR | PUBLIC | CMS |
| `/terms` | ISR | PUBLIC | CMS |
| `/refund-policy` | ISR | PUBLIC | CMS |
| `/shipping-policy` | ISR | PUBLIC | CMS |
| `/cancellation-policy` | ISR | PUBLIC | CMS |
| `/careers` | ISR | PUBLIC | CMS |
| `/vendor-registration` | SSR + form | PUBLIC | Multi-step application; preserved from current site |
| `/driver-registration` | SSR + form | PUBLIC | Multi-step application; preserved from current site |
| `/blog` | ISR | PUBLIC | Paginated |
| `/blog/[slug]` | ISR | PUBLIC | Article JSON-LD, OG image |

All of these resolve through a single CMS page renderer, so adding a legal page is an admin action, not a deploy.

---

## 4. Public commerce routes — `(shop)`

| Path | Render | Access | Notes |
|---|---|---|---|
| `/` | ISR (zone-aware) | PUBLIC | Section order from `home_layouts`; banners/offers cached 5 min |
| `/categories` | ISR | PUBLIC | Full category tree |
| `/category/[slug]` | ISR + `CSR` filters | PUBLIC | Filter/sort/paginate via URL search params so results are shareable and crawlable; Breadcrumb JSON-LD |
| `/products/[slug]` | ISR + dynamic stock | PUBLIC | Product JSON-LD; **availability and price re-read server-side, never from the ISR cache** |
| `/search` | SSR | PUBLIC | `noindex` (thin/duplicative results), debounced input |
| `/offers` | ISR | PUBLIC | Active coupons + promotions for the selected zone |
| `/stores/[slug]` | ISR | PUBLIC | Store page — **optional in V1**, ships only if D-32 keeps it in scope |

Notes on the location dependency: the homepage and category pages vary by delivery zone. The selected zone lives in a cookie; pages are cached per zone via a cache key that includes the zone, and the zone-specific parts (serviceability banner, ETA, fee) render dynamically inside an otherwise-cached shell.

---

## 5. Customer routes — `(customer)`

| Path | Render | Access | Notes |
|---|---|---|---|
| `/cart` | SSR-PRIVATE | GUEST-OK | Guest cart via signed cookie, merged into the user cart on login |
| `/checkout` | SSR-PRIVATE | CUSTOMER | Serviceability + stock + price re-verified on entry and again on submit |
| `/checkout/payment` | SSR-PRIVATE | CUSTOMER | Provider handoff; never trusts a client-reported result |
| `/checkout/success/[orderId]` | SSR-PRIVATE | CUSTOMER (owner) | Reached only after a server-confirmed order |
| `/checkout/failed/[orderId]` | SSR-PRIVATE | CUSTOMER (owner) | Retry-payment path |
| `/favorites` | SSR-PRIVATE | CUSTOMER | |
| `/orders` | SSR-PRIVATE | CUSTOMER | Paginated |
| `/orders/[id]` | SSR-PRIVATE | CUSTOMER (owner) | Timeline, invoice, reorder, cancel-if-permitted |
| `/orders/[id]/track` | CSR polling | CUSTOMER (owner) | Adaptive polling per **[D-22]** |
| `/account` | SSR-PRIVATE | CUSTOMER | Hub |
| `/account/profile` | SSR-PRIVATE | CUSTOMER | |
| `/account/addresses` | SSR-PRIVATE | CUSTOMER | CRUD + zone resolution |
| `/account/orders` | — | CUSTOMER | Redirects to `/orders` (single implementation, no duplicate list) |
| `/account/favorites` | — | CUSTOMER | Redirects to `/favorites` |
| `/account/notifications` | CSR | CUSTOMER | Notification centre + preferences |
| `/account/security` | SSR-PRIVATE | CUSTOMER | Sessions/devices, logout-everywhere, password/OTP settings |
| `/account/support` | CSR | CUSTOMER | Tickets list + create |
| `/account/support/[ticketId]` | CSR | CUSTOMER (owner) | Thread; internal notes never returned |

> **Route consolidation note.** The master spec lists both `/orders` and `/account/orders`, and both `/favorites` and `/account/favorites`. Rather than build the same list twice, the canonical routes are `/orders` and `/favorites`, with the `/account/*` variants as permanent redirects. Both entry points stay valid; the code exists once. **Flagging explicitly in case you want two genuinely distinct views.**

The master spec also lists `/order/[id]` (singular) alongside `/orders/[id]`. Canonical is the plural `/orders/[id]`; `/order/[id]` is a redirect.

### Auth routes

| Path | Render | Access | Notes |
|---|---|---|---|
| `/login` | SSR | PUBLIC | Phone OTP + email, tabbed; `?next=` validated against an internal-path allowlist |
| `/signup` | SSR | PUBLIC | |
| `/verify-otp` | SSR | PUBLIC | Rate-limited, attempt-capped, Turnstile on repeat |
| `/logout` | action | any | POST only (CSRF-safe) |

Login is a real page (deep-linkable, indexable-safe) with a modal presentation layered on top for in-flow interruptions, so a customer who hits login mid-checkout is not thrown out of context.

---

## 6. Vendor routes — `/vendor`

All require `VENDOR` + approved vendor status, and every query is scoped to the authenticated vendor's `vendor_id` **in the repository layer** — not by a URL parameter. `noindex` throughout.

| Path | Render | Notes |
|---|---|---|
| `/vendor` | SSR-PRIVATE | Overview: today's orders/sales, pending, preparing, completed, low stock, store status, earnings, recent orders, sales graph (master spec §14) |
| `/vendor/orders` | CSR | Tabs: New · Accepted · Preparing · Ready · Completed · Cancelled |
| `/vendor/orders/[id]` | SSR-PRIVATE | Accept / reject with reason / preparing / ready. **Customer PII limited to operational necessity** (master spec §14) |
| `/vendor/products` | CSR | Table with search/filter/bulk actions |
| `/vendor/products/new` | SSR-PRIVATE | |
| `/vendor/products/[id]/edit` | SSR-PRIVATE | Images, variants, price, MRP, SKU, tax, status |
| `/vendor/products/import` | CSR | Bulk import/export; parsing is queued, not inline |
| `/vendor/categories` | SSR-PRIVATE | Assign store products to admin-owned categories (vendors cannot create global categories) |
| `/vendor/inventory` | CSR | Stock levels, low-stock view, bulk stock/price update |
| `/vendor/store` | SSR-PRIVATE | Profile, hours, availability toggle, min order, prep time |
| `/vendor/analytics` | CSR | Sales, top products, category mix, order trends |
| `/vendor/payouts` | CSR | Earnings, payout batches, statements (read-only in V1 — **[D-15]**) |
| `/vendor/coupons` | CSR | Vendor-scoped coupons, if admin permits |
| `/vendor/documents` | SSR-PRIVATE | KYC upload + status; private-bucket signed reads |
| `/vendor/notifications` | CSR | |
| `/vendor/support` | CSR | Tickets |
| `/vendor/settings` | SSR-PRIVATE | Bank details (masked), staff users, notification prefs |

### Vendor onboarding gate
A logged-in vendor whose status is `APPLIED` / `UNDER_REVIEW` / `REJECTED` is routed to `/vendor/onboarding`, which shows application status and required documents. They must not see an empty broken dashboard — this is exactly the "no orders ≠ broken dashboard" rule from master spec §25.

---

## 7. Driver routes — `/driver`

Require `DRIVER` + approved status. Single-column, large tap targets, one primary action per screen. `noindex`.

| Path | Render | Notes |
|---|---|---|
| `/driver` | CSR | Online/offline toggle, current status, today's deliveries + earnings, active delivery card, notifications |
| `/driver/available` | CSR polling | Offered deliveries; accept/reject where policy allows (**[D-18]**) |
| `/driver/active` | CSR polling | The delivery flow: navigate to store → arrived → confirm pickup → navigate to customer → arrived → confirm delivery |
| `/driver/active/[deliveryId]/proof` | CSR | OTP entry, photo/signature capture (**[D-20]**) |
| `/driver/history` | CSR | Completed/failed deliveries |
| `/driver/earnings` | CSR | Daily/weekly summary from the earnings ledger |
| `/driver/profile` | SSR-PRIVATE | |
| `/driver/documents` | SSR-PRIVATE | KYC upload, expiry warnings |
| `/driver/support` | CSR | |
| `/driver/settings` | SSR-PRIVATE | Availability defaults, zones, notification prefs |

### Driver onboarding gate
Same pattern as vendors: unapproved drivers land on `/driver/onboarding` with a clear status and checklist. An expired mandatory document blocks going online and says why.

---

## 8. Admin routes — `/admin`

Require an admin role **and** a specific permission per page. A user who reaches a page without the permission gets the `unauthorized` state, not a redirect loop or a blank screen. `noindex`.

| Path | Permission | Notes |
|---|---|---|
| `/admin` | `dashboard:view` | KPIs from master spec §16: GMV, net sales, orders, AOV, active/new customers, active vendors/drivers, cancellation rate, delivery success rate, refund value, coupon usage, conversion. Charts: orders/day, revenue/day, category perf, vendor perf, acquisition, delivery perf |
| `/admin/orders` | `order:list` | Search, status/date/zone/vendor filters, export |
| `/admin/orders/[id]` | `order:view` | Full timeline, payment detail, authorized status change, assign/reassign driver, cancel, refund, internal note, contact parties, audit history (master spec §17). **Destructive actions require typed confirmation** |
| `/admin/customers` | `customer:list` | |
| `/admin/customers/[id]` | `customer:view` | Profile, orders, addresses, tickets, suspend/ban |
| `/admin/vendors` | `vendor:list` | Application queue + active vendors |
| `/admin/vendors/[id]` | `vendor:view` | KYC review, approve/reject/suspend, commission, stores, payouts |
| `/admin/drivers` | `driver:list` | |
| `/admin/drivers/[id]` | `driver:view` | KYC, zones, vehicle, deliveries, earnings, suspend |
| `/admin/products` | `product:list` | All vendors; approve/reject where review is required |
| `/admin/products/[id]` | `product:view` | |
| `/admin/categories` | `category:manage` | Tree editor, ordering, featured flags |
| `/admin/brands` | `brand:manage` | |
| `/admin/inventory` | `inventory:view` | Cross-vendor low-stock and adjustments |
| `/admin/delivery` | `delivery:view` | Live board of unassigned/active deliveries |
| `/admin/delivery/zones` | `zone:manage` | Zones, pincodes, fees, thresholds, ETAs (**[D-17]**) |
| `/admin/payments` | `payment:view` | Payments, failures, reconciliation queue |
| `/admin/payments/refunds` | `refund:manage` | Refund initiation + status |
| `/admin/payouts` | `payout:manage` | Vendor/driver payout batches |
| `/admin/coupons` | `coupon:manage` | Full rule editor per master spec §18 |
| `/admin/promotions` | `promotion:manage` | |
| `/admin/banners` | `banner:manage` | Placement, audience, zone, schedule, priority |
| `/admin/cms` | `cms:manage` | Pages list |
| `/admin/cms/pages/[id]` | `cms:manage` | Content + SEO fields |
| `/admin/cms/home` | `cms:manage` | **Home layout builder** — section order/visibility (master spec §9) |
| `/admin/cms/blog` | `cms:manage` | |
| `/admin/cms/redirects` | `cms:manage` | 301 manager (master spec §20) |
| `/admin/reviews` | `review:moderate` | Moderation queue |
| `/admin/support` | `ticket:list` | Queue, priority, assignment, SLA |
| `/admin/support/[id]` | `ticket:view` | Thread + internal notes |
| `/admin/notifications` | `notification:manage` | Send/schedule campaigns |
| `/admin/notifications/templates` | `template:manage` | Admin-editable templates with variables |
| `/admin/analytics` | `analytics:view` | |
| `/admin/reports` | `report:view` | Queued generation, download from private R2 |
| `/admin/settings` | `setting:view` | Business, currency, tax, delivery fee, free-delivery threshold, min order, service areas, cancellation/refund rules, maintenance mode (master spec §34) |
| `/admin/settings/payments` | `setting:manage_sensitive` | Elevated permission required |
| `/admin/roles` | `role:manage` | Roles ↔ permissions matrix |
| `/admin/users` | `admin_user:manage` | Admin user management |
| `/admin/audit-logs` | `audit:view` | Filterable, read-only, exportable |
| `/admin/system-health` | `system:view` | DB/cache/storage/queue status, dead-letter queue, recent errors, provider reachability (master spec §30) |
| `/admin/feature-flags` | `flag:manage` | |

---

## 9. Special and system routes

| Path | Purpose |
|---|---|
| `/sitemap.xml` | Generated from indexable content via `app/sitemap.ts`; index-file split if it exceeds URL limits |
| `/robots.txt` | `app/robots.ts` — disallows `/account`, `/checkout`, `/orders`, `/vendor`, `/driver`, `/admin`, `/api`, `/search` |
| `/manifest.webmanifest` | `app/manifest.ts` — PWA |
| `/offline` | Offline fallback page served by the service worker |
| `/maintenance` | Shown when maintenance mode is on; admins bypass it |
| `not-found.tsx` | Branded 404 with search and category links (master spec §20) |
| `error.tsx` / `global-error.tsx` | Per-group error boundaries with a retry action and a support reference id |
| `unauthorized` state | Rendered in-place for 403 rather than a silent redirect |

---

## 10. Middleware behaviour

Because Node Middleware is not yet supported by the OpenNext Cloudflare adapter ([`ARCHITECTURE.md` §4.2](./ARCHITECTURE.md)), middleware is deliberately thin and **does no database work**.

Middleware does:

1. Generate/propagate `x-request-id`.
2. Read and verify the signature of the session cookie; extract `userId`, `roles`, `exp` for **routing only**.
3. Coarse gate by path prefix (table below) — redirect unauthenticated users to `/login?next=…`, and wrong-role users to their own home surface.
4. Apply security headers and `noindex` for private prefixes.
5. Enforce maintenance mode from a cached flag with an admin bypass.
6. Resolve the delivery-zone cookie for cache-key variation.

Middleware does **not**: load a session from the DB, check granular permissions, verify vendor/driver approval status, or check resource ownership. All of that happens in the service layer on every request — a valid-looking cookie gets you to a page, never to data.

| Prefix | Middleware requirement | Server-side additional checks |
|---|---|---|
| `/`, `/category`, `/products`, `/offers`, `/blog`, legal | none | — |
| `/cart` | none | Cart ownership by user or guest token |
| `/checkout`, `/orders`, `/account`, `/favorites` | valid session | `CUSTOMER` role, resource ownership |
| `/vendor` | valid session + vendor role claim | Vendor approved, vendor scope match, per-action permission |
| `/driver` | valid session + driver role claim | Driver approved, documents valid, assignment ownership |
| `/admin` | valid session + admin role claim | Per-page permission, elevated permission for sensitive settings, audit write |
| `/api/*` | none (handlers authorize themselves) | Full auth + permission + rate limit per endpoint |

---

## 11. SEO implementation per route type

| Route type | Metadata | Structured data | Sitemap |
|---|---|---|---|
| Home | Static title/description, OG image | `Organization`, `WebSite` + `SearchAction`, `LocalBusiness` where applicable | Yes, priority 1.0 |
| Category | From `seo_meta`, falls back to name + description | `BreadcrumbList`, `CollectionPage` | Yes |
| Product | From `seo_meta`, falls back to generated | `Product` with `offers` (price, availability, currency), `BreadcrumbList`, `AggregateRating` when reviews exist | Yes |
| CMS/legal | From `seo_meta` | `WebPage` | Yes |
| FAQ | From `seo_meta` | `FAQPage` | Yes |
| Blog | From `seo_meta` | `Article`, `BreadcrumbList` | Yes |
| Offers | From `seo_meta` | `ItemList` | Yes |
| Search | `noindex, follow` | none | No |
| Any authenticated route | `noindex, nofollow` | none | No |

Additional rules: one canonical per page (paginated lists self-canonicalize with `rel=prev/next`); slug changes always write a `redirects` row so links and rankings survive; `Product` availability in JSON-LD must reflect **real** stock, never a stale cached value, because misrepresenting availability is both an SEO and a trust problem.

---

## 12. Open route-level decisions

| # | Question | Impact |
|---|---|---|
| **[D-11]** | Multi-vendor cart | If carts can span vendors, `/cart` and `/checkout` need per-vendor grouping, and `/orders/[id]` may need a parent order-group view |
| **[D-12]** | COD | Adds a payment-method step outcome and changes `/checkout/success` vs `/checkout/payment` flow |
| **[D-22]** | Tracking transport | `/orders/[id]/track` and `/driver/active` polling vs SSE/WebSocket |
| **[D-32]** | Store pages | Whether `/stores/[slug]` exists in V1 (it is a real SEO asset, but it is extra scope) |
| — | `/account/orders` vs `/orders` duplication | Currently resolved as redirect-to-canonical; confirm you don't want two distinct views |
| **[D-33]** | Localisation | The spec does not mention multi-language. Assuming **English only, INR, IST** in V1 with no `[locale]` segment. If Hindi/regional languages are wanted, the route shape must change now, not later |
