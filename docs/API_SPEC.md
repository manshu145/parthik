# Parthik — API Specification

**Status:** Draft for approval
**Version:** 0.1
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`SECURITY.md`](./SECURITY.md) · [`DATABASE.md`](./DATABASE.md)

> This is the internal API contract for the Parthik web application. It is not a public partner API. Everything here is versioned under `/api/v1` so a future mobile app or extracted API service can consume it unchanged.

---

## 1. Transport rules

### 1.1 When to use what

| Mechanism | Used for | Not used for |
|---|---|---|
| **Server Actions** | Form mutations rendered by our own UI: address CRUD, profile, cart mutations, vendor product edit, admin settings, moderation actions | Anything called by a non-form client, anything a mobile app would need |
| **Route Handlers** (`/api/v1/*`) | Provider webhooks, polling endpoints, client-query endpoints backing TanStack Query, upload authorization, exports, health, PWA fetches | Simple form submissions that could be a Server Action |

Both call **identical service functions**. A service never knows its transport. Server Actions are treated as public HTTP endpoints for security purposes and re-validate + re-authorize every time.

### 1.2 Conventions

| Concern | Rule |
|---|---|
| Base path | `/api/v1` |
| Format | JSON only; `Content-Type: application/json` (exception: webhook raw bodies) |
| Methods | `GET` read (never mutates), `POST` create/action, `PATCH` partial update, `PUT` full replace, `DELETE` remove |
| Casing | `camelCase` in JSON, `snake_case` in the database; mapping happens in the repository layer |
| Money | Always integer paise, always with an explicit field suffix: `totalAmountPaise`. Never a pre-formatted string, never a float |
| Timestamps | ISO 8601 UTC with `Z` |
| IDs | ULID/UUID strings |
| Validation | Zod schema per endpoint, shared with the client form. Unknown fields rejected, not ignored |
| Caching | Authenticated responses `Cache-Control: private, no-store` |
| Compression | Handled at the edge |
| Request tracing | Every response carries `X-Request-Id` |

### 1.3 Response envelope

Success:

```json
{
  "success": true,
  "data": { },
  "meta": { "requestId": "01J...", "page": 1, "pageSize": 20, "total": 137, "hasMore": true }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "COUPON_MIN_CART_NOT_MET",
    "message": "Add items worth ₹120 more to use this coupon.",
    "details": { "minCartPaise": 30000, "currentCartPaise": 18000 },
    "fieldErrors": { "couponCode": ["Not applicable to this cart"] }
  },
  "meta": { "requestId": "01J..." }
}
```

`code` is stable and machine-readable — the client switches on `code`, never on `message`. `message` is safe to display. Internal detail is logged, never returned.

### 1.4 Status codes

`200` ok · `201` created · `204` no content · `400` business rule violated · `401` unauthenticated · `403` unauthorized · `404` not found (also used to mask existence) · `409` conflict / illegal state transition / idempotency mismatch · `422` validation failed · `429` rate limited (`Retry-After`) · `500` internal · `502` upstream provider failure · `503` maintenance mode.

### 1.5 Pagination, filtering, sorting

Cursor pagination for feeds and infinite lists (`?cursor=&limit=`), offset pagination for admin tables that need page numbers (`?page=&pageSize=`). `limit`/`pageSize` capped server-side at 100. Sorting is restricted to an allowlist per endpoint (`?sort=createdAt:desc`) — never a raw column name from the client. Filters are explicit named params, never a passthrough query object.

### 1.6 Idempotency

Required on: order creation, payment intent creation, refund initiation, delivery confirmation, bulk import submission.

Client sends `Idempotency-Key: <ulid>`. Server behaviour:

1. Insert the key with a lock (`idempotency_keys` + cache). If insert fails, the key exists.
2. If a completed record exists with the **same request hash** → return the stored response verbatim.
3. Same key with a **different** request hash → `409 IDEMPOTENCY_KEY_REUSED`.
4. In-flight → `409 REQUEST_IN_PROGRESS`.

This is what makes the master spec's "repeated clicks cannot create duplicate orders" (§12) actually true, including across retries and flaky mobile networks.

### 1.7 Rate limits

Enforced at the edge and in-application. Full table in [`SECURITY.md` §7](./SECURITY.md). Notable: OTP request 3/phone/10 min and 10/IP/hour; login 10/identifier/15 min; order creation 5/user/min; search 30/min; webhooks unlimited but signature-gated.

---

## 2. Authentication endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/auth/otp/request` | PUBLIC | Request phone OTP. Body `{ phone, purpose, turnstileToken? }`. **Always returns a generic success** — never reveals whether the number is registered |
| `POST` | `/api/v1/auth/otp/verify` | PUBLIC | `{ phone, code, purpose }` → session cookie + `{ user, roles, isNewUser }` |
| `POST` | `/api/v1/auth/login` | PUBLIC | Email login (**[D-09]**). Uniform failure message and constant-ish timing to prevent account enumeration |
| `POST` | `/api/v1/auth/signup` | PUBLIC | `{ fullName, phone, email?, password? }` |
| `POST` | `/api/v1/auth/logout` | AUTH | Revokes the current session |
| `POST` | `/api/v1/auth/logout-all` | AUTH | Revokes every session for the user |
| `GET` | `/api/v1/auth/session` | AUTH | Current user, roles, permissions, active context |
| `GET` | `/api/v1/auth/sessions` | AUTH | Active devices/sessions list |
| `DELETE` | `/api/v1/auth/sessions/[id]` | AUTH (owner) | Revoke one session |
| `POST` | `/api/v1/auth/email/verify` | AUTH | |
| `POST` | `/api/v1/auth/password/reset-request` | PUBLIC | Generic response regardless of existence |
| `POST` | `/api/v1/auth/password/reset` | PUBLIC | Single-use, short-lived, hashed token |

---

## 3. Location and serviceability

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/location/serviceability?pincode=` | PUBLIC | `{ serviceable, zoneId, zoneName, deliveryFeePaise, freeDeliveryThresholdPaise, minOrderPaise, etaMinutes }` |
| `GET` | `/api/v1/location/reverse-geocode?lat=&lng=` | PUBLIC | Proxied to the maps provider **server-side** so the API key is never in the browser; rate-limited and cached |
| `GET` | `/api/v1/location/autocomplete?q=` | PUBLIC | Same proxy pattern, debounced client-side |
| `GET` | `/api/v1/location/zones` | PUBLIC | Active serviceable zones/cities |
| `POST` | `/api/v1/location/select` | GUEST-OK | Persists the chosen zone in a cookie for cache variation |

Provider proxying is deliberate: it protects the key, lets us cache aggressively, and keeps map spend controllable (**[D-23]**).

---

## 4. Catalog

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/categories` | PUBLIC | Tree; heavily cached |
| `GET` | `/api/v1/categories/[slug]` | PUBLIC | Category + children + SEO meta |
| `GET` | `/api/v1/products` | PUBLIC | `?category=&brand=&minPrice=&maxPrice=&inStock=&sort=&cursor=&limit=&zone=` |
| `GET` | `/api/v1/products/[slug]` | PUBLIC | Detail: variants, images, specs, store, delivery estimate, rating summary |
| `GET` | `/api/v1/products/[id]/availability` | PUBLIC | Live stock + price. Short TTL — this is the endpoint the product page trusts, not the ISR payload |
| `GET` | `/api/v1/products/[id]/related` | PUBLIC | |
| `GET` | `/api/v1/products/[id]/reviews` | PUBLIC | Approved only, paginated |
| `GET` | `/api/v1/search?q=` | PUBLIC | Products + categories + suggestions (**[D-21]**) |
| `GET` | `/api/v1/search/suggestions?q=` | PUBLIC | Typeahead, cached |
| `GET` | `/api/v1/home-layout?zone=` | PUBLIC | CMS-driven section list for the homepage |
| `GET` | `/api/v1/offers` | PUBLIC | Active coupons + promotions for the zone |
| `GET` | `/api/v1/banners?placement=&zone=` | PUBLIC | |

---

## 5. Customer: cart, favorites, addresses

Cart mutations are Server Actions from our UI; the endpoints below exist for the client drawer and future clients.

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/cart` | GUEST-OK | Cart with **server-recomputed** totals, stock warnings, price-change warnings, applicable coupon state |
| `POST` | `/api/v1/cart/items` | GUEST-OK | `{ variantId, quantity }`. Rejects unavailable products with `PRODUCT_UNAVAILABLE` — never silently adds (master spec §10) |
| `PATCH` | `/api/v1/cart/items/[itemId]` | GUEST-OK | Quantity change; validated against stock |
| `DELETE` | `/api/v1/cart/items/[itemId]` | GUEST-OK | |
| `DELETE` | `/api/v1/cart` | GUEST-OK | Clear |
| `POST` | `/api/v1/cart/coupon` | CUSTOMER | Apply; returns itemized discount or a precise reason for rejection |
| `DELETE` | `/api/v1/cart/coupon` | CUSTOMER | |
| `POST` | `/api/v1/cart/merge` | CUSTOMER | Merge guest cart into user cart on login |
| `POST` | `/api/v1/cart/quote` | GUEST-OK | **The authoritative pricing call.** Given address/zone + coupon, returns the full breakup: gross, item discount, coupon discount, tax, delivery fee, packaging, service fee, total, min-order status, free-delivery gap, ETA |
| `GET` | `/api/v1/favorites` | CUSTOMER | |
| `POST` | `/api/v1/favorites` | CUSTOMER | |
| `DELETE` | `/api/v1/favorites/[productId]` | CUSTOMER | |
| `GET` | `/api/v1/addresses` | CUSTOMER | |
| `POST` | `/api/v1/addresses` | CUSTOMER | Resolves and stores the delivery zone |
| `PATCH` | `/api/v1/addresses/[id]` | CUSTOMER (owner) | |
| `DELETE` | `/api/v1/addresses/[id]` | CUSTOMER (owner) | Soft delete; existing orders keep their address snapshot |
| `POST` | `/api/v1/addresses/[id]/default` | CUSTOMER (owner) | |

`/cart/quote` exists so cart, checkout, order creation and admin re-quoting all get numbers from exactly one code path. The client never computes a total it then sends back.

---

## 6. Checkout, orders, payments

| Method | Path | Access | Purpose |
|---|---|---|---|
| `POST` | `/api/v1/checkout/validate` | CUSTOMER | Pre-flight: serviceability, store open, min order, stock, coupon still valid, address complete. Returns a list of blocking issues rather than one error |
| `POST` | `/api/v1/orders` | CUSTOMER | **Idempotency-Key required.** Creates the order in a transaction: recomputes pricing server-side, reserves stock, records coupon usage, writes status history, creates the payment intent. Returns `{ order, payment: { providerRef, clientPayload } }` |
| `GET` | `/api/v1/orders` | CUSTOMER | Own orders, paginated |
| `GET` | `/api/v1/orders/[id]` | CUSTOMER (owner) | Detail + timeline + payment + delivery summary |
| `GET` | `/api/v1/orders/[id]/track` | CUSTOMER (owner) | Lightweight polling payload: status, ETA, driver first name + masked phone, coarse driver position if permitted (**[D-22]**, **[D-29]**) |
| `POST` | `/api/v1/orders/[id]/cancel` | CUSTOMER (owner) | Allowed only per the policy table (**[D-19]**); returns the refund outcome |
| `POST` | `/api/v1/orders/[id]/reorder` | CUSTOMER (owner) | Builds a new cart, reporting items no longer available |
| `GET` | `/api/v1/orders/[id]/invoice` | CUSTOMER (owner) | Signed, short-lived private-bucket URL |
| `POST` | `/api/v1/orders/[id]/review` | CUSTOMER (owner) | Delivered orders only |
| `POST` | `/api/v1/payments/intent` | CUSTOMER | Re-create a payment intent for a failed/pending order (recovery) |
| `GET` | `/api/v1/payments/[id]/status` | CUSTOMER (owner) | Server-verified status. The client **must** poll this rather than trusting the provider SDK callback |

### 6.1 Webhooks

| Method | Path | Auth |
|---|---|---|
| `POST` | `/api/v1/webhooks/payments/[provider]` | Provider HMAC signature over the **raw** body |
| `POST` | `/api/v1/webhooks/sms/[provider]` | Provider signature — delivery receipts |
| `POST` | `/api/v1/webhooks/email/[provider]` | Provider signature — bounces/complaints |

Webhook handler contract, in order:

1. Read the **raw** body before any JSON parsing (signature is computed over raw bytes).
2. Verify HMAC with the environment secret; timing-safe comparison. Invalid → `401`, logged as a security event.
3. Enforce a timestamp freshness window to blunt replay.
4. Insert `payment_events` with a unique `provider_event_id`. Duplicate → return `200` immediately (idempotent replay).
5. Process in a transaction: mark payment, transition order, release/commit stock.
6. Enqueue notifications and analytics **after** commit.
7. Return `200` quickly. Unexpected internal failures return `5xx` so the provider retries; validation failures return `200` to stop pointless retries of an unprocessable event, having logged it.

The webhook is the only trusted source of payment truth (master spec §22).

---

## 7. Vendor endpoints

Every endpoint is implicitly scoped to the authenticated vendor. **A `vendorId` in a request body is never trusted** — scope comes from the session.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/vendor/overview` | Today's orders/sales, pending/preparing counts, low stock, earnings, store status |
| `GET` | `/api/v1/vendor/orders?status=&cursor=` | Order queue |
| `GET` | `/api/v1/vendor/orders/[id]` | Detail with **operationally-limited** customer data (master spec §14) |
| `POST` | `/api/v1/vendor/orders/[id]/accept` | → `ACCEPTED` |
| `POST` | `/api/v1/vendor/orders/[id]/reject` | `{ reason }` required → `CANCELLED` |
| `POST` | `/api/v1/vendor/orders/[id]/preparing` | → `PREPARING` |
| `POST` | `/api/v1/vendor/orders/[id]/ready` | → `READY_FOR_PICKUP`, triggers dispatch |
| `GET` | `/api/v1/vendor/products?…` | |
| `POST` | `/api/v1/vendor/products` | Create (may require admin review) |
| `PATCH` | `/api/v1/vendor/products/[id]` | |
| `DELETE` | `/api/v1/vendor/products/[id]` | Soft delete; blocked if in an active order |
| `POST` | `/api/v1/vendor/products/[id]/images` | Upload authorization → public bucket |
| `DELETE` | `/api/v1/vendor/products/[id]/images/[imageId]` | |
| `POST` | `/api/v1/vendor/products/bulk-import` | Queued; returns a job id |
| `GET` | `/api/v1/vendor/products/bulk-import/[jobId]` | Job status + row-level errors |
| `POST` | `/api/v1/vendor/products/bulk-price` | Queued bulk price update |
| `GET` | `/api/v1/vendor/products/export` | Queued export → signed URL |
| `GET` | `/api/v1/vendor/inventory?lowStock=` | |
| `PATCH` | `/api/v1/vendor/inventory/[variantId]` | Writes an `inventory_transactions` row, never a bare quantity overwrite |
| `GET`/`PATCH` | `/api/v1/vendor/store` | Profile, min order, prep time |
| `PATCH` | `/api/v1/vendor/store/availability` | Open/close, `closedUntil` |
| `GET`/`PUT` | `/api/v1/vendor/store/hours` | |
| `GET` | `/api/v1/vendor/analytics?from=&to=` | |
| `GET` | `/api/v1/vendor/payouts` | |
| `GET` | `/api/v1/vendor/documents` | Signed private reads |
| `POST` | `/api/v1/vendor/documents` | Upload authorization → private bucket |
| `GET`/`POST` | `/api/v1/vendor/bank-accounts` | Masked on read |
| `POST` | `/api/v1/vendor/apply` | Public application (from `/vendor-registration`) |

---

## 8. Driver endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/driver/overview` | Availability, today's deliveries/earnings, active delivery |
| `PATCH` | `/api/v1/driver/availability` | `{ availability }`. Blocked with a clear reason if documents are expired or the driver is unapproved |
| `GET` | `/api/v1/driver/deliveries/available` | Current offers (polling) |
| `POST` | `/api/v1/driver/deliveries/[id]/accept` | Race-safe: first accept wins, others get `409 ASSIGNMENT_TAKEN` |
| `POST` | `/api/v1/driver/deliveries/[id]/decline` | `{ reason }` |
| `GET` | `/api/v1/driver/deliveries/active` | Active delivery with pickup/drop detail and masked customer phone |
| `POST` | `/api/v1/driver/deliveries/[id]/reached-store` | |
| `POST` | `/api/v1/driver/deliveries/[id]/pickup` | Confirm pickup → order `PICKED_UP` |
| `POST` | `/api/v1/driver/deliveries/[id]/reached-customer` | |
| `POST` | `/api/v1/driver/deliveries/[id]/deliver` | **Idempotency-Key required.** `{ otp? , proofKey?, recipientName? }` per **[D-20]**; COD collection per **[D-12]** |
| `POST` | `/api/v1/driver/deliveries/[id]/fail` | `{ reason }` |
| `POST` | `/api/v1/driver/deliveries/[id]/proof` | Upload authorization → private bucket |
| `POST` | `/api/v1/driver/location` | Coarse location ping while on an active delivery only; retention per **[D-29]**. Ignored when offline |
| `GET` | `/api/v1/driver/history?cursor=` | |
| `GET` | `/api/v1/driver/earnings?from=&to=` | Ledger + summary |
| `GET`/`POST` | `/api/v1/driver/documents` | |
| `POST` | `/api/v1/driver/apply` | Public application (from `/driver-registration`) |

Customer phone numbers are **masked by default** for drivers, revealed only for an active assignment, and every reveal is audited.

---

## 9. Admin endpoints

Every admin endpoint: permission check → action → **audit log write** in the same transaction. Destructive actions require an explicit `{ confirm: true, reason }`.

| Method | Path | Permission |
|---|---|---|
| `GET` | `/api/v1/admin/dashboard/kpis?from=&to=` | `dashboard:view` |
| `GET` | `/api/v1/admin/dashboard/charts?metric=&interval=` | `dashboard:view` |
| `GET` | `/api/v1/admin/orders?…` | `order:list` |
| `GET` | `/api/v1/admin/orders/[id]` | `order:view` |
| `POST` | `/api/v1/admin/orders/[id]/status` | `order:update_status` |
| `POST` | `/api/v1/admin/orders/[id]/cancel` | `order:cancel` |
| `POST` | `/api/v1/admin/orders/[id]/refund` | `refund:manage` — Idempotency-Key required |
| `POST` | `/api/v1/admin/orders/[id]/assign-driver` | `delivery:assign` |
| `POST` | `/api/v1/admin/orders/[id]/notes` | `order:note` |
| `GET` | `/api/v1/admin/orders/[id]/audit` | `audit:view` |
| `GET` | `/api/v1/admin/customers?…` | `customer:list` |
| `POST` | `/api/v1/admin/customers/[id]/status` | `customer:suspend` |
| `GET` | `/api/v1/admin/vendors?status=` | `vendor:list` |
| `POST` | `/api/v1/admin/vendors/[id]/approve` | `vendor:approve` |
| `POST` | `/api/v1/admin/vendors/[id]/reject` | `vendor:approve` — reason required |
| `POST` | `/api/v1/admin/vendors/[id]/suspend` | `vendor:suspend` |
| `POST` | `/api/v1/admin/vendors/[id]/documents/[docId]/review` | `vendor:kyc_review` |
| `GET`/`POST` | `/api/v1/admin/drivers…` (mirror of vendors) | `driver:*` |
| `GET` | `/api/v1/admin/products?…` | `product:list` |
| `POST` | `/api/v1/admin/products/[id]/approve` \| `/reject` | `product:approve` |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/v1/admin/categories…` | `category:manage` |
| `GET`/`PATCH` | `/api/v1/admin/inventory…` | `inventory:manage` |
| `GET` | `/api/v1/admin/deliveries?status=&zone=` | `delivery:view` |
| `POST` | `/api/v1/admin/deliveries/[id]/reassign` | `delivery:assign` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/zones…` | `zone:manage` |
| `GET` | `/api/v1/admin/payments?…` | `payment:view` |
| `POST` | `/api/v1/admin/payments/[id]/reconcile` | `payment:reconcile` |
| `GET`/`POST` | `/api/v1/admin/refunds…` | `refund:manage` |
| `GET`/`POST` | `/api/v1/admin/payouts…` | `payout:manage` |
| `GET`/`POST`/`PATCH`/`DELETE` | `/api/v1/admin/coupons…` | `coupon:manage` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/promotions…` | `promotion:manage` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/banners…` | `banner:manage` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/cms/pages…` | `cms:manage` |
| `GET`/`PUT` | `/api/v1/admin/cms/home-layout` | `cms:manage` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/cms/blog…` | `cms:manage` |
| `GET`/`POST`/`DELETE` | `/api/v1/admin/cms/redirects…` | `cms:manage` |
| `GET`/`POST` | `/api/v1/admin/reviews/[id]/moderate` | `review:moderate` |
| `GET` | `/api/v1/admin/tickets?…` | `ticket:list` |
| `POST` | `/api/v1/admin/tickets/[id]/reply` | `ticket:reply` — `isInternalNote` flag |
| `POST` | `/api/v1/admin/tickets/[id]/assign` \| `/status` | `ticket:manage` |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/notification-templates…` | `template:manage` |
| `POST` | `/api/v1/admin/campaigns` | `campaign:manage` — queued fan-out |
| `GET` | `/api/v1/admin/analytics?…` | `analytics:view` |
| `POST` | `/api/v1/admin/reports` | `report:view` — queued, returns job id |
| `GET` | `/api/v1/admin/reports/[jobId]` | `report:view` — signed download |
| `GET`/`PATCH` | `/api/v1/admin/settings…` | `setting:view` / `setting:manage` (`setting:manage_sensitive` for payment/refund/maintenance) |
| `GET`/`POST`/`PATCH` | `/api/v1/admin/roles…` | `role:manage` |
| `GET` | `/api/v1/admin/permissions` | `role:manage` |
| `POST` | `/api/v1/admin/users/[id]/roles` | `admin_user:manage` |
| `GET` | `/api/v1/admin/audit-logs?…` | `audit:view` — read-only, no mutation endpoints exist |
| `GET` | `/api/v1/admin/system/health` | `system:view` |
| `GET` | `/api/v1/admin/system/queues` | `system:view` — depth + dead-letter |
| `GET`/`PATCH` | `/api/v1/admin/feature-flags…` | `flag:manage` |

---

## 10. Shared endpoints

| Method | Path | Access | Purpose |
|---|---|---|---|
| `GET` | `/api/v1/notifications?cursor=` | AUTH | In-app notification centre |
| `POST` | `/api/v1/notifications/[id]/read` | AUTH (owner) | |
| `POST` | `/api/v1/notifications/read-all` | AUTH | |
| `GET`/`PATCH` | `/api/v1/notification-preferences` | AUTH | |
| `POST` | `/api/v1/push/subscribe` | AUTH | Web Push subscription (**[D-26]**) |
| `DELETE` | `/api/v1/push/subscribe` | AUTH | |
| `GET`/`POST` | `/api/v1/tickets` | AUTH | Own tickets |
| `GET`/`POST` | `/api/v1/tickets/[id]/messages` | AUTH (owner) | Internal notes filtered out at the repository layer |
| `POST` | `/api/v1/uploads/authorize` | AUTH | `{ purpose, fileName, mimeType, sizeBytes }` → scoped short-lived upload credential. Purpose determines bucket + permission + allowed types |
| `POST` | `/api/v1/uploads/confirm` | AUTH | Server re-validates the stored object and links it to its entity |
| `POST` | `/api/v1/analytics/events` | GUEST-OK | Batched client events, allowlisted names only, rate-limited |
| `GET` | `/api/v1/health` | PUBLIC | Liveness — no dependency checks, cheap |
| `GET` | `/api/v1/health/deep` | ADMIN or internal token | DB, cache, storage, queue depth, provider reachability |

Upload authorization is server-mediated by design: the browser never holds a bucket credential, and `purpose` is what prevents a customer from writing into the vendor-KYC path.

---

## 11. Error code catalogue (initial)

Stable codes the client is allowed to branch on.

| Domain | Codes |
|---|---|
| Auth | `INVALID_CREDENTIALS`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_MAX_ATTEMPTS`, `OTP_RATE_LIMITED`, `SESSION_EXPIRED`, `ACCOUNT_SUSPENDED`, `PHONE_ALREADY_REGISTERED` |
| Authorization | `UNAUTHENTICATED`, `FORBIDDEN`, `PERMISSION_REQUIRED`, `VENDOR_NOT_APPROVED`, `DRIVER_NOT_APPROVED`, `DRIVER_DOCUMENTS_EXPIRED` |
| Location | `PINCODE_NOT_SERVICEABLE`, `ADDRESS_OUTSIDE_ZONE`, `GEOCODE_FAILED` |
| Catalog | `PRODUCT_NOT_FOUND`, `PRODUCT_UNAVAILABLE`, `VARIANT_INACTIVE`, `STORE_CLOSED` |
| Cart | `CART_EMPTY`, `INSUFFICIENT_STOCK`, `QUANTITY_LIMIT_EXCEEDED`, `MIXED_VENDOR_CART` (**[D-11]**), `PRICE_CHANGED` |
| Coupon | `COUPON_NOT_FOUND`, `COUPON_EXPIRED`, `COUPON_INACTIVE`, `COUPON_MIN_CART_NOT_MET`, `COUPON_USAGE_LIMIT_REACHED`, `COUPON_USER_LIMIT_REACHED`, `COUPON_NOT_APPLICABLE`, `COUPON_FIRST_ORDER_ONLY`, `COUPON_ZONE_RESTRICTED` |
| Checkout/Order | `MIN_ORDER_NOT_MET`, `ADDRESS_REQUIRED`, `ORDER_NOT_FOUND`, `INVALID_STATUS_TRANSITION`, `ORDER_NOT_CANCELLABLE`, `IDEMPOTENCY_KEY_REUSED`, `REQUEST_IN_PROGRESS` |
| Payment | `PAYMENT_FAILED`, `PAYMENT_ALREADY_CAPTURED`, `WEBHOOK_SIGNATURE_INVALID`, `REFUND_EXCEEDS_PAYMENT`, `PROVIDER_UNAVAILABLE` |
| Delivery | `ASSIGNMENT_TAKEN`, `ASSIGNMENT_EXPIRED`, `DELIVERY_OTP_INVALID`, `PROOF_REQUIRED`, `DRIVER_OFFLINE` |
| Upload | `FILE_TOO_LARGE`, `MIME_TYPE_NOT_ALLOWED`, `UPLOAD_PURPOSE_INVALID` |
| Generic | `VALIDATION_FAILED`, `RATE_LIMITED`, `NOT_FOUND`, `CONFLICT`, `INTERNAL_ERROR`, `MAINTENANCE_MODE` |

---

## 12. Contract testing and documentation

- Zod schemas are the single source of truth for every request/response. Types are inferred, never hand-duplicated.
- OpenAPI is **generated** from the Zod schemas rather than maintained by hand, so it cannot drift.
- Integration tests assert the envelope shape, status code and `code` value for both the happy path and each documented failure of every endpoint that touches money, stock or permissions.
- Provider adapters have contract tests against recorded fixtures so a provider swap (**[D-13]**, **[D-24]**, **[D-25]**) is verifiable without hitting a live sandbox.

---

## 13. Open API-level decisions

| # | Question | Impact |
|---|---|---|
| **[D-11]** | Multi-vendor cart | Whether `/cart` returns one group or many; whether `POST /orders` creates 1 or N orders |
| **[D-12]** | COD | `POST /orders` response flow, driver COD collection fields |
| **[D-13]** | Payment provider | `clientPayload` shape, webhook event names, refund semantics |
| **[D-16]** | Inventory | Whether `POST /orders` reserves stock or merely validates |
| **[D-18]** | Dispatch | Whether `/driver/deliveries/available` is an offer queue or an open pool |
| **[D-20]** | Proof | Required fields on `/deliveries/[id]/deliver` |
| **[D-22]** | Tracking | Whether `/orders/[id]/track` stays polling or becomes SSE/WebSocket |
| **[D-29]** | Location retention | Whether `POST /driver/location` persists a trail at all |
