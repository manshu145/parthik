# Parthik — Security Architecture

**Status:** Draft for approval
**Version:** 0.1
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`API_SPEC.md`](./API_SPEC.md) · [`DATABASE.md`](./DATABASE.md)

> Governing rule from the master spec (§23): **roles must never be trusted from client-side state, and authorization is always server-side.** Every control below exists to make that true in practice rather than in principle.

---

## 1. Threat model

What we are actually defending against, in rough priority order for a hyperlocal commerce platform:

| # | Threat | Primary controls |
|---|---|---|
| T1 | **OTP/SMS abuse** — attackers pumping SMS to burn credit or brute-force codes | Per-phone/per-IP rate limits, attempt caps, hashed codes, short expiry, Turnstile escalation, spend alerts (§6) |
| T2 | **Payment tampering** — forged success, replayed webhooks, price manipulation | Server-side repricing, webhook HMAC + replay guard, idempotency, reconciliation (§8) |
| T3 | **Horizontal privilege escalation** — customer A reading customer B's order; vendor A seeing vendor B's data; driver reading arbitrary customer PII | Ownership checks in the service layer, tenancy scoping in repositories, session-derived scope only (§4, §5) |
| T4 | **Vertical privilege escalation** — customer reaching admin capability | Permission-based RBAC, deny-by-default, no role from client input (§5) |
| T5 | **Coupon/discount abuse** — multi-account farming, reuse past limits, stacking | DB-level unique constraints on usage, per-user limits, first-order verification, phone-verified accounts (§9) |
| T6 | **PII leakage** — customer addresses/phones exposed to vendors, drivers, or logs | Field-level projections per role, phone masking, log redaction, private R2 bucket (§10) |
| T7 | **Document/proof exposure** — KYC, licences, delivery photos becoming public URLs | Private bucket, no public read, short-lived signed URLs after permission check (§9.3) |
| T8 | **Account takeover** | Session revocation, device list, lockout, notification on security events (§3) |
| T9 | **Inventory/order-race exploitation** — double-spend of last stock, duplicate orders | Row locks, idempotency, transactional state transitions (§8.3) |
| T10 | **Injection / XSS / CSRF** | Parameterized queries only, no `dangerouslySetInnerHTML` on untrusted input, sanitized CMS HTML, same-site cookies + origin checks (§7) |
| T11 | **Scraping / bot pressure** on catalog and search | Cloudflare bot management, edge rate limits, no bulk-export endpoints for public data |
| T12 | **Insider / admin misuse** | Granular permissions, audit log on every admin action, elevated permission for sensitive settings, PII reveal auditing (§11) |

---

## 2. Authentication

### 2.1 Supported methods

| Method | Flow | Notes |
|---|---|---|
| Phone OTP | Request → 6-digit code by SMS → verify → session | Primary method; matches existing product |
| Email + password | Credential login | **Only if [D-09] retains passwords** |
| Email OTP / magic link | Alternative to password | Pending **[D-09]** |

### 2.2 OTP rules

| Control | Value |
|---|---|
| Code length | 6 digits, cryptographically random (`crypto.getRandomValues`, not `Math.random`) |
| Storage | **Hashed** in `otp_verifications`. Never stored or logged in plaintext |
| Expiry | 5 minutes |
| Verification attempts | Max 5 per code, then the code is invalidated |
| Resend cooldown | 60 seconds |
| Requests per phone | 3 per 10 minutes, 8 per day |
| Requests per IP | 10 per hour |
| Single use | `consumed_at` set inside the verifying transaction |
| Enumeration | OTP request **always** returns a generic success; the response never reveals whether the number exists |
| Escalation | Turnstile challenge after repeated requests from an IP/device |
| Response to abuse | Progressive delay, then temporary block, plus a `system_events` alert |

### 2.3 Password rules (if [D-09] retains passwords)

Minimum 8 characters with a check against a common-password list (length and breach-checking beat composition rules). Hashing with a memory-hard algorithm — **argon2id preferred, scrypt as the Workers-compatible fallback** — with parameters recorded in config so they can be raised over time. Hash upgrades happen transparently on next successful login. Uniform failure messaging and near-constant response timing to prevent enumeration. Reset tokens are single-use, hashed at rest, 30-minute expiry, and invalidate all existing sessions on use.

### 2.4 Account lockout

10 failed attempts per identifier in 15 minutes → 15-minute lock with a clear message. Lockout is tracked per identifier **and** per IP so an attacker cannot lock out a legitimate user cheaply, and legitimate users are not punished for someone else's IP. Every lock writes `login_attempts` and a `system_events` row.

---

## 3. Sessions

| Property | Decision |
|---|---|
| Storage | Server-side `sessions` row, cached for read performance |
| Cookie | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only, `__Host-` prefixed |
| Cookie contents | Opaque session id + signed claims (`userId`, `roles`, `sessionId`, `exp`) used **only** for middleware routing |
| Token storage | Only a **hash** of the session token is persisted, so a database leak does not yield usable sessions |
| Lifetime | Customer 30 days rolling; vendor/driver 14 days; **admin 8 hours** with a 30-minute idle timeout (**confirm in [D-10]**) |
| Rotation | New token issued on privilege change and on OTP re-verification |
| Revocation | Individual, all-sessions, and forced on password change, role change, suspension or ban |
| Visibility | `/account/security` lists active sessions/devices with last-seen and allows revocation |

**Why claims live in the cookie at all:** the OpenNext Cloudflare adapter does not yet support Node middleware, so `middleware.ts` cannot query the database ([`ARCHITECTURE.md` §4.2](./ARCHITECTURE.md)). The signed claims let middleware make a cheap routing decision. They are explicitly **not** an authorization decision: a stale claim can get a request to a page shell, never to data, because the service layer revalidates the session against the store on every call. A revoked session therefore loses data access immediately, even if its cookie still parses.

---

## 4. Defence in depth: the four checkpoints

Every sensitive request passes all four. No layer is permitted to assume another already checked.

```text
1. Cloudflare edge   WAF rules, bot management, edge rate limits, TLS
2. Middleware        signature-verified cookie → coarse route gate (NO DB)
3. Service layer     authenticate() → authorize(permission) → ownership/scope
4. Repository layer  tenancy predicates + soft-delete filters in the query itself
```

Layer 4 is the backstop that makes T3 hard: even if a service function forgets a check, the repository query for a vendor-scoped resource is written to require the vendor id, so it cannot return another vendor's row.

---

## 5. Authorization (RBAC)

### 5.1 Model

Roles are **bundles of permissions**, not the unit of checking. Code always asks for a permission:

```text
can(actor, 'order:refund', { orderId })          → boolean
requirePermission(actor, 'order:refund', order)  → throws AuthorizationError
```

Checking permissions rather than role strings means adding an "Ops manager who can reassign drivers but not refund" needs a config change, not a code change — and there is no `if (role === 'ADMIN')` scattered through the codebase to audit.

### 5.2 Roles

| Role | Scope | Summary |
|---|---|---|
| `CUSTOMER` | self | Own cart, orders, addresses, reviews, tickets |
| `VENDOR_OWNER` | vendor | Full vendor dashboard incl. bank details, staff |
| `VENDOR_STAFF` | vendor | Orders, products, inventory. **No** bank details or staff management |
| `DRIVER` | self | Own availability, assignments, earnings, documents |
| `ADMIN_SUPPORT` | global | Read orders/customers, reply to tickets, no refunds, no settings |
| `ADMIN_OPS` | global | Orders, deliveries, dispatch, vendor/driver approval |
| `ADMIN_FINANCE` | global | Payments, refunds, payouts, financial reports |
| `ADMIN` | global | All operational + marketing + CMS, **not** RBAC or sensitive settings |
| `SUPER_ADMIN` | global | Everything incl. roles, permissions, sensitive settings, feature flags |

A user may hold several roles. The **active context is derived from the route** and validated server-side; it is never read from client state, and it never widens what a user can do.

### 5.3 Permission naming

`resource:action`, e.g. `order:view`, `order:refund`, `product:publish`, `vendor:approve`, `setting:manage_sensitive`. Permissions are seeded, versioned in migrations, and the full role↔permission matrix is editable at `/admin/roles` — except `SUPER_ADMIN`, which is immutable so the system cannot be locked out of itself.

### 5.4 Ownership and scope rules

| Actor | Rule |
|---|---|
| Customer | May only read/mutate rows where `user_id` = session user. Order/ticket/address access is ownership-checked, and a miss returns **404, not 403**, so ids cannot be enumerated |
| Vendor | Scope = `vendor_id` from the session's `user_roles` row. A `vendorId` in the URL or body is never authoritative — mismatch is a security event, not a 404 |
| Driver | May only act on deliveries currently assigned to them, or offers currently extended to them |
| Admin | Global read, but every mutation is permission-gated and audited |

### 5.5 Enforcement guarantees

- Every route handler and Server Action begins with authentication + authorization. **No exceptions for convenience** (master spec §28.18).
- Integration tests assert 401/403 for every endpoint × every role that should not have access. A new endpoint without such a test does not pass review — this is the check that stops silent auth regressions.
- An automated test enumerates registered routes against the RBAC map to catch an endpoint added without a permission entry.

---

## 6. Rate limiting and abuse protection

Two layers: Cloudflare edge rules for volumetric protection, and application-level counters (Redis-compatible store, **[D-03]**) for per-identity precision.

| Endpoint / action | Limit | Key |
|---|---|---|
| OTP request | 3 / 10 min; 8 / day | phone |
| OTP request | 10 / hour | IP |
| OTP verify | 5 / code; 20 / hour | phone + IP |
| Login | 10 / 15 min | identifier |
| Login | 30 / 15 min | IP |
| Signup | 5 / hour | IP |
| Password reset request | 3 / hour | identifier + IP |
| Search / suggestions | 30 / min | IP or session |
| Add to cart | 60 / min | session |
| Coupon apply | 10 / min | user |
| Order creation | 5 / min | user |
| Payment intent | 10 / hour | user |
| Upload authorize | 20 / hour | user |
| Support ticket create | 5 / hour | user |
| Review submit | 10 / day | user |
| Analytics events | 100 / min | session |
| Admin export/report | 10 / hour | user |
| Driver location ping | 1 / 15 s | driver |

Rules:

- Rate limiting **fails closed** on sensitive endpoints (OTP, login, order, payment): if the counter store is unavailable, requests are rejected rather than allowed unmetered.
- Responses use `429` with `Retry-After` and never leak how close a caller is to the limit.
- **Turnstile** on: vendor/driver registration, contact form, repeated OTP requests, repeated failed logins, review submission (master spec §4 Cloudflare).
- Spend alerts on the SMS provider are mandatory — SMS is the one attack with a direct, unbounded cash cost.

---

## 7. Input handling, CSRF, XSS

### Validation
Every external input — body, query, params, headers, cookies, webhook payloads, uploaded file metadata, imported CSV rows — is parsed with a Zod schema at the boundary. Schemas use strict object parsing so **unexpected fields are rejected, not silently dropped**. Server Actions validate their `FormData` with the same schema the client form uses; the client schema is a convenience, the server schema is the control.

### SQL injection
Only parameterized queries via the ORM's query builder. Raw SQL requires bound parameters and a review comment. String-concatenated SQL is prohibited. Sort/filter inputs map to an allowlist, never to a raw identifier.

### XSS
React escapes by default. `dangerouslySetInnerHTML` is banned except for CMS/blog content, which is **sanitized server-side on save** with a strict allowlist of tags/attributes — so stored content is safe regardless of how it is later rendered. A CSP (§9.5) provides the second layer.

### CSRF
Cookies are `SameSite=Lax`, which blocks cross-site form POSTs. In addition, all state-changing requests are `POST`/`PATCH`/`DELETE` (never `GET`), Server Actions carry Next.js's built-in action protection, and mutating route handlers verify `Origin`/`Sec-Fetch-Site` against an allowlist. Webhook endpoints are exempt from origin checks and rely on HMAC instead.

### SSRF
The maps/geocoding proxy and any future URL-fetching feature only call fixed, configured provider hosts. User-supplied URLs are never fetched server-side.

---

## 8. Payment and money integrity

### 8.1 Non-negotiables

1. **The client never sets a price.** Order totals are recomputed server-side from current catalog/promotion state inside the creating transaction. A client-supplied total may only be compared for a mismatch warning.
2. **Only a verified webhook (or the reconciliation job) marks a payment paid.** A frontend "success" callback triggers a *status check*, never a state change (master spec §22).
3. **Every money operation is idempotent** — order creation, capture, refund.
4. **Refunds can never exceed the captured amount**, enforced by a check against the sum of prior refunds inside the transaction.

### 8.2 Webhook verification

Raw body read before parsing → timing-safe HMAC comparison against the environment secret → timestamp freshness window → unique `provider_event_id` insert as the replay guard → transactional processing → post-commit side effects. Signature failures return `401`, are logged with the raw payload in `webhook_logs`, and raise a `system_events` warning; a burst of them is treated as an attack signal.

### 8.3 Race and concurrency controls

| Race | Control |
|---|---|
| Two orders for the last unit | `SELECT … FOR UPDATE` on the `inventory` row within the order transaction |
| Duplicate order from double-click/retry | `Idempotency-Key` + unique `orders.idempotency_key` |
| Coupon used beyond its per-user limit | Unique `(coupon_id, order_id)` plus a counted check inside the transaction |
| Webhook delivered twice | Unique `payment_events.provider_event_id` |
| Two drivers accepting one delivery | Conditional update on `deliveries.status`; loser gets `409 ASSIGNMENT_TAKEN` |
| Concurrent admin edits | `version` column optimistic locking |
| Refund issued twice | Idempotency key + refund-sum check |

Every one of these is covered by an integration test that runs the operations concurrently — the only way to know a race control works is to race it.

---

## 9. Data protection

### 9.1 Secrets
Environment variables only; Cloudflare Worker secrets in production, GitHub Actions secrets in CI. Never in source, never in client bundles, never in logs, never in error messages. Only `NEXT_PUBLIC_*` reaches the browser and must contain nothing sensitive. A secret-scanning check runs on every PR and blocks merge on a hit. Rotation procedure documented per provider; rotation is rehearsed, not theoretical.

### 9.2 Encryption
TLS 1.2+ everywhere, HSTS with preload. At rest: managed-database encryption plus **application-level encryption for the highest-sensitivity fields** — vendor bank account numbers and driver document numbers — stored encrypted with only a last-4 readable. Reveal is permission-gated and audited.

### 9.3 File uploads

| Control | Rule |
|---|---|
| Authorization | Server-issued, short-lived, purpose-scoped credentials. The browser never holds a bucket key |
| Type allowlist | Images: `jpeg`, `png`, `webp`. Documents: `pdf` + those images. **No SVG** (script vector), no archives, no office macros |
| Size caps | Product image 5 MB · KYC document 10 MB · delivery proof 5 MB · bulk import 20 MB |
| Content verification | Real content type re-checked server-side after upload; declared MIME alone is not trusted |
| Naming | Server-generated ULID keys. Client filenames are stored as metadata only, never used as a path |
| Isolation | Private bucket has **no public access**; reads only via signed URLs (≤ 5 min) after a permission check |
| Serving | Public assets served from a dedicated asset host, so any content-type surprise cannot run in the app's origin |

### 9.4 PII minimisation and role-based projection

| Actor | Sees |
|---|---|
| Vendor | Customer first name, masked phone (revealed only for an active order), delivery area/landmark. **Not** full address history, email, or other orders (master spec §14) |
| Driver | Recipient name, masked phone with click-to-reveal for the active delivery only, full delivery address **only while the delivery is active** |
| Admin support | Full data as required, every PII reveal audited |
| Analytics | Pseudonymous id only — no phone, email, address, or payment detail (master spec §36) |

Enforced by explicit column projections in the repository layer, not by omitting fields in the UI. A vendor API response cannot contain a full customer phone number, because the query never selects it.

**Never logged:** OTP codes, session tokens, password hashes, full card data, CVV, provider secrets, full addresses at info level, bank account numbers. A redaction allowlist is applied in the logger, and a unit test asserts that known-sensitive keys are stripped.

### 9.5 Security headers

Applied in middleware to every response:

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none';
                         base-uri 'self'; form-action 'self';
                         img-src 'self' data: <asset+images host>;
                         script-src 'self' <payment sdk> <analytics> 'nonce-…';
                         connect-src 'self' <providers>;
                         upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: geolocation=(self), camera=(self), microphone=(), payment=(self)
Cross-Origin-Opener-Policy: same-origin
```

CSP is rolled out report-only first, then enforced — a CSP that breaks checkout is worse than no CSP. Nonce-based script policy; `unsafe-inline` for scripts is not acceptable in the final state. `geolocation` and `camera` are allowed because location detection and delivery-proof capture need them.

### 9.6 Row-Level Security

Not used in V1. Tenancy is enforced in the repository layer plus service-level ownership checks. Rationale: the app connects as a single role through Hyperdrive, so per-request RLS context would need a session variable set on every connection — added complexity and a pooling footgun for a benefit we already get from a single data-access chokepoint. **Revisit if** direct SQL access is granted to non-application consumers (BI tools, vendor SQL access), which would make database-enforced isolation genuinely necessary.

---

## 10. Privacy and compliance

- **Data minimisation:** collect only what an order needs. Date of birth and gender are optional and must have a stated purpose before being added to any form.
- **Consent:** analytics/marketing consent banner scope depends on **[D-28]**; transactional messaging does not require consent, marketing does.
- **Right to deletion:** implemented as anonymise-in-place — PII scrubbed, financial and order records retained for statutory purposes, with an audit entry.
- **Driver location** is the most privacy-sensitive stream in the system: captured only during an active delivery, stored coarsely, purged on a schedule (**[D-29]**), and visible only to the customer of that delivery and authorized ops staff.
- **Retention** per [`DATABASE.md` §13](./DATABASE.md); enforced by cron, not by intention.
- **Data residency:** prefer an India (ap-south) region for the primary database (**[D-01]**). Indian regulatory expectations around payment-data localisation should be confirmed with your payment provider and counsel — flagged, not assumed.
- **Vendor/driver KYC documents** are retained only as long as the relationship plus a statutory window, then purged.

---

## 11. Audit, monitoring and response

### Audit log
Append-only `audit_logs` (no update/delete endpoints exist). Records: actor, role, hashed IP, user agent, action, entity, before/after diff with secrets filtered, reason, `request_id`, timestamp.

Mandatory audit events: login/logout/failed login, every admin mutation, order/payment/delivery state changes, refunds and payouts, vendor/driver approval and suspension, role/permission changes, settings and feature-flag changes, PII reveals, data exports, document reviews, manual inventory adjustments, impersonation if it is ever built.

### Monitoring and alerting
| Signal | Threshold |
|---|---|
| Webhook signature failures | Any burst → immediate alert |
| Failed login / OTP spike | Anomaly vs baseline |
| SMS spend | Daily budget alert |
| Payment failure rate | Sustained rise vs baseline |
| Orders stuck in `PENDING_PAYMENT` | Age > threshold (reconciliation gap) |
| 5xx rate, DLQ depth, DB latency/pool saturation | Standard thresholds |
| Permission-denied spike from one actor | Possible probing |

### Incident response
Documented severity levels, on-call contact, and a runbook covering: revoke all sessions, rotate a leaked secret, disable a compromised admin, enable maintenance mode, replay a failed webhook, roll back a deploy. Post-incident review is written up and any fix that prevents recurrence is tracked as work, not as a note.

---

## 12. Pre-production security checklist

Blocking gate before the DNS cutover (master spec §41 Phase 9, §46):

- [ ] All secrets rotated away from any development value; none present in git history
- [ ] `.env` files absent from the repository; secret scan clean
- [ ] Every endpoint has an automated authorization test for allowed **and** denied roles
- [ ] Rate limits verified live, including the fail-closed path
- [ ] Webhook signature verification tested with valid, invalid, and replayed payloads
- [ ] Order/payment idempotency verified under concurrent load
- [ ] Inventory and driver-assignment races tested concurrently
- [ ] Private R2 bucket confirmed non-public; signed URLs expire as configured
- [ ] Upload allowlist verified, including a rejected SVG and a MIME-spoofed file
- [ ] Security headers verified; CSP enforced without breaking checkout
- [ ] `noindex` verified on every authenticated route; `robots.txt` correct
- [ ] Cloudflare WAF, bot management and Turnstile active in production
- [ ] Admin session timeout and revocation verified
- [ ] Audit log verified populated for a full admin action sample
- [ ] Log redaction verified — no OTP, token or full-PII in any log sink
- [ ] Dependency audit clean of known high/critical vulnerabilities
- [ ] Backup restore rehearsed successfully in staging
- [ ] Incident runbook reviewed with whoever will be on call

---

## 13. Open security decisions

| # | Question | Impact |
|---|---|---|
| **[D-08]** | Auth library vs in-house | How much security-critical code we own and must test ourselves |
| **[D-09]** | Passwords retained? | Whether password hashing, reset flow and credential-stuffing defence are in scope at all |
| **[D-10]** | Session lifetimes per role | Confirm the proposed 30d/14d/8h split, especially the admin idle timeout |
| **[D-24]** | SMS provider | DLT template registration is a compliance prerequisite in India, with lead time |
| **[D-28]** | Analytics provider | Determines the consent banner requirement and its wording |
| **[D-29]** | Driver location retention | Privacy exposure vs dispute-resolution capability. **You must set the window** |
| **[D-31]** | Legacy data migration | Migrating legacy password hashes constrains the hashing choice; migrated PII inherits these obligations |
| — | Payment-data localisation obligations | Needs confirmation with the payment provider and counsel — **not something I should assume** |
