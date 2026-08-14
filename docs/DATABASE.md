# Parthik — Database Design

**Status:** **APPROVED** design · **Version:** 1.1 · **Revised:** 2026-08-14 (Google-first services)
**Depends on:** [`ARCHITECTURE.md` §16](./ARCHITECTURE.md#16-approved-decisions)
**ORM:** Drizzle (D-02) · **Host:** managed PostgreSQL behind Hyperdrive (D-01)

> This is a logical schema. Column lists are indicative of intent, not final DDL.
>
> **Migrations are explicitly NOT generated yet**, by instruction. This document is the design that migrations will be generated *from*, once TASK 002 is authorized.
>
> **One area remains deliberately inert:** tax columns exist but carry no logic, because **D-14 (GST/tax) is BLOCKED** and no tax assumption may be implemented. See §6.4.

---

## 1. Conventions

| Concern | Rule |
|---|---|
| Engine | PostgreSQL 16+ |
| Primary keys | `id` — ULID/UUIDv7 stored as `uuid`. Time-sortable, safe to expose, no sequence leakage of business volume |
| Human references | Separate short display codes where users must speak them aloud: `order.order_number` (e.g. `PK-2026-000123`), `ticket.ticket_number`. Unique, generated server-side |
| Timestamps | `created_at`, `updated_at` — `timestamptz`, always UTC. Rendered in IST at the presentation edge only |
| Actor columns | `created_by`, `updated_by` → `users.id` on every state-changing entity (master spec §6) |
| Soft delete | `deleted_at timestamptz NULL` on catalog, CMS, vendor, driver, address, coupon, banner, user. **Never** on financial/ledger rows (orders, order items, payments, refunds, status history, audit, earnings) — those are corrected by new rows, never erased |
| Money | Integer **paise** (`bigint`). Never `float`/`numeric` for currency. Every money column is paired with an `INR` currency assumption recorded once in settings |
| Percentages | `numeric(5,2)` (e.g. tax rate, commission rate) |
| Coordinates | `latitude numeric(9,6)`, `longitude numeric(9,6)`. PostGIS `geography` column reserved pending **[D-17]** |
| Enums | Postgres native `enum` types for closed sets that change only by deploy; lookup tables where admins must add values at runtime |
| JSON | `jsonb` only for genuinely open-ended structures (CMS layout, provider payloads, audit diffs, notification variables). Never for data we need to query/aggregate relationally |
| Naming | `snake_case` tables and columns, singular column names, plural table names |
| Indexes | Every FK indexed. Composite indexes ordered by selectivity for the actual query. Partial indexes for `deleted_at IS NULL` and active-record lookups |
| Optimistic locking | `version integer` on `orders`, `products`, `inventory` — guards concurrent admin/vendor edits |
| Deletion of users | Anonymize-in-place (PII scrubbed, row retained) rather than hard delete, so order history and accounting stay intact |

### 1.1 Money column pattern

Any table storing an amount uses the explicit, auditable pattern rather than a single computed total:

```text
gross_amount_paise        item price × qty, pre-discount
item_discount_paise       product/promotion level
coupon_discount_paise     coupon level, allocated across lines
taxable_amount_paise
tax_amount_paise
delivery_fee_paise
packaging_fee_paise
service_fee_paise
total_amount_paise        the single number the customer pays
```

Totals are recomputed by the `pricing` module and stored as a **snapshot** on the order. Orders never recompute historically — a price change tomorrow must not alter yesterday's invoice.

---

## 2. Enum types

```text
user_status              PENDING | ACTIVE | SUSPENDED | BANNED | DELETED
auth_method              PHONE_OTP | EMAIL_PASSWORD | EMAIL_OTP
role_key                 CUSTOMER | VENDOR_OWNER | VENDOR_STAFF | DRIVER
                         | ADMIN | ADMIN_SUPPORT | ADMIN_OPS | ADMIN_FINANCE | SUPER_ADMIN
otp_purpose              LOGIN | SIGNUP | PHONE_VERIFY | EMAIL_VERIFY
                         | ORDER_DELIVERY | PASSWORD_RESET
address_type             HOME | WORK | OTHER
kyc_status               NOT_SUBMITTED | PENDING | APPROVED | REJECTED | EXPIRED
vendor_status            APPLIED | UNDER_REVIEW | APPROVED | REJECTED | SUSPENDED
store_status             OPEN | CLOSED | TEMPORARILY_CLOSED | OFFLINE_BY_ADMIN
product_status           DRAFT | PENDING_REVIEW | ACTIVE | INACTIVE | REJECTED | ARCHIVED
inventory_txn_type       PURCHASE | SALE | RESERVE | RELEASE | ADJUSTMENT
                         | RETURN | DAMAGE | CANCELLATION
order_status             PENDING_PAYMENT | CONFIRMED | ACCEPTED | PREPARING
                         | READY_FOR_PICKUP | ASSIGNED | PICKED_UP | OUT_FOR_DELIVERY
                         | DELIVERED | CANCELLED | PAYMENT_FAILED | REFUNDED
                         | RETURNED | FAILED_DELIVERY
payment_method           UPI | CARD | COD                  -- D-12 approved: UPI + Card + COD
                         -- NETBANKING/WALLET reserved; not offered in V1
payment_status           CREATED | PENDING | AUTHORIZED | PAID | FAILED
                         | CANCELLED | PARTIALLY_REFUNDED | REFUNDED
refund_status            INITIATED | PROCESSING | COMPLETED | FAILED
coupon_type              FLAT | PERCENTAGE | FREE_DELIVERY
promotion_type           BUY_X_GET_Y | CATEGORY_DISCOUNT | VENDOR_CAMPAIGN
                         | FLASH_SALE | FREE_DELIVERY | NEW_CUSTOMER
discount_scope           CART | CATEGORY | PRODUCT | VENDOR | DELIVERY
driver_status            APPLIED | UNDER_REVIEW | APPROVED | REJECTED | SUSPENDED
driver_availability      OFFLINE | ONLINE | ON_DELIVERY | ON_BREAK
delivery_status          PENDING_ASSIGNMENT | OFFERED | ASSIGNED | EN_ROUTE_TO_STORE
                         | AT_STORE | PICKED_UP | EN_ROUTE_TO_CUSTOMER | AT_CUSTOMER
                         | DELIVERED | FAILED | CANCELLED | RETURNED_TO_STORE
proof_type               OTP | PHOTO | SIGNATURE | CUSTOMER_CONFIRMATION
notification_channel     PUSH | IN_APP          -- active in V1 (D-26 FCM)
                         | EMAIL | SMS | WHATSAPP   -- reserved; EMAIL blocked D-25, SMS blocked D-34
notification_status      QUEUED | SENT | DELIVERED | FAILED | READ
review_status            PENDING | APPROVED | REJECTED | HIDDEN
ticket_status            OPEN | IN_PROGRESS | WAITING_ON_CUSTOMER | RESOLVED | CLOSED
ticket_priority          LOW | MEDIUM | HIGH | URGENT
ticket_category          PAYMENT | DELIVERY | PRODUCT | REFUND | COUPON
                         | ACCOUNT | VENDOR | OTHER
audit_action             CREATE | UPDATE | DELETE | LOGIN | LOGOUT | STATUS_CHANGE
                         | APPROVE | REJECT | REFUND | ASSIGN | EXPORT | SETTING_CHANGE
                         | CASH_DEPOSIT_VERIFY | PII_REVEAL

-- added by approved decisions
locale_code              en | hi                    -- D-33, extensible
cash_entry_type          COLLECTION | DEPOSIT | ADJUSTMENT | WRITE_OFF   -- D-12
cash_deposit_status      DECLARED | VERIFIED | REJECTED | PARTIAL        -- D-12
cash_deposit_method      BANK_TRANSFER | OFFICE_CASH | UPI               -- D-12
dispatch_mode            AUTO_NEAREST | BROADCAST | MANUAL               -- D-18
```

---

## 3. Identity domain

### `users`
Central identity. One row per human, regardless of how many roles they hold.

```text
id,
firebase_uid (unique, NOT NULL),        -- D-08: Firebase Authentication is the identity provider
phone (unique, nullable), phone_verified_at,
email (unique, nullable), email_verified_at,
-- NO password_hash. D-09: Firebase Phone Auth only, no passwords in V1.
full_name, preferred_locale ('en'|'hi', default 'en'),   -- D-33
status user_status, last_login_at,
created_at, updated_at, deleted_at, anonymized_at
```
Constraint: at least one of `phone`/`email` present. Indexes: **unique on `firebase_uid`** (the primary lookup on every sign-in), unique on `lower(email)`, unique on `phone`, index on `status`.

**`firebase_uid` is the join key between Firebase and Parthik.** It is written once at first sign-in from the *verified* token, never from client input, and never changes. Phone and email are mirrored from the verified token for display and operational contact — Firebase remains authoritative for the credential, Parthik for everything else.

**Roles are never stored in Firebase custom claims.** `user_roles` in PostgreSQL is the only source of authorization truth, because roles are vendor-scoped, auditable and must change without an external round-trip.

### `roles` / `permissions` / `role_permissions` / `user_roles`
Permission-based RBAC (see [`SECURITY.md` §5](./SECURITY.md)).

```text
roles            id, key role_key, name, description, is_system, created_at
permissions      id, key (e.g. 'order:refund'), resource, action, description
role_permissions role_id, permission_id                        -- PK (role_id, permission_id)
user_roles       id, user_id, role_id, scope_type (GLOBAL|VENDOR|STORE),
                 scope_id (nullable), granted_by, granted_at, revoked_at
```
`scope_type`/`scope_id` is what makes vendor staff possible: the same `VENDOR_STAFF` role scoped to different vendors. Unique partial index on `(user_id, role_id, scope_id) WHERE revoked_at IS NULL`.

### `sessions`
Server-side sessions, revocable (master spec §23).

```text
id, user_id, token_hash (unique), active_role_id, device_id,
firebase_token_issued_at,        -- audit trail of which Firebase sign-in created this session
ip_hash, user_agent, expires_at, last_seen_at, revoked_at, revoked_reason, created_at
```
Only the **hash** of the session token is stored. Index on `user_id`, `expires_at`.

Created by exchanging a verified Firebase ID token (D-10). The Firebase token is **not** retained — only the fact and time of the sign-in that produced this session, so an incident can be traced back to a Firebase auth event.

### `otp_verifications`
**Scope reduced by D-24.** Login/signup OTP is now generated, delivered and verified entirely by **Firebase Phone Authentication** — we neither store nor see those codes. This table is retained **only for delivery OTP (D-20)** and any future non-Firebase OTP need.

```text
id, user_id (nullable), destination (phone), channel,
purpose otp_purpose,          -- V1 uses ORDER_DELIVERY only
code_hash, attempts, max_attempts,
expires_at, consumed_at, ip_hash, created_at
```
Codes are hashed, never stored in plaintext, never logged. Index on `(destination, purpose, created_at desc)` for throttling.

> `otp_purpose` values `LOGIN`, `SIGNUP`, `PHONE_VERIFY`, `PASSWORD_RESET` become **unused in V1** — Firebase owns those paths and passwords do not exist. They stay in the enum for future use rather than being removed.

### `login_attempts`
```text
id, identifier, identifier_type, ip_hash, success boolean,
failure_reason, user_agent, created_at
```
Feeds lockout and abuse detection. Index on `(identifier, created_at desc)` and `(ip_hash, created_at desc)`. Retention-limited by cron.

**Records the token-exchange step**, not the OTP entry itself: Firebase handles OTP attempts, so what we can observe and rate-limit is `POST /auth/session` — successful and failed ID-token exchanges. Firebase's own abuse signals are not visible to us, which is a monitoring blind spot worth knowing (see [`SECURITY.md` §6](./SECURITY.md)).

### `devices`
FCM registration tokens rotate, so `fcm_token_updated_at` drives cleanup of stale tokens (FCM rejects them and we must prune rather than retry forever). `push_permission` is stored because with email and SMS blocked, **knowing which users are unreachable is operationally important** — see [`ARCHITECTURE.md` §11.3](./ARCHITECTURE.md#113-notifications).
```text
id, user_id, device_fingerprint, platform,
fcm_token (nullable), fcm_token_updated_at,     -- D-26: Firebase Cloud Messaging
push_permission (GRANTED|DENIED|DEFAULT),
last_active_at, is_trusted, created_at, revoked_at
```

---

## 4. Customer domain

### `customer_profiles`
```text
id, user_id (unique), date_of_birth (nullable), gender (nullable),
default_address_id, referral_code (unique, nullable), acquisition_source,
total_orders, lifetime_value_paise, created_at, updated_at
```
`total_orders`/`lifetime_value_paise` are denormalized counters maintained transactionally, so admin lists don't aggregate the order table on every page load.

### `addresses`
```text
id, user_id, label, address_type, recipient_name, recipient_phone,
line1, line2, landmark, city, state, pincode, country default 'IN',
latitude, longitude, delivery_zone_id (nullable, resolved at save),
is_default, delivery_instructions, created_at, updated_at, deleted_at
```
Index on `(user_id) WHERE deleted_at IS NULL`, index on `pincode`. Partial unique index enforcing one default per user.

### `wishlists` / `wishlist_items`
```text
wishlists       id, user_id (unique for the default list), name, created_at
wishlist_items  id, wishlist_id, product_id, variant_id (nullable), created_at
                -- unique (wishlist_id, product_id, variant_id)
```

### `customer_notification_preferences`
```text
id, user_id, channel notification_channel, category (ORDER|PROMOTION|ACCOUNT|SUPPORT),
enabled boolean, updated_at        -- unique (user_id, channel, category)
```
Transactional order notifications are not opt-out-able; only `PROMOTION` respects this fully.

---

## 5. Marketplace domain

### `vendors`
```text
id, owner_user_id, business_name, legal_name, slug (unique),
status vendor_status, gstin (nullable), pan (nullable), fssai_license (nullable),
contact_phone, contact_email,
commission_rate numeric(5,2),        -- D-15: used for CALCULATION only, never auto-settlement
approved_at, approved_by, rejection_reason, suspended_at, suspension_reason,
created_at, updated_at, deleted_at
```

### `vendor_users`
Links additional staff to a vendor. Actual capabilities come from `user_roles` scoped to the vendor.
```text
id, vendor_id, user_id, designation, invited_by, invited_at, accepted_at, removed_at
```

### `vendor_documents`
```text
id, vendor_id, doc_type (GST|PAN|FSSAI|SHOP_LICENSE|ADDRESS_PROOF|CANCELLED_CHEQUE),
storage_key (private R2), file_name, mime_type, size_bytes,
kyc_status, reviewed_by, reviewed_at, rejection_reason, expires_at, created_at
```
`storage_key` points at the **private** bucket; access is always via a permission-checked signed URL.

### `vendor_bank_accounts`
```text
id, vendor_id, account_holder_name, account_number_encrypted,
account_number_last4, ifsc, bank_name, is_verified, verified_at,
is_primary, created_at, updated_at, deleted_at
```
Full account number encrypted at rest; only `last4` is readable in the UI. Admin reveal is an audited action.

### `stores`
One store per vendor in V1 UI, N supported by schema (**[D-32]**).
```text
id, vendor_id, name, slug (unique), status store_status,
description, logo_key, banner_key,
line1, line2, city, state, pincode, latitude, longitude,
delivery_radius_km (nullable),                       -- D-17 approved: pincode + radius
cod_enabled boolean default true,                    -- D-12: per-store COD switch
min_order_paise, avg_prep_time_minutes, rating_avg, rating_count,
is_accepting_orders, closed_until, created_at, updated_at, deleted_at
```

### `store_hours`
```text
id, store_id, day_of_week (0–6), opens_at time, closes_at time, is_closed boolean
-- multiple rows per day allow split shifts (lunch/dinner)
```

### `store_delivery_zones`
```text
store_id, delivery_zone_id        -- PK both; which zones a store serves
```

### `delivery_zones`
Shape depends on **[D-17]**; columns below cover pincode + radius with a PostGIS path reserved.
```text
id, name, code (unique), city, state, is_active,
center_latitude, center_longitude, radius_km (nullable),
polygon geography(Polygon) (nullable — reserved),
base_delivery_fee_paise, free_delivery_threshold_paise,
min_order_paise, per_km_fee_paise (nullable), max_delivery_fee_paise (nullable),
avg_delivery_minutes, created_at, updated_at
```

### `zone_pincodes`
```text
id, delivery_zone_id, pincode, is_active     -- unique (pincode) while active
```
Serviceability lookup is a single indexed hit on `pincode`, cached for 1 h and re-verified at checkout.

### `categories`
Self-referencing tree, covering both category and subcategory from master spec §6.
```text
id, parent_id (nullable), slug (unique),
-- name/description live in category_translations (D-33)
icon_key, image_key, display_order, is_active, is_featured,
seo_meta_id (nullable), created_at, updated_at, deleted_at
```
Index on `(parent_id, display_order)`, unique on `slug`. Depth is limited to 2 levels in V1 by application rule.

### `brands`
```text
id, slug (unique), logo_key, is_active, created_at, updated_at, deleted_at
-- name lives in brand_translations (D-33)
```

### `products`
```text
id, vendor_id, store_id, category_id, brand_id (nullable),
slug (unique),
-- name/short_description/description/specifications live in product_translations (D-33)
status product_status, is_featured, is_popular,
unit_label (e.g. '500 g', '1 L'),
hsn_code (nullable),                 -- D-14 BLOCKED: column exists, stays NULL, no logic reads it
tax_rate (nullable), is_tax_inclusive boolean,
mrp_paise, price_paise, cost_paise (nullable, vendor-private),
rating_avg, rating_count, view_count, sold_count,
search_vector_en tsvector (generated, 'english' config),
search_vector_hi tsvector (generated, 'simple' config),   -- D-33/C-2: no Hindi stemmer exists
seo_meta_id, version, published_at,
created_at, created_by, updated_at, updated_by, deleted_at
```
Indexes: unique `slug`; `(store_id, status)`; `(category_id, status)`; GIN on `search_vector_en` and `search_vector_hi`; trigram index on `product_translations.name`; partial `(status) WHERE deleted_at IS NULL AND status='ACTIVE'`.

`price_paise` must always be `<= mrp_paise` (check constraint) so discount display can never be nonsense.

### `product_variants`
```text
id, product_id, sku (unique per vendor),
-- name/variant_label live in product_variant_translations (D-33)
mrp_paise, price_paise, unit_label, is_default, display_order,
is_active, created_at, updated_at, deleted_at
```
Every product has at least one variant (a default) so cart/inventory logic has exactly one code path.

### `product_images`
```text
id, product_id, variant_id (nullable), storage_key (public R2),
alt_text, display_order, is_primary, width, height, created_at
```
`alt_text` is required by the accessibility rule (master spec §26).

### `inventory`
```text
id, variant_id (unique), store_id,
quantity_available, quantity_reserved, low_stock_threshold,
track_inventory boolean, allow_backorder boolean,
updated_at, version
```
Semantics pending **[D-16]**. Row-level `FOR UPDATE` locking on reserve/release.

### `inventory_transactions`
Append-only ledger; current quantity must always be reproducible from it.
```text
id, variant_id, store_id, txn_type inventory_txn_type,
quantity_delta, quantity_after, reference_type (ORDER|MANUAL|IMPORT|RETURN),
reference_id, reason, created_by, created_at
```
Index on `(variant_id, created_at desc)`, `(reference_type, reference_id)`.

---

## 6. Commerce domain

### `carts`
```text
id, user_id (nullable — guest), guest_token (nullable), store_id (nullable),
delivery_zone_id, address_id (nullable), applied_coupon_id (nullable),
currency default 'INR', last_priced_at, expires_at,
created_at, updated_at
```
Single-vendor vs multi-vendor cart is **[D-11]**; `store_id` here assumes single-vendor. Cart **totals are never trusted from the client** and are recomputed on read.

### `cart_items`
```text
id, cart_id, product_id, variant_id, quantity,
unit_price_paise_snapshot, added_at, updated_at
-- unique (cart_id, variant_id)
```
The snapshot exists to **detect** price change since add-to-cart and warn the customer; the authoritative price at checkout is re-read from `product_variants`.

### `coupons`
Covers every rule in master spec §18.
```text
id, code (unique, uppercase), name, description,
coupon_type, discount_value, max_discount_paise,
min_cart_paise, scope discount_scope,
first_order_only, is_user_specific,
usage_limit_total, usage_limit_per_user, used_count,
valid_from, valid_until, is_active, is_stackable,
created_by, created_at, updated_at, deleted_at
```

### `coupon_restrictions`
Keeps coupon scoping relational and queryable instead of a JSON blob.
```text
id, coupon_id, restriction_type (CATEGORY|PRODUCT|VENDOR|ZONE|USER),
restriction_id      -- unique (coupon_id, restriction_type, restriction_id)
```

### `coupon_usages`
```text
id, coupon_id, user_id, order_id, discount_applied_paise, used_at
-- unique (coupon_id, order_id); index (coupon_id, user_id) for per-user limit
```
The unique constraint is what makes per-user limits race-safe rather than advisory.

### `promotions` / `promotion_rules`
```text
promotions       id, name, promotion_type, description, banner_id (nullable),
                 priority, valid_from, valid_until, is_active,
                 zone_scope, created_by, created_at, updated_at, deleted_at
promotion_rules  id, promotion_id, rule_key, rule_value jsonb
```
Promotion stacking order is resolved by `priority`, evaluated by the `pricing` module, and unit-tested.

### `orders`
The financial snapshot. Never mutated in a way that loses history.
```text
id, order_number (unique), user_id, store_id, vendor_id,
status order_status,
delivery_address_snapshot jsonb,      -- frozen copy: addresses can change/be deleted
contact_phone, contact_name,
delivery_zone_id,
gross_amount_paise, item_discount_paise, coupon_id (nullable),
coupon_code_snapshot, coupon_discount_paise,
taxable_amount_paise, tax_amount_paise,
delivery_fee_paise, packaging_fee_paise, service_fee_paise,
total_amount_paise, currency,
payment_method, payment_status,
is_cod boolean default false,                 -- D-12 approved
cod_amount_paise (nullable),                  -- amount to collect at door
placed_at, confirmed_at, accepted_at, ready_at,
delivered_at, cancelled_at,
cancellation_reason, cancelled_by_role,
estimated_delivery_at, actual_delivery_minutes,
customer_note, internal_note,
idempotency_key (unique), source (WEB|PWA|ADMIN),
vendor_payout_paise, platform_commission_paise,   -- D-15: calculated, settled manually
version, created_at, updated_at
```
Indexes: unique `order_number`, unique `idempotency_key`, `(user_id, created_at desc)`, `(store_id, status)`, `(status, created_at)`, `(delivery_zone_id, created_at)`.

The address **snapshot** is deliberate: an order must remain readable and disputable even if the customer later edits or deletes that address.

### `order_items`
```text
id, order_id, product_id, variant_id,
product_name_snapshot, variant_label_snapshot, image_key_snapshot,
unit_label_snapshot, hsn_snapshot, sku_snapshot,
quantity, mrp_paise, unit_price_paise,
item_discount_paise, tax_rate, tax_amount_paise, line_total_paise,
vendor_payout_paise, created_at
```
Everything is snapshotted. A product rename, reprice or delete must never alter a historical invoice.

### `order_status_history`
```text
id, order_id, from_status, to_status, changed_by_user_id (nullable),
changed_by_role, reason, note, metadata jsonb, created_at
```
Every transition, without exception (master spec §13). Append-only. Index `(order_id, created_at)`.

### `payments`
```text
id, order_id, provider, provider_payment_id (nullable),
provider_order_id (nullable), method payment_method,
amount_paise, currency, status payment_status,
idempotency_key (unique), failure_code, failure_message,
authorized_at, paid_at, failed_at,
reconciled_at, reconciliation_note, created_at, updated_at
```
Index on `provider_payment_id`, `(status, created_at)` for the reconciliation job.

### `payment_events`
Raw provider interaction log — the evidence trail for disputes.
```text
id, payment_id (nullable), provider, event_type, provider_event_id (unique),
raw_payload jsonb, signature, signature_valid boolean,
processed_at, processing_error, received_at
```
`provider_event_id` unique = webhook replay protection at the database level, not just in code.

### `refunds`
```text
id, order_id, payment_id, provider_refund_id,
amount_paise, reason, refund_type (FULL|PARTIAL),
status refund_status, initiated_by, approved_by,
initiated_at, completed_at, failure_reason, notes, created_at, updated_at
```

### `invoices`
```text
id, order_id (unique), invoice_number (unique), invoice_date,
seller_type (PLATFORM|VENDOR),        -- D-14 BLOCKED: no invoice is generated in V1
seller_name, seller_gstin, buyer_name, buyer_state,
taxable_amount_paise, tax_breakup jsonb, total_amount_paise,
pdf_storage_key (nullable), created_at
```

### `tax_rates`
```text
id, name, hsn_code, rate numeric(5,2), cess_rate, is_active,
effective_from, effective_to, created_at
```
Historical rates are retained so old invoices remain reproducible.

---

### 6.1 Inventory reservation lifecycle (D-16 approved)

**Approved rule: reserve at order/payment initiation, release on payment failure or cancellation.** Reservation is what prevents two customers paying for the same last unit while one of them is still in the gateway.

`inventory` holds two counters. `quantity_available` is what may still be sold; `quantity_reserved` is committed-but-not-yet-delivered. Sellable stock is `quantity_available`, and it is decremented at reservation time — not at delivery.

| Trigger | Ledger entry | `quantity_available` | `quantity_reserved` |
|---|---|---|---|
| Order created (prepaid or COD) | `RESERVE` | − qty | + qty |
| Payment failed | `RELEASE` | + qty | − qty |
| `PENDING_PAYMENT` expiry (unpaid timeout) | `RELEASE` | + qty | − qty |
| Order cancelled before `PICKED_UP` | `RELEASE` | + qty | − qty |
| Vendor rejects order | `RELEASE` | + qty | − qty |
| Order `DELIVERED` | `SALE` | unchanged | − qty |
| Delivery failed, stock returned to store | `RELEASE` | + qty | − qty |
| Returned after delivery | `RETURN` | + qty | unchanged |
| Manual adjustment / damage | `ADJUSTMENT` / `DAMAGE` | ± qty | unchanged |

**Rules that make this safe:**

1. Reservation happens **inside the order-creation transaction**, under `SELECT … FOR UPDATE` on the `inventory` row. There is no window where the order exists but stock is unreserved.
2. `quantity_available >= 0` is a **check constraint**, not an application assumption. Overselling is impossible at the database level rather than merely unlikely.
3. Every movement writes an `inventory_transactions` row with `reference_type`/`reference_id`, so current stock is always reproducible from the ledger. A counter that disagrees with its ledger is a detectable bug.
4. `RELEASE` is **idempotent by `(order_id, txn_type)`** — a retried cancellation or a duplicated queue message cannot release the same stock twice and inflate inventory.
5. **Unpaid reservation timeout:** `PENDING_PAYMENT` orders are swept by cron and released after the configured window (default 15 minutes, admin-configurable). Without this, abandoned checkouts would silently strangle availability.
6. COD orders reserve at creation like any other order, since they are `CONFIRMED` immediately and have no payment wait.
7. `track_inventory = false` products skip reservation entirely but still write `SALE` rows for reporting.

### 6.2 COD payment lifecycle (D-12 approved)

COD needs its own tables because cash creates a custody chain that a gateway payment does not.

```text
payment_method = COD, payment_status = PENDING   (order created CONFIRMED)
        ↓  driver confirms delivery + OTP + collected amount
driver_cash_ledger  COLLECTION (+)   ·   payment_status = PAID
        ↓  driver declares a deposit
cash_deposits  status = DECLARED
        ↓  admin verifies
cash_deposits  status = VERIFIED   ·   driver_cash_ledger  DEPOSIT (−)
```

#### `driver_cash_ledger`
Append-only. Cash in hand is derived by summation, never stored as a mutable field — the same discipline as `driver_earnings`.

```text
id, driver_id, entry_type (COLLECTION|DEPOSIT|ADJUSTMENT|WRITE_OFF),
amount_paise (signed: + collection, − deposit),
delivery_id (nullable), order_id (nullable), cash_deposit_id (nullable),
reason, created_by, created_at
-- unique (delivery_id, entry_type) WHERE entry_type = 'COLLECTION'
```
The unique index is the idempotency guard: a retried delivery confirmation cannot record the same cash twice.

Index: `(driver_id, created_at desc)`.

#### `cash_deposits`
```text
id, driver_id, deposit_reference (unique), declared_amount_paise,
verified_amount_paise (nullable), variance_paise (nullable),
method (BANK_TRANSFER|OFFICE_CASH|UPI),
proof_storage_key (nullable, private R2),
status (DECLARED|VERIFIED|REJECTED|PARTIAL),
declared_at, verified_by, verified_at, rejection_reason,
notes, created_at, updated_at
```
Two-step by design: a driver *declares*, an admin *verifies*. A declared deposit is not a settled deposit, and the variance between declared and verified is recorded rather than reconciled away.

#### COD control settings
Stored in `admin_settings`, enforced in the service layer. **Launch values need confirmation (D-19a-adjacent):**

| Setting | Purpose |
|---|---|
| `cod.max_order_value_paise` | Caps per-order exposure |
| `cod.driver_cash_limit_paise` | A driver above this is **ineligible for further COD dispatch** until they deposit — the primary loss control |
| `cod.enabled_zones` | COD may be disabled per zone |
| `cod.deposit_grace_hours` | How long a driver may hold cash before escalation |

Derived views the admin reconciliation screen needs: cash in hand per driver, aged uncollected cash, drivers over limit, deposits pending verification, and per-delivery collection variances.

### 6.3 Cancellation and refund policy engine (D-19 approved)

Approved as a **configurable engine with distinct customer, vendor and admin permissions**. The rules are data, not conditionals scattered through services.

#### `cancellation_policies`
```text
id, actor_role (CUSTOMER|VENDOR|ADMIN),
from_status order_status,          -- status at which cancellation is attempted
is_allowed boolean,
window_minutes (nullable),         -- time from order placement, NULL = no limit
refund_percent numeric(5,2),       -- of item value
refund_delivery_fee boolean,
requires_reason boolean,
restock boolean,
compensate_driver boolean,
payment_method_scope (ALL|PREPAID|COD),
priority, is_active, updated_by, created_at, updated_at
-- unique (actor_role, from_status, payment_method_scope) WHERE is_active
```

The service resolves the matching row for `(actor, current status, payment method)` and either permits the cancellation with the computed refund or rejects it with `ORDER_NOT_CANCELLABLE`. Admin overrides are permitted but require a reason and are audited.

> 🔴 **D-19a — the engine is approved, the values are not.** The policy table ships **empty except for a deliberately conservative seed** (customer may cancel before `ACCEPTED` with a 100% refund; admin may cancel at any pre-delivery status). Every other window, percentage, restocking rule and driver-compensation rule **requires your input**. I will not invent refund percentages.

### 6.4 Tax — BLOCKED (D-14)

**No tax logic is implemented.** Per explicit instruction, no tax assumption is coded.

| Object | State while blocked |
|---|---|
| `products.hsn_code`, `products.tax_rate` | Exist, stay `NULL`. Nothing reads them |
| `order_items.tax_rate`, `order_items.tax_amount_paise` | Exist, written as `0` |
| `orders.taxable_amount_paise`, `orders.tax_amount_paise` | Exist, written as `0` |
| `tax_rates` table | Created, **not seeded** |
| `invoices` table | Created, **no rows produced**. No invoice number is issued |
| Pricing engine | `NoTaxStrategy` returns zero |
| Customer UI | **No tax line rendered at all** — not even "₹0 GST", since that asserts a treatment |

The columns exist now so that unblocking D-14 is a backfill plus a strategy implementation, not a schema migration across `orders` and `order_items` after real financial data exists.

---

## 7. State machines

### 7.1 Order transitions

Implemented as an explicit table in `modules/order/order.state.ts`. Anything absent from this table raises `StateTransitionError`.

**Entry point depends on payment method (D-12):**

| Method | Entry status | Reason |
|---|---|---|
| UPI / Card | `PENDING_PAYMENT` | Awaits a verified webhook before becoming `CONFIRMED` |
| **COD** | **`CONFIRMED` directly** | No upstream payment exists. A `payments` row is created with `method=COD`, `status=PENDING`, advancing to `PAID` only on confirmed cash collection at delivery |

| From | Allowed to | Who may trigger |
|---|---|---|
| `PENDING_PAYMENT` | `CONFIRMED`, `PAYMENT_FAILED`, `CANCELLED` | System (webhook), customer (abandon), cron (expiry → releases reserved stock) |
| `CONFIRMED` | `ACCEPTED`, `CANCELLED` | Vendor, admin, customer (within policy **[D-19]**) |
| `ACCEPTED` | `PREPARING`, `CANCELLED` | Vendor, admin |
| `PREPARING` | `READY_FOR_PICKUP`, `CANCELLED` | Vendor, admin |
| `READY_FOR_PICKUP` | `ASSIGNED`, `CANCELLED` | System/admin (dispatch **[D-18]**) |
| `ASSIGNED` | `PICKED_UP`, `READY_FOR_PICKUP` (driver dropped), `CANCELLED` | Driver, admin |
| `PICKED_UP` | `OUT_FOR_DELIVERY`, `FAILED_DELIVERY` | Driver, admin |
| `OUT_FOR_DELIVERY` | `DELIVERED`, `FAILED_DELIVERY` | Driver, admin — **requires delivery OTP (D-20)**; for COD also requires a collected-amount confirmation, which writes `driver_cash_ledger` and marks the COD payment `PAID` |
| `DELIVERED` | `RETURNED`, `REFUNDED` | Admin only |
| `FAILED_DELIVERY` | `ASSIGNED` (retry), `RETURNED`, `CANCELLED` | Admin |
| `CANCELLED` | `REFUNDED` | Admin/system (if payment captured) |
| `PAYMENT_FAILED` | `CONFIRMED` (recovery), `CANCELLED` | System (retry), customer |
| `REFUNDED`, `RETURNED` | *terminal* | — |

Mandatory side effects per transition (notification, inventory movement, earnings, analytics event) are declared in the same table, so no transition can silently skip one.

### 7.2 Delivery transitions

```text
PENDING_ASSIGNMENT → OFFERED → ASSIGNED → EN_ROUTE_TO_STORE → AT_STORE
   → PICKED_UP → EN_ROUTE_TO_CUSTOMER → AT_CUSTOMER → DELIVERED

OFFERED  → PENDING_ASSIGNMENT   (declined / offer timeout)
ASSIGNED → PENDING_ASSIGNMENT   (reassigned by admin)
AT_CUSTOMER → FAILED            (customer unavailable, wrong address, refused)
FAILED   → RETURNED_TO_STORE
any pre-pickup state → CANCELLED (order cancelled upstream)
```

Delivery status changes propagate to order status through the `order` service — never by writing `orders.status` directly from the delivery module.

### 7.3 Payment transitions

```text
PREPAID:  CREATED → PENDING → AUTHORIZED → PAID
          CREATED/PENDING → FAILED | CANCELLED
          PAID → PARTIALLY_REFUNDED → REFUNDED

COD:      PENDING → PAID          (cash collected at delivery)
          PENDING → CANCELLED     (order cancelled before delivery)
```
For **prepaid**, only the verified webhook handler and the reconciliation job may advance a payment to `PAID`.

For **COD**, only a driver's confirmed delivery (with valid OTP) or an admin correction may advance it, and doing so writes the cash ledger entry in the same transaction — cash recorded as collected and payment marked paid can never diverge.

**COD refunds** have no gateway payment to reverse, so they become a manual payout recorded against the order with its own approval trail (D-15 manual settlement). This is deliberately not automated in V1.

---

## 8. Delivery domain

### `drivers`
```text
id, user_id (unique), driver_code (unique), status driver_status,
availability driver_availability,
full_name, phone, date_of_birth, emergency_contact,
assigned_zone_ids (join table below), rating_avg, rating_count,
total_deliveries, successful_deliveries,
current_latitude, current_longitude, location_updated_at,
-- D-29 + C-1: ephemeral ONLINE position for auto-dispatch (D-18).
-- Single overwritten row, NO history. CLEARED when availability becomes OFFLINE.
cash_in_hand_paise (derived, not stored — see driver_cash_ledger),
approved_at, approved_by, rejection_reason, suspended_at,
created_at, updated_at, deleted_at
```
**Location handling is split into two classes (approved resolution, [`ARCHITECTURE.md` §16.7 C-1](./ARCHITECTURE.md#167-clarifications-required-by-these-approvals)):**

| Class | Where | Retention |
|---|---|---|
| **Ephemeral current position** — required by auto-nearest dispatch (D-18) | `drivers.current_*` | Overwritten per ping, **deleted when the driver goes offline**. Never a queryable trail |
| **Active-delivery trail** | `delivery_status_history` coordinates | **Purged after 7 days** (D-29) |

A driver's long-term movement history is therefore never retained, which preserves the privacy intent while making dispatch possible.

### `driver_zones`
```text
driver_id, delivery_zone_id      -- PK both
```

### `driver_documents`
```text
id, driver_id, doc_type (DL|AADHAAR|PAN|RC|INSURANCE|POLICE_VERIFICATION|PHOTO),
storage_key (private R2), file_name, mime_type, size_bytes,
document_number_encrypted, kyc_status, expires_at,
reviewed_by, reviewed_at, rejection_reason, created_at
```
`expires_at` drives an automated reminder job — an expired licence must block assignment.

### `driver_vehicles`
```text
id, driver_id, vehicle_type (BIKE|SCOOTER|BICYCLE|CAR|VAN),
registration_number, make_model, insurance_expiry, is_active, created_at, updated_at
```

### `deliveries`
```text
id, order_id (unique), store_id, driver_id (nullable),
status delivery_status, delivery_zone_id,
pickup_address_snapshot jsonb, drop_address_snapshot jsonb,
distance_km, delivery_fee_paise, driver_payout_paise,
delivery_otp_hash NOT NULL, otp_verified_at,      -- D-20: OTP mandatory for every delivery
otp_attempts, otp_regenerated_count,
assigned_at, accepted_at, reached_store_at, picked_up_at,
reached_customer_at, delivered_at, failed_at, failure_reason,
cod_amount_paise (nullable), cod_expected_paise, cod_collected_paise,
cod_collected_at, cod_variance_paise,              -- D-12: mismatch recorded, not swallowed
created_at, updated_at
```
Delivery OTP is **hashed**, like any other OTP.

### `delivery_assignments`
Full offer/accept/decline audit — needed to answer "why did this order sit unassigned for 20 minutes?".
```text
id, delivery_id, driver_id, offered_at, responded_at,
response (ACCEPTED|DECLINED|TIMEOUT|CANCELLED), decline_reason,
offer_expires_at, assigned_by (nullable — admin manual),
attempt_number, dispatch_mode (AUTO_NEAREST|BROADCAST|MANUAL),
distance_at_offer_km, created_at
```

**Auto-nearest dispatch (D-18 approved).** The dispatch job runs when an order reaches `READY_FOR_PICKUP`:

```text
1. candidate set = drivers where
     availability = ONLINE
     AND status = APPROVED
     AND no mandatory document expired
     AND assigned to the store's delivery zone
     AND current position known and fresh
     AND cash_in_hand below cod.driver_cash_limit_paise   (COD orders only)
2. rank by distance from the store (nearest first)
3. offer to the top candidate, attempt_number = 1
4. no response within cod/dispatch offer_timeout_seconds → response = TIMEOUT
5. offer to the next candidate, attempt_number += 1
6. after max_attempts → dispatch_mode = BROADCAST to the whole eligible zone
7. still unassigned after escalation_minutes → surface on the admin delivery
   board for MANUAL assignment and raise a system_event
```

`attempt_number` and `distance_at_offer_km` exist so dispatch quality is measurable — without them, "why was a far driver assigned?" is unanswerable. **Timeout, max attempts and escalation values are admin-configurable; launch defaults need confirmation.**

Index: `(driver_id, response, offered_at desc)`, `(delivery_id, attempt_number)`.

### `delivery_status_history`
```text
id, delivery_id, from_status, to_status, changed_by_user_id, changed_by_role,
latitude, longitude, reason, created_at
```

### `delivery_proofs`
```text
id, delivery_id, proof_type, storage_key (nullable, private R2),
otp_verified boolean, recipient_name, notes,
latitude, longitude, captured_at, created_at
```

### `driver_earnings`
Append-only ledger, one row per earning/deduction event.
```text
id, driver_id, delivery_id (nullable), earning_type (DELIVERY_FEE|INCENTIVE|TIP|ADJUSTMENT|PENALTY),
amount_paise, description, earned_on date,
payout_batch_id (nullable), created_by, created_at
```
Balance is derived by summation, never stored as a mutable field.

### `payout_batches`
```text
id, payee_type (VENDOR|DRIVER), payee_id, period_start, period_end,
gross_amount_paise, deductions_paise, net_amount_paise,
status (DRAFT|APPROVED|PAID|FAILED), reference_number,
approved_by, approved_at, paid_at, notes, created_at, updated_at
```
V1 records and reports payouts; actual money movement is manual pending **[D-15]**.

---

## 9. Engagement domain

### `reviews`
```text
id, user_id, order_id, product_id (nullable), store_id (nullable),
driver_id (nullable), rating smallint (1–5), title, comment,
status review_status, moderated_by, moderated_at, rejection_reason,
is_verified_purchase, helpful_count,
vendor_reply, vendor_replied_at, created_at, updated_at, deleted_at
```
Unique `(user_id, order_id, product_id)` — one review per purchased item. Only delivered orders may be reviewed. Aggregates on `products`/`stores` are updated transactionally on approval.

### `banners`
Every field required by master spec §18.
```text
id, title, subtitle, image_key, mobile_image_key,
cta_label, link_url, placement (HOME_HERO|HOME_STRIP|CATEGORY|OFFERS),
target_audience (ALL|NEW_USERS|RETURNING|SEGMENT), segment_id (nullable),
delivery_zone_id (nullable), priority, starts_at, ends_at,
is_active, click_count, impression_count,
created_by, created_at, updated_at, deleted_at
```

### `campaigns`
```text
id, name, campaign_type (NOTIFICATION|COUPON_DROP|BANNER),
audience_filter jsonb, coupon_id (nullable), template_id (nullable),
channel notification_channel, scheduled_at, started_at, completed_at,
status (DRAFT|SCHEDULED|RUNNING|COMPLETED|CANCELLED|FAILED),
target_count, sent_count, failed_count,
created_by, created_at, updated_at
```

### `notification_templates`
```text
id, event_key, channel notification_channel, locale,
subject, body, variables jsonb, provider_template_id (nullable),   -- DLT id for SMS
is_active, version, updated_by, created_at, updated_at
-- unique (event_key, channel, locale, version)
```
Admin-editable with variables (master spec §21), required in **English and Hindi** for transactional events (D-33).

**V1 populates `PUSH` and `IN_APP` channels only.** `provider_template_id` was originally for DLT-registered SMS templates; **login OTP no longer needs it** because Firebase owns that delivery (D-24). It is retained for the day D-34 (non-OTP SMS) or D-25 (email) is unblocked.

### `notifications`
```text
id, user_id, event_key, channel, template_id,
title, body, data jsonb, status notification_status,
provider_message_id, provider_response, failure_reason,
order_id (nullable), sent_at, delivered_at, read_at, created_at
```
Index `(user_id, created_at desc)` for the in-app notification centre, `(status, created_at)` for retry sweeps.

### `support_tickets` / `ticket_messages`
```text
support_tickets  id, ticket_number (unique), user_id, order_id (nullable),
                 category ticket_category, subject, status ticket_status,
                 priority ticket_priority, assigned_to_user_id (nullable),
                 sla_due_at, first_response_at, resolved_at, closed_at,
                 resolution_note, created_at, updated_at
ticket_messages  id, ticket_id, author_user_id, author_role,
                 message, is_internal_note boolean,
                 attachment_keys jsonb, created_at
```
`is_internal_note` is the single flag preventing internal commentary from leaking to the customer — enforced in the repository read path, not just the UI.

### `faqs`
```text
id, category, question, answer, display_order, is_active, created_at, updated_at
```

---

## 10. CMS, SEO and localized content

### 10.1 Localized content model (D-33 approved: EN + HI)

**Approach: side translation tables**, one per translatable entity, keyed `(entity_id, locale)`. Not `name_en`/`name_hi` columns.

The reason is directly about the approved requirement that further Indian languages must not be blocked: adding Marathi with translation tables is `INSERT` statements, while with suffixed columns it is an `ALTER TABLE` on every content table plus a change to every query that selects a name. The cost difference only grows as the catalog grows.

```text
supported_locales   -- small lookup so admin can see/extend the set
id, code ('en'|'hi'), name, native_name, is_default, is_active, display_order
```

#### Translation tables

Each follows the identical shape, which keeps the repository helper generic:

```text
category_translations
  id, category_id, locale, name, description
  -- unique (category_id, locale)

product_translations
  id, product_id, locale, name, short_description, description,
  specifications jsonb, unit_label
  -- unique (product_id, locale)

product_variant_translations
  id, variant_id, locale, name, variant_label
  -- unique (variant_id, locale)

brand_translations           id, brand_id, locale, name
cms_page_translations        id, cms_page_id, locale, title, content jsonb
blog_post_translations       id, blog_post_id, locale, title, excerpt, content jsonb
banner_translations          id, banner_id, locale, title, subtitle, cta_label,
                             image_key, mobile_image_key   -- images can differ per locale
faq_translations             id, faq_id, locale, question, answer
coupon_translations          id, coupon_id, locale, name, description
seo_meta_translations        id, seo_meta_id, locale, meta_title, meta_description,
                             og_title, og_description
cancellation_reason_translations  id, reason_id, locale, label
```

Every one carries `created_at`, `updated_at`, `updated_by`.

`notification_templates` already keys on `locale` natively (§9), so it needs no companion table.

#### Rules

1. **Base rows keep language-neutral data only** — slug, prices, status, flags, foreign keys, timestamps. `products.name` is **removed** in favour of `product_translations`; a base table never holds one privileged language.
2. **The `en` row is mandatory** for every translatable entity, enforced in the service layer, because `en` is the fallback. Creating content without English is rejected.
3. **Per-field fallback to `en`** when a `hi` row or field is missing. The repository resolves this in a single query using `COALESCE` over a `LEFT JOIN` on the requested locale, so call sites never handle fallback themselves and can never forget to.
4. **Slugs are not translated in V1.** One canonical slug per entity, shared across locales, which keeps the `redirects` table and legacy URL mapping simple. Localized slugs remain possible later without a schema change.
5. **Search vectors are per-locale** (`search_vector_en`, `search_vector_hi`), generated from the corresponding translation row. Hindi uses the `simple` configuration plus `pg_trgm` because PostgreSQL ships no Hindi stemmer — see [`ARCHITECTURE.md` §16.7 C-2](./ARCHITECTURE.md#167-clarifications-required-by-these-approvals).
6. **Translation completeness is queryable**, so admin can see what is untranslated rather than discovering gaps from customers.

Indexes: unique `(entity_id, locale)` on each table, plus `(locale)` where a locale-wide scan is needed for completeness reporting.

#### V1 content scope

Capability is complete for both languages; *content* is bounded per [`ARCHITECTURE.md` §12.6](./ARCHITECTURE.md#126-localisation-en-hi). Hindi is **required** for UI strings, transactional notification templates and category names; **optional with EN fallback** for product text and CMS pages; **not translated** for blog in V1.

### `cms_pages`
```text
id, slug (unique), title, content jsonb, page_type (LEGAL|INFO|LANDING),
status (DRAFT|PUBLISHED|ARCHIVED), seo_meta_id,
published_at, published_by, version,
created_at, created_by, updated_at, updated_by, deleted_at
```

### `blog_posts`
```text
id, slug (unique), title, excerpt, content jsonb, cover_image_key,
author_user_id, category, tags jsonb, status, seo_meta_id,
published_at, view_count, created_at, updated_at, deleted_at
```

### `home_layouts`
The mechanism that makes the homepage CMS-driven (master spec §9).
```text
id, name, is_active, sections jsonb, delivery_zone_id (nullable),
valid_from, valid_until, version, updated_by, created_at, updated_at
```
`sections` is an ordered array of typed section descriptors (`{ type, title, config, visible }`) covering the master spec §9 section list. Admin reorders/toggles sections without a deploy. Only one active layout per zone at a time.

### `seo_meta`
Shared by products, categories, CMS pages, blog posts (master spec §19).
```text
id, entity_type, entity_id, meta_title, meta_description,
canonical_url, og_title, og_description, og_image_key,
twitter_card, schema_type, robots_index boolean, robots_follow boolean,
include_in_sitemap boolean, created_at, updated_at
-- unique (entity_type, entity_id)
```

### `redirects`
Protects SEO across slug changes and the legacy-site cutover (master spec §20, **[D-31]**).
```text
id, source_path (unique), target_path, status_code (301|302),
is_active, hit_count, last_hit_at, note, created_by, created_at
```

---

## 11. Administration domain

### `admin_settings`
Key-value with typing and sensitivity, covering master spec §34.
```text
id, key (unique), value jsonb, value_type, group_name,
label, description, is_sensitive boolean,
required_permission (nullable), updated_by, updated_at, created_at
```
Sensitive settings (payment keys, refund limits, maintenance mode) require elevated permission and are always audited. Read through a 60 s cache so maintenance mode propagates quickly.

### `feature_flags`
```text
id, key (unique), description, is_enabled,
rollout_percentage, enabled_for_roles jsonb, enabled_for_zones jsonb,
updated_by, created_at, updated_at
```

### `audit_logs`
Append-only. No updates, no deletes, ever (master spec §23, §30).
```text
id, actor_user_id (nullable), actor_role, actor_ip_hash, actor_user_agent,
action audit_action, entity_type, entity_id,
before jsonb, after jsonb, changed_fields jsonb,
reason, request_id, created_at
```
Indexes: `(entity_type, entity_id, created_at desc)`, `(actor_user_id, created_at desc)`, `(action, created_at desc)`. `before`/`after` are field-filtered to exclude secrets and full PII.

### `system_events`
Operational, non-user events for the System Health screen.
```text
id, event_type, severity (INFO|WARNING|ERROR|CRITICAL), source,
message, context jsonb, request_id, resolved_at, created_at
```

### `webhook_logs`
```text
id, direction (INBOUND|OUTBOUND), provider, endpoint, event_type,
http_status, raw_headers jsonb, raw_body text,
signature_valid boolean, attempt, processed boolean,
error_message, request_id, created_at
```

### `idempotency_keys`
Durable backstop behind the cache-based check, so a cache flush cannot cause a double order.
```text
id, key (unique), scope, user_id, request_hash,
response_status, response_body jsonb, locked_at, completed_at, expires_at, created_at
```

### `analytics_events`
🚫 **Not created in V1.** D-28 selects Firebase Analytics + GA4, which own event storage, with BigQuery export kept future-ready. This definition is retained only in case a self-hosted event store is ever needed.
```text
id, event_name, user_id (nullable), anonymous_id, session_id,
properties jsonb, url, referrer, device_type, occurred_at, created_at
```

---

## 12. Indexing summary for the hot paths

| Query | Index |
|---|---|
| Serviceability by pincode | `zone_pincodes(pincode) WHERE is_active` |
| Active products in a category, paged | `products(category_id, status, created_at desc) WHERE deleted_at IS NULL` |
| Product by slug | unique `products(slug)` |
| Search | GIN `products(search_vector)` + trigram on `products(name)` |
| Customer order list | `orders(user_id, created_at desc)` |
| Vendor order queue | `orders(store_id, status, created_at)` |
| Admin order search | `orders(status, created_at desc)`, unique `orders(order_number)` |
| Order timeline | `order_status_history(order_id, created_at)` |
| Driver open offers | `delivery_assignments(driver_id, response, offered_at desc)` |
| Unassigned deliveries in zone | `deliveries(delivery_zone_id, status) WHERE status='PENDING_ASSIGNMENT'` |
| Stock lookup | unique `inventory(variant_id)` |
| Coupon validation | unique `coupons(code)`, `coupon_usages(coupon_id, user_id)` |
| Webhook replay guard | unique `payment_events(provider_event_id)` |
| Payment reconciliation sweep | `payments(status, created_at) WHERE status IN ('CREATED','PENDING')` |
| Audit trail for an entity | `audit_logs(entity_type, entity_id, created_at desc)` |
| In-app notifications | `notifications(user_id, created_at desc)` |

---

## 13. Migrations, seeding and data lifecycle

### Migrations
- Generated by the ORM CLI into `db/migrations/`, committed, reviewed in the PR, applied by CI. Hand-editing generated SQL is not permitted (master spec §28.8).
- **Forward-only.** Rollback is a new migration, not a reversal, because production data may already depend on the change.
- **Expand → migrate → contract** for breaking changes: add nullable column → backfill in a job → make non-null and drop the old column in a later release. This keeps a deploy rollback survivable.
- CI blocks migrations containing an unguarded `DROP COLUMN`/`DROP TABLE` without an explicit approval label.

### Seeding
Deterministic seeds for: permissions and role→permission mappings, a super admin, delivery zones + pincodes, a category tree, tax rates, notification templates, admin settings defaults, feature flags. Demo vendors/products/orders exist in a **separate** dev-only seed that can never run against production.

### Retention (scheduled jobs)
| Data | Policy |
|---|---|
| `otp_verifications` | Purge consumed/expired after 30 days |
| `login_attempts` | Purge after 90 days |
| `sessions` | Purge expired/revoked after 30 days |
| Stale `devices.fcm_token` | Pruned when FCM reports the token invalid, or after 90 days inactive |
| Driver **current** position | Cleared the moment availability becomes `OFFLINE` (D-29 + C-1) |
| Driver location **trail** (active delivery) | **Purged after 7 days** (D-29) |
| `cash_deposits` proof files | Retained 12 months for reconciliation disputes |
| `analytics_events` | Aggregate then purge raw after 12 months |
| `webhook_logs` / `payment_events` | Retain ≥ 12 months (dispute window), then archive |
| Financial rows (orders, payments, refunds, invoices, earnings, **cash ledger**) | **Never** purged; statutory retention |
| `audit_logs` | Retain ≥ 3 years, archive to R2 thereafter |

### Backup
Managed PITR from the chosen host (**[D-01]**), plus an independent periodic logical dump to R2. Restores are rehearsed in staging before the production cutover — a backup that has never been restored is not a backup (master spec §31.9).

---

## 14. Decision status affecting this schema

### Resolved — schema is settled for these

| Decision | Outcome in the schema |
|---|---|
| **D-01/D-02** | Drizzle definitions against managed PostgreSQL via Hyperdrive |
| **D-08/D-09** | **`users.firebase_uid` unique NOT NULL** as the Firebase↔Parthik join key. **No `password_hash`.** `otp_verifications` reduced to delivery OTP only |
| **D-10** | `sessions.firebase_token_issued_at` for traceability; Parthik sessions remain authoritative |
| **D-26** | `devices.fcm_token`, `fcm_token_updated_at`, `push_permission` |
| **D-28** | No analytics tables — GA4/Firebase own event storage; `analytics_events` **not created** in V1 |
| **D-11** | `carts.store_id` / `orders.store_id` — single vendor per order. No order-group table |
| **D-12** | `orders.is_cod` + `cod_amount_paise`, `deliveries.cod_*` with variance, `driver_cash_ledger`, `cash_deposits`, COD entry directly at `CONFIRMED` (§6.2, §7.1) |
| **D-15** | `vendors.commission_rate`, `orders.vendor_payout_paise`, `payout_batches` — calculation only, no auto-settlement |
| **D-16** | `inventory.quantity_reserved` + `RESERVE`/`RELEASE`/`SALE` ledger types with documented triggers (§6.1) |
| **D-17** | `delivery_zones` fee columns + `zone_pincodes` + `stores.delivery_radius_km`; ₹199 threshold seeded as admin-editable data, not a constant |
| **D-18** | `delivery_assignments.attempt_number`, `dispatch_mode`, `distance_at_offer_km`; `drivers.current_*` as ephemeral position |
| **D-19** | `cancellation_policies` table (§6.3) — engine built, **values pending D-19a** |
| **D-20** | `deliveries.delivery_otp_hash` **NOT NULL**; `delivery_proofs` for optional photo/signature |
| **D-21** | `search_vector_en` + `search_vector_hi`, `pg_trgm` on translated names |
| **D-29** | Split into ephemeral position (cleared offline) and 7-day-purged trail |
| **D-30** | `cms_pages`, `home_layouts`, `blog_posts`, `redirects` — DB-driven |
| **D-31** | **No migration tables, no id-mapping tables built yet.** A separate plan follows schema approval |
| **D-33** | `supported_locales` + `*_translations` tables (§10.1); base tables hold no language-specific text. ⚠️ *Firebase OTP SMS language is not under our control* |
| **D-36** | No schema impact — Identity Platform REST is a runtime concern |

### 🔴 Still blocked — schema deliberately inert

| Decision | Schema state |
|---|---|
| **D-14 GST/tax** | Tax columns and `tax_rates`/`invoices` tables exist but carry **no logic, no seed data and produce no rows**. See §6.4. Unblocking is a backfill plus a strategy implementation, not a migration on live financial tables |
| **D-08 auth library** | Affects no table. `sessions`/`otp_verifications` are library-agnostic as designed, so this blocks TASK 003 code rather than TASK 002 schema |
| **D-32 multi-store** | `stores.vendor_id` already supports N per vendor. **No schema change either way** — only the vendor UI differs |
| **D-25 email** | `notification_channel` retains `EMAIL`; **no email is sent**. `users.email` still captured and verifiable |
| **D-34 non-OTP SMS** | `notification_channel` retains `SMS`; **no SMS is sent** beyond Firebase's own OTP path |

### Open sub-items with schema impact

| Ref | Impact |
|---|---|
| **D-19a** | The *values* seeded into `cancellation_policies`. Table shape is final |
| **D-33a** | Locale URL strategy affects `redirects` seeding and canonical generation, not table shape |
| **D-07a** | Image transformation choice may add a variants/derivatives column to `product_images`. Deferred until decided |

### Not yet generated, by instruction

**No migrations exist.** This document is the design they will be generated from. Nothing in `db/migrations/` will be created until TASK 002 is explicitly authorized.
