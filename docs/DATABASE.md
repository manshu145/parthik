# Parthik — Database Design

**Status:** Draft for approval
**Version:** 0.1
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — ORM choice is **[D-02]**, host is **[D-01]**, both unresolved.

> This is a logical schema. Column lists are indicative of intent, not final DDL. No migrations will be generated until [D-01], [D-02], [D-11], [D-12], [D-14], [D-16] and [D-17] are approved, because each of them changes table shape.

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
payment_method           UPI | CARD | NETBANKING | WALLET | COD        -- COD pending [D-12]
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
notification_channel     SMS | EMAIL | PUSH | IN_APP | WHATSAPP
notification_status      QUEUED | SENT | DELIVERED | FAILED | READ
review_status            PENDING | APPROVED | REJECTED | HIDDEN
ticket_status            OPEN | IN_PROGRESS | WAITING_ON_CUSTOMER | RESOLVED | CLOSED
ticket_priority          LOW | MEDIUM | HIGH | URGENT
ticket_category          PAYMENT | DELIVERY | PRODUCT | REFUND | COUPON
                         | ACCOUNT | VENDOR | OTHER
audit_action             CREATE | UPDATE | DELETE | LOGIN | LOGOUT | STATUS_CHANGE
                         | APPROVE | REJECT | REFUND | ASSIGN | EXPORT | SETTING_CHANGE
```

---

## 3. Identity domain

### `users`
Central identity. One row per human, regardless of how many roles they hold.

```text
id, phone (unique, nullable), phone_verified_at,
email (unique, nullable), email_verified_at,
password_hash (nullable — pending [D-09]), full_name,
status user_status, last_login_at, locale,
created_at, updated_at, deleted_at, anonymized_at
```
Constraint: at least one of `phone`/`email` present. Indexes: unique on `lower(email)`, unique on `phone`, index on `status`.

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
ip_hash, user_agent, expires_at, last_seen_at, revoked_at, revoked_reason, created_at
```
Only the **hash** of the session token is stored. Index on `user_id`, `expires_at`.

### `otp_verifications`
```text
id, user_id (nullable — signup), destination (phone/email), channel,
purpose otp_purpose, code_hash, attempts, max_attempts,
expires_at, consumed_at, ip_hash, created_at
```
Codes are hashed, never stored in plaintext, never logged. Index on `(destination, purpose, created_at desc)` for throttling.

### `login_attempts`
```text
id, identifier, identifier_type, ip_hash, success boolean,
failure_reason, user_agent, created_at
```
Feeds lockout and abuse detection. Index on `(identifier, created_at desc)` and `(ip_hash, created_at desc)`. Retention-limited by cron.

### `devices`
```text
id, user_id, device_fingerprint, platform, push_token (nullable),
push_provider, last_active_at, is_trusted, created_at, revoked_at
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
contact_phone, contact_email, commission_rate (nullable — pending [D-15]),
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
delivery_radius_km (nullable — pending [D-17]),
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
id, parent_id (nullable), name, slug (unique), description,
icon_key, image_key, display_order, is_active, is_featured,
seo_meta_id (nullable), created_at, updated_at, deleted_at
```
Index on `(parent_id, display_order)`, unique on `slug`. Depth is limited to 2 levels in V1 by application rule.

### `brands`
```text
id, name, slug (unique), logo_key, is_active, created_at, updated_at, deleted_at
```

### `products`
```text
id, vendor_id, store_id, category_id, brand_id (nullable),
name, slug (unique), short_description, description,
status product_status, is_featured, is_popular,
unit_label (e.g. '500 g', '1 L'), hsn_code (nullable — pending [D-14]),
tax_rate (nullable), is_tax_inclusive boolean,
mrp_paise, price_paise, cost_paise (nullable, vendor-private),
rating_avg, rating_count, view_count, sold_count,
search_vector tsvector (generated — pending [D-21]),
seo_meta_id, version, published_at,
created_at, created_by, updated_at, updated_by, deleted_at
```
Indexes: unique `slug`; `(store_id, status)`; `(category_id, status)`; GIN on `search_vector`; trigram index on `name`; partial `(status) WHERE deleted_at IS NULL AND status='ACTIVE'`.

`price_paise` must always be `<= mrp_paise` (check constraint) so discount display can never be nonsense.

### `product_variants`
```text
id, product_id, name, sku (unique per vendor), variant_label,
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
payment_method, payment_status, is_cod,          -- pending [D-12]
placed_at, confirmed_at, accepted_at, ready_at,
delivered_at, cancelled_at,
cancellation_reason, cancelled_by_role,
estimated_delivery_at, actual_delivery_minutes,
customer_note, internal_note,
idempotency_key (unique), source (WEB|PWA|ADMIN),
vendor_payout_paise, platform_commission_paise,   -- pending [D-15]
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
seller_type (PLATFORM|VENDOR),        -- pending [D-14]
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

## 7. State machines

### 7.1 Order transitions

Implemented as an explicit table in `modules/order/order.state.ts`. Anything absent from this table raises `StateTransitionError`.

| From | Allowed to | Who may trigger |
|---|---|---|
| `PENDING_PAYMENT` | `CONFIRMED`, `PAYMENT_FAILED`, `CANCELLED` | System (webhook), customer (abandon), cron (expiry) |
| `CONFIRMED` | `ACCEPTED`, `CANCELLED` | Vendor, admin, customer (within policy **[D-19]**) |
| `ACCEPTED` | `PREPARING`, `CANCELLED` | Vendor, admin |
| `PREPARING` | `READY_FOR_PICKUP`, `CANCELLED` | Vendor, admin |
| `READY_FOR_PICKUP` | `ASSIGNED`, `CANCELLED` | System/admin (dispatch **[D-18]**) |
| `ASSIGNED` | `PICKED_UP`, `READY_FOR_PICKUP` (driver dropped), `CANCELLED` | Driver, admin |
| `PICKED_UP` | `OUT_FOR_DELIVERY`, `FAILED_DELIVERY` | Driver, admin |
| `OUT_FOR_DELIVERY` | `DELIVERED`, `FAILED_DELIVERY` | Driver, admin |
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
CREATED → PENDING → AUTHORIZED → PAID
CREATED/PENDING → FAILED | CANCELLED
PAID → PARTIALLY_REFUNDED → REFUNDED
```
Only the verified webhook handler and the reconciliation job may advance a payment to `PAID`.

---

## 8. Delivery domain

### `drivers`
```text
id, user_id (unique), driver_code (unique), status driver_status,
availability driver_availability,
full_name, phone, date_of_birth, emergency_contact,
assigned_zone_ids (join table below), rating_avg, rating_count,
total_deliveries, successful_deliveries,
current_latitude, current_longitude, location_updated_at,   -- retention per [D-29]
approved_at, approved_by, rejection_reason, suspended_at,
created_at, updated_at, deleted_at
```
Current location is a single overwritten row, not a history trail, unless **[D-29]** decides otherwise.

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
delivery_otp_hash (nullable), otp_verified_at,
assigned_at, accepted_at, reached_store_at, picked_up_at,
reached_customer_at, delivered_at, failed_at, failure_reason,
cod_amount_paise (nullable), cod_collected_at,     -- pending [D-12]
created_at, updated_at
```
Delivery OTP is **hashed**, like any other OTP.

### `delivery_assignments`
Full offer/accept/decline audit — needed to answer "why did this order sit unassigned for 20 minutes?".
```text
id, delivery_id, driver_id, offered_at, responded_at,
response (ACCEPTED|DECLINED|TIMEOUT|CANCELLED), decline_reason,
offer_expires_at, assigned_by (nullable — admin manual), created_at
```

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
Admin-editable with variables (master spec §21). `provider_template_id` exists because Indian transactional SMS requires pre-registered DLT templates (**[D-24]**).

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

## 10. CMS and SEO

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
Only if a self-hosted event store is chosen (**[D-28]**); otherwise events go to the provider and this table is skipped.
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
| Driver location | **[D-29]** — purge after the approved window |
| `analytics_events` | Aggregate then purge raw after 12 months |
| `webhook_logs` / `payment_events` | Retain ≥ 12 months (dispute window), then archive |
| Financial rows (orders, payments, refunds, invoices, earnings) | **Never** purged; statutory retention |
| `audit_logs` | Retain ≥ 3 years, archive to R2 thereafter |

### Backup
Managed PITR from the chosen host (**[D-01]**), plus an independent periodic logical dump to R2. Restores are rehearsed in staging before the production cutover — a backup that has never been restored is not a backup (master spec §31.9).

---

## 14. Open items affecting this schema

| Decision | Tables affected |
|---|---|
| **[D-01]** Postgres host | Extension availability (PostGIS, `pg_trgm`), backup strategy |
| **[D-02]** ORM | All schema definition files, migration tooling |
| **[D-09]** Password vs passwordless | `users.password_hash` |
| **[D-11]** Multi-vendor cart | `carts`, `orders` (possible `order_groups` parent), `deliveries` |
| **[D-12]** COD | `orders.is_cod`, `deliveries.cod_*`, `payment_method` enum, state machine entry |
| **[D-14]** GST model | `products.hsn_code`/`tax_rate`, `order_items.tax_*`, `invoices.seller_type`, `tax_rates` |
| **[D-15]** Commission/payout | `vendors.commission_rate`, `orders.vendor_payout_paise`, `payout_batches` |
| **[D-16]** Inventory semantics | `inventory.quantity_reserved`, `inventory_transactions` types |
| **[D-17]** Zone model | `delivery_zones.polygon`/`radius_km`, `zone_pincodes`, fee columns |
| **[D-18]** Dispatch | `delivery_assignments` offer/timeout columns |
| **[D-20]** Proof policy | `delivery_proofs`, `deliveries.delivery_otp_hash` |
| **[D-21]** Search | `products.search_vector` or external index |
| **[D-28]** Analytics | whether `analytics_events` exists at all |
| **[D-29]** Location retention | `drivers.current_*`, `delivery_status_history` coordinates |
| **[D-31]** Legacy migration | id mapping tables, `redirects` seed, password hash compatibility |
