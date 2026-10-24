# Parthik — Security Architecture

**Status:** **APPROVED** design · **Version:** 1.1 · **Revised:** 2026-08-14 (Google-first services)
**Depends on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`API_SPEC.md`](./API_SPEC.md) · [`DATABASE.md`](./DATABASE.md)

> Governing rule from the master spec (§23): **roles must never be trusted from client-side state, and authorization is always server-side.** Every control below exists to make that true in practice rather than in principle.

---

## 1. Threat model

What we are actually defending against, in rough priority order for a hyperlocal commerce platform:

| #       | Threat                                                                                                                                                                   | Primary controls                                                                                                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1      | **OTP/SMS abuse** — pumping SMS to burn credit or brute-force codes. **Now partly outside our control**: Firebase bills per verification, so abuse costs money at Google | Firebase quotas + mandatory reCAPTCHA verifier, **Firebase App Check**, our own limits on `/auth/session`, **Google Cloud billing alerts on Identity Platform spend**, per-IP limits at the Cloudflare edge (§6) |
| T2      | **Payment tampering** — forged success, replayed webhooks, price manipulation                                                                                            | Server-side repricing, webhook HMAC + replay guard, idempotency, reconciliation (§8)                                                                                                                             |
| T3      | **Horizontal privilege escalation** — customer A reading customer B's order; vendor A seeing vendor B's data; driver reading arbitrary customer PII                      | Ownership checks in the service layer, tenancy scoping in repositories, session-derived scope only (§4, §5)                                                                                                      |
| T4      | **Vertical privilege escalation** — customer reaching admin capability                                                                                                   | Permission-based RBAC, deny-by-default, no role from client input (§5)                                                                                                                                           |
| T5      | **Coupon/discount abuse** — multi-account farming, reuse past limits, stacking                                                                                           | DB-level unique constraints on usage, per-user limits, first-order verification, phone-verified accounts (§9)                                                                                                    |
| T6      | **PII leakage** — customer addresses/phones exposed to vendors, drivers, or logs                                                                                         | Field-level projections per role, phone masking, log redaction, private R2 bucket (§10)                                                                                                                          |
| T7      | **Document/proof exposure** — KYC, licences, delivery photos becoming public URLs                                                                                        | Private bucket, no public read, short-lived signed URLs after permission check (§9.3)                                                                                                                            |
| T8      | **Account takeover**                                                                                                                                                     | Session revocation, device list, lockout, notification on security events (§3)                                                                                                                                   |
| T9      | **Inventory/order-race exploitation** — double-spend of last stock, duplicate orders                                                                                     | Row locks, idempotency, transactional state transitions (§8.3)                                                                                                                                                   |
| **T15** | **Firebase token forgery or replay** — a token from another project, an expired token, or an `alg` downgrade                                                             | Exhaustive verification in §2.2: signature, `iss`, `aud`, `exp`, provider, RS256-only                                                                                                                            |
| **T16** | **Firebase service-account key compromise** — the key can act on any user account                                                                                        | Worker secret only, never in source or client bundle, minimum IAM roles, documented rotation, Cloud Audit Logs on service-account use                                                                            |
| T10     | **Injection / XSS / CSRF**                                                                                                                                               | Parameterized queries only, no `dangerouslySetInnerHTML` on untrusted input, sanitized CMS HTML, same-site cookies + origin checks (§7)                                                                          |
| T11     | **Scraping / bot pressure** on catalog and search                                                                                                                        | Cloudflare bot management, edge rate limits, no bulk-export endpoints for public data                                                                                                                            |
| T12     | **Insider / admin misuse**                                                                                                                                               | Granular permissions, audit log on every admin action, elevated permission for sensitive settings, PII reveal auditing (§11)                                                                                     |
| **T13** | **COD cash loss or theft** — driver absconds with collected cash, under-declares a deposit, or accumulates unbounded cash                                                | Append-only cash ledger, per-driver cash limit blocking further COD dispatch, two-step declare/verify deposits, variance recording, aged-cash alerts (§8.4)                                                      |
| **T14** | **Delivery OTP bypass** — driver marks delivered without the customer present                                                                                            | OTP mandatory (D-20), hashed, attempt-capped; photo/signature exception path is audited and reportable                                                                                                           |

---

## 2. Authentication

### 2.1 Supported methods

**D-08/D-24: Firebase Authentication is the identity provider. D-09: no passwords.**

| Method                  | Flow                                                                   | Status                                                                        |
| ----------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Firebase Phone Auth** | Firebase JS SDK → OTP SMS → ID token → exchanged for a Parthik session | **Primary and only method in V1**                                             |
| Email OTP               | —                                                                      | 🔴 **Unavailable** — requires email delivery, blocked by D-25                 |
| Email + password        | —                                                                      | **Not implemented.** No `password_hash`, no reset flow, no password endpoints |

**Security consequences of moving OTP to Firebase — both directions, honestly:**

| Improved                                                                                           | Worsened                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| We no longer store, transmit or log OTP codes at all — an entire class of leak becomes impossible  | **We lose visibility.** Firebase's OTP attempt counts, per-number abuse signals and blocked attempts are not in our logs, so our detection surface shrinks to the token-exchange step |
| Google operates SMS delivery, brute-force protection and quota enforcement at a scale we could not | **We lose control** of sender ID, message wording and language — the OTP SMS will not be reliably Hindi despite D-33                                                                  |
| No DLT registration for OTP, and no SMS provider credentials to protect                            | **A new highly privileged secret exists**: the Firebase service-account key, which can act on any user account                                                                        |
| reCAPTCHA/App Check protection is built into the flow                                              | Firebase Phone Auth **SMS is billed per verification**, so abuse has a direct cash cost we cannot throttle at the source                                                              |

### 2.2 Firebase token verification — the critical control

`POST /auth/session` is the entire front door. The Firebase **Admin SDK cannot run on Workers**, so verification is implemented manually with Web Crypto and must be treated as security-critical code with its own dedicated tests.

| Check                       | Requirement                                                                                                                                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signature                   | RS256 against Google's current x509 signing certs for `securetoken@system.gserviceaccount.com`, fetched over HTTPS, cached per `Cache-Control`, refreshed on key rotation. **Never skipped on cache miss** |
| `iss`                       | Exactly `https://securetoken.google.com/<projectId>`                                                                                                                                                       |
| `aud`                       | Exactly `<projectId>` — stops a token minted for a different Firebase project being replayed at us                                                                                                         |
| `exp` / `iat` / `auth_time` | Not expired, not future-dated, `auth_time` present                                                                                                                                                         |
| `sub`                       | Non-empty; becomes `firebase_uid`                                                                                                                                                                          |
| `firebase.sign_in_provider` | Must be `phone` in V1 — rejects any provider we have not deliberately enabled                                                                                                                              |
| `phone_number`              | Must be present                                                                                                                                                                                            |
| Identity source             | **Phone and email come from token claims only.** A client-supplied phone in the request body is ignored entirely                                                                                           |
| Account state               | `SUSPENDED`/`BANNED` rejected **before** a session is created                                                                                                                                              |

**Algorithm confusion is explicitly guarded:** the verifier accepts `RS256` only and rejects `alg: none` or any HMAC variant, rather than trusting the token header. Failures return `401` with no indication of which check failed, and are logged as security events; a burst is treated as an attack signal.

### 2.3 OTP rules — now split by purpose

| OTP type                | Owner        | Controls                                                                                                       |
| ----------------------- | ------------ | -------------------------------------------------------------------------------------------------------------- |
| **Login OTP**           | **Firebase** | Google's quotas, mandatory reCAPTCHA verifier, per-number throttling. We add our own limits on `/auth/session` |
| **Delivery OTP** (D-20) | **Parthik**  | Still entirely ours — rules below                                                                              |

Delivery OTP: 6 digits from `crypto.getRandomValues`, **hashed** in `otp_verifications`, never logged, maximum 5 verification attempts, expiry tied to the delivery window, single use via `consumed_at` set inside the verifying transaction.

### 2.3b Passwords — not applicable

**No passwords exist in V1 (D-09), and Firebase now owns credentials entirely.** If passwords were ever reintroduced they would be Firebase's email/password provider rather than our own hashing, which removes the argon2id/scrypt decision from our scope altogether. Documented for contingency only, not built.

### 2.4 Account lockout

**Scope narrowed by Firebase.** Login OTP attempt lockout is Firebase's responsibility and is not visible to us. What we lock is the **token-exchange endpoint**.

An important keying subtlety: a request whose token fails verification yields **no trustworthy identifier** — the `sub` claim cannot be trusted precisely because the signature did not verify. So:

| Outcome                                                | Lockout key                                                                                                                                                                   |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Token **fails** verification                           | **IP only** (20 failures/hour → block + alert). Any uid in the payload is attacker-controlled and must not be used as a key, or an attacker could lock out arbitrary accounts |
| Token **verifies** but the account is suspended/banned | `firebase_uid` — safe, because the signature proved it                                                                                                                        |

Every lock writes `login_attempts` and a `system_events` row. Lockout is tracked per identifier **and** per IP so an attacker cannot lock out a legitimate user cheaply, and legitimate users are not punished for someone else's IP. Every lock writes `login_attempts` and a `system_events` row.

---

## 3. Sessions

| Property        | Decision                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider        | **Firebase Authentication** verifies identity; **Parthik issues and owns the session** (D-10)                                                                                                                                                                          |
| Storage         | Server-side `sessions` row, cached for read performance                                                                                                                                                                                                                |
| Cookie          | `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, host-only, `__Host-` prefixed                                                                                                                                                                                          |
| Cookie contents | Opaque session id + signed claims (`userId`, `roles`, `sessionId`, `exp`) used **only** for middleware routing                                                                                                                                                         |
| Token storage   | Only a **hash** of the session token is persisted, so a database leak does not yield usable sessions                                                                                                                                                                   |
| Lifetime        | **Approved (D-10):** customer 30 days rolling · vendor/driver 14 days · **admin 8 hours with a 30-minute idle timeout**                                                                                                                                                |
| Rotation        | New token issued on privilege change and on re-authentication                                                                                                                                                                                                          |
| Revocation      | Individual and all-sessions; forced on role change, suspension or ban. **`logout-all` also revokes Firebase refresh tokens** via Identity Platform REST (D-36) — revoking only our session would let the client mint a fresh ID token and immediately re-establish one |
| Visibility      | `/account/security` lists active sessions/devices with last-seen and allows revocation                                                                                                                                                                                 |

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

| Role            | Scope  | Summary                                                                                                    |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| `CUSTOMER`      | self   | Own cart, orders, addresses, reviews, tickets                                                              |
| `VENDOR_OWNER`  | vendor | Full vendor dashboard incl. bank details, staff                                                            |
| `VENDOR_STAFF`  | vendor | Orders, products, inventory. **No** bank details or staff management                                       |
| `DRIVER`        | self   | Own availability, assignments, earnings, documents                                                         |
| `ADMIN_SUPPORT` | global | Read orders/customers, reply to tickets, no refunds, no settings                                           |
| `ADMIN_OPS`     | global | Orders, deliveries, dispatch, vendor/driver approval                                                       |
| `ADMIN_FINANCE` | global | Payments, refunds, payouts, financial reports, **COD cash reconciliation** (`cash:view`, `cash:reconcile`) |
| `ADMIN`         | global | All operational + marketing + CMS, **not** RBAC or sensitive settings                                      |
| `SUPER_ADMIN`   | global | Everything incl. roles, permissions, sensitive settings, feature flags                                     |

A user may hold several roles. The **active context is derived from the route** and validated server-side; it is never read from client state, and it never widens what a user can do.

#### COD cash permissions — assignment requires confirmation

The COD flow introduced three permissions that the role table above did not previously assign to anyone. Proposed mapping, deliberately following separation of duties (§8.4):

| Permission       | Proposed roles               | Rationale                                                                                                                      |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cash:view`      | `ADMIN_FINANCE`, `ADMIN_OPS` | Ops needs to see which drivers are over the cash limit to understand dispatch behaviour                                        |
| `cash:reconcile` | `ADMIN_FINANCE` only         | Verifying a deposit is a financial control                                                                                     |
| `cash:adjust`    | `SUPER_ADMIN` only           | Write-offs and shortfall adjustments move money on paper. Deliberately **not** granted to the same role that verifies deposits |

> ⚠️ **CONFIRM:** this is an authorization decision, not a technical one. Granting `cash:reconcile` and `cash:adjust` to the same person removes the separation of duties that makes cash fraud detectable. Please confirm or amend before TASK 011b.

### 5.3 Permission naming

`resource:action`, e.g. `order:view`, `order:refund`, `product:publish`, `vendor:approve`, `setting:manage_sensitive`. Permissions are seeded, versioned in migrations, and the full role↔permission matrix is editable at `/admin/roles` — except `SUPER_ADMIN`, which is immutable so the system cannot be locked out of itself.

### 5.4 Ownership and scope rules

| Actor    | Rule                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer | May only read/mutate rows where `user_id` = session user. Order/ticket/address access is ownership-checked, and a miss returns **404, not 403**, so ids cannot be enumerated |
| Vendor   | Scope = `vendor_id` from the session's `user_roles` row. A `vendorId` in the URL or body is never authoritative — mismatch is a security event, not a 404                    |
| Driver   | May only act on deliveries currently assigned to them, or offers currently extended to them                                                                                  |
| Admin    | Global read, but every mutation is permission-gated and audited                                                                                                              |

### 5.5 Enforcement guarantees

- Every route handler and Server Action begins with authentication + authorization. **No exceptions for convenience** (master spec §28.18).
- Integration tests assert 401/403 for every endpoint × every role that should not have access. A new endpoint without such a test does not pass review — this is the check that stops silent auth regressions.
- An automated test enumerates registered routes against the RBAC map to catch an endpoint added without a permission entry.

---

## 6. Rate limiting and abuse protection

Two layers: Cloudflare edge rules for volumetric protection, and application-level counters (Redis-compatible HTTP store, D-03) for per-identity precision.

| Endpoint / action        | Limit               | Key           |
| ------------------------ | ------------------- | ------------- |
| OTP request              | 3 / 10 min; 8 / day | phone         |
| OTP request              | 10 / hour           | IP            |
| OTP verify               | 5 / code; 20 / hour | phone + IP    |
| OTP login attempt        | 10 / 15 min         | identifier    |
| Login                    | 30 / 15 min         | IP            |
| Signup                   | 5 / hour            | IP            |
| Email OTP request        | 3 / 10 min          | email         |
| Cash deposit declaration | 10 / day            | driver        |
| Search / suggestions     | 30 / min            | IP or session |
| Add to cart              | 60 / min            | session       |
| Coupon apply             | 10 / min            | user          |
| Order creation           | 5 / min             | user          |
| Payment intent           | 10 / hour           | user          |
| Upload authorize         | 20 / hour           | user          |
| Support ticket create    | 5 / hour            | user          |
| Review submit            | 10 / day            | user          |
| Analytics events         | 100 / min           | session       |
| Admin export/report      | 10 / hour           | user          |
| Driver location ping     | 1 / 15 s            | driver        |
| Delivery OTP verify      | 5 / delivery        | delivery      |

Rules:

- Rate limiting **fails closed** on sensitive endpoints (OTP, login, order, payment): if the counter store is unavailable, requests are rejected rather than allowed unmetered.
- Responses use `429` with `Retry-After` and never leak how close a caller is to the limit.
- **Bot protection is split by owner (D-35).** Firebase mandates its own reCAPTCHA verifier on Phone Auth, so:
  - **reCAPTCHA (Firebase)** — the sign-in flow. Repeated OTP requests and OTP brute-force are throttled by Google, not by us.
  - **Cloudflare Turnstile** — vendor/driver registration, contact form, review submission. Non-auth public forms only.
  - **Firebase App Check** — attests that Firebase API calls come from our real app rather than a script.
    Consolidating to one system is **D-35a**, still open.
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
2. **Only a verified webhook (or the reconciliation job) marks a payment paid.** A frontend "success" callback triggers a _status check_, never a state change (master spec §22).
3. **Every money operation is idempotent** — order creation, capture, refund.
4. **Refunds can never exceed the captured amount**, enforced by a check against the sum of prior refunds inside the transaction.

### 8.2 Webhook verification

Raw body read before parsing → timing-safe HMAC comparison against the environment secret → timestamp freshness window → unique `provider_event_id` insert as the replay guard → transactional processing → post-commit side effects. Signature failures return `401`, are logged with the raw payload in `webhook_logs`, and raise a `system_events` warning; a burst of them is treated as an attack signal.

### 8.3 Race and concurrency controls

| Race                                    | Control                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Two orders for the last unit            | `SELECT … FOR UPDATE` on the `inventory` row within the order transaction    |
| Duplicate order from double-click/retry | `Idempotency-Key` + unique `orders.idempotency_key`                          |
| Coupon used beyond its per-user limit   | Unique `(coupon_id, order_id)` plus a counted check inside the transaction   |
| Webhook delivered twice                 | Unique `payment_events.provider_event_id`                                    |
| Two drivers accepting one delivery      | Conditional update on `deliveries.status`; loser gets `409 ASSIGNMENT_TAKEN` |
| Concurrent admin edits                  | `version` column optimistic locking                                          |
| Refund issued twice                     | Idempotency key + refund-sum check                                           |

Every one of these is covered by an integration test that runs the operations concurrently — the only way to know a race control works is to race it.

### 8.4 COD cash integrity (D-12)

Cash is the one value in the system that leaves the database entirely, so the controls are about **custody and detection** rather than cryptography.

| Control                                   | Mechanism                                                                                                                                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No mutable balance                        | Cash in hand is **derived** by summing `driver_cash_ledger`. There is no field an attacker or a bug can simply overwrite                                                                       |
| Collection cannot be double-recorded      | Unique index on `(delivery_id, entry_type) WHERE entry_type='COLLECTION'` — a retried delivery confirmation is inert                                                                           |
| Collection is atomic with delivery        | OTP verification, delivery status, payment `PAID` and the ledger entry all commit together. Cash marked collected without a delivery, or a delivery without a cash record, are both impossible |
| Exposure is bounded                       | Per-order COD cap and a per-driver cash-in-hand limit that **removes the driver from COD dispatch** until they deposit                                                                         |
| Deposits are two-step                     | A driver _declares_; an admin _verifies_. Only verification writes the reducing ledger entry, so a driver cannot clear their own liability                                                     |
| Variance is recorded, not reconciled away | Declared vs verified, and expected vs collected, are both stored and reportable                                                                                                                |
| Adjustments are privileged                | `cash:adjust` is a distinct permission, always audited with a mandatory reason. Write-offs are visible, not quiet                                                                              |
| Aged cash is surfaced                     | Cron alerts on cash held beyond `cod.deposit_grace_hours`                                                                                                                                      |

**Separation of duties:** the permissions `cash:view`, `cash:reconcile` and `cash:adjust` are deliberately distinct so that verifying a deposit and writing off a shortfall need not be the same person. Granting all three to one role is a business choice, and it should be a conscious one.

---

## 9. Data protection

### 9.1 Secrets

**`FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` is now the most sensitive secret in the system** — it signs JWTs for the Identity Platform REST API and can therefore act on any user account. Minimum IAM roles, Worker secret only, excluded from all logs, documented rotation schedule, and its use monitored through Cloud Audit Logs. The Google Maps **server** key and **browser** key are separate, restricted by IP and HTTP referrer respectively, so a leaked browser key cannot drive billable Geocoding/Routes calls.

Environment variables only; Cloudflare Worker secrets in production, GitHub Actions secrets in CI. Never in source, never in client bundles, never in logs, never in error messages. Only `NEXT_PUBLIC_*` reaches the browser and must contain nothing sensitive. A secret-scanning check runs on every PR and blocks merge on a hit. Rotation procedure documented per provider; rotation is rehearsed, not theoretical.

### 9.2 Encryption

TLS 1.2+ everywhere, HSTS with preload. At rest: managed-database encryption plus **application-level encryption for the highest-sensitivity fields** — vendor bank account numbers and driver document numbers — stored encrypted with only a last-4 readable. Reveal is permission-gated and audited.

### 9.3 File uploads

| Control              | Rule                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Authorization        | Server-issued, short-lived, purpose-scoped credentials. The browser never holds a bucket key                              |
| Type allowlist       | Images: `jpeg`, `png`, `webp`. Documents: `pdf` + those images. **No SVG** (script vector), no archives, no office macros |
| Size caps            | Product image 5 MB · KYC document 10 MB · delivery proof 5 MB · bulk import 20 MB                                         |
| Content verification | Real content type re-checked server-side after upload; declared MIME alone is not trusted                                 |
| Naming               | Server-generated ULID keys. Client filenames are stored as metadata only, never used as a path                            |
| Isolation            | Private bucket has **no public access**; reads only via signed URLs (≤ 5 min) after a permission check                    |
| Serving              | Public assets served from a dedicated asset host, so any content-type surprise cannot run in the app's origin             |

### 9.4 PII minimisation and role-based projection

| Actor         | Sees                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vendor        | Customer first name, masked phone (revealed only for an active order), delivery area/landmark. **Not** full address history, email, or other orders (master spec §14)      |
| Driver        | Recipient name, masked phone with click-to-reveal for the active delivery only, full delivery address **only while the delivery is active**, and the COD amount to collect |
| Admin support | Full data as required, every PII reveal audited                                                                                                                            |
| Analytics     | Pseudonymous id only — no phone, email, address, or payment detail (master spec §36)                                                                                       |

Enforced by explicit column projections in the repository layer, not by omitting fields in the UI. A vendor API response cannot contain a full customer phone number, because the query never selects it.

**Never logged:** OTP codes, session tokens, password hashes, full card data, CVV, provider secrets, full addresses at info level, bank account numbers. A redaction allowlist is applied in the logger, and a unit test asserts that known-sensitive keys are stripped.

### 9.5 Security headers

Applied in middleware to every response:

```text
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; frame-ancestors 'none'; object-src 'none';
                         base-uri 'self'; form-action 'self';
                         img-src 'self' data: <asset+images host>
                                 https://*.googleapis.com https://*.gstatic.com;
                         script-src 'self' 'nonce-…'
                                 https://checkout.razorpay.com
                                 https://www.google.com https://www.gstatic.com
                                 https://apis.google.com
                                 https://*.googletagmanager.com;
                         connect-src 'self'
                                 https://identitytoolkit.googleapis.com
                                 https://securetoken.googleapis.com
                                 https://fcmregistrations.googleapis.com
                                 https://*.google-analytics.com
                                 https://*.googleapis.com
                                 https://api.razorpay.com;
                         frame-src https://www.google.com
                                 https://<project>.firebaseapp.com
                                 https://api.razorpay.com;
                         upgrade-insecure-requests
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
X-Frame-Options: DENY
Permissions-Policy: geolocation=(self), camera=(self), microphone=(), payment=(self)
Cross-Origin-Opener-Policy: same-origin
```

**Honest cost of this strategy:** `frame-ancestors 'none'` is retained, but Firebase's reCAPTCHA verifier, the Firebase auth handler domain and the Razorpay checkout all need `frame-src` and `script-src` allowances. The resulting CSP is materially wider than it would be with fewer third-party SDKs.

CSP is rolled out report-only first, then enforced — a CSP that breaks sign-in or checkout is worse than no CSP. Nonce-based script policy; `unsafe-inline` for scripts is not acceptable in the final state. `geolocation` and `camera` are allowed because location detection and delivery-proof capture need them.

### 9.6 Row-Level Security

Not used in V1. Tenancy is enforced in the repository layer plus service-level ownership checks. Rationale: the app connects as a single role through Hyperdrive, so per-request RLS context would need a session variable set on every connection — added complexity and a pooling footgun for a benefit we already get from a single data-access chokepoint. **Revisit if** direct SQL access is granted to non-application consumers (BI tools, vendor SQL access), which would make database-enforced isolation genuinely necessary.

---

## 10. Privacy and compliance

- **Data minimisation:** collect only what an order needs. Date of birth and gender are optional and must have a stated purpose before being added to any form.
- **Consent:** **GA4/Firebase Analytics set cookies and collect identifiers, so a consent banner is required** (D-28) and its scope must be defined before launch. Transactional messaging does not require consent; marketing does. Google Consent Mode should be configured so analytics respects the choice rather than being bolted on afterwards.
- **Right to deletion:** implemented as anonymise-in-place — PII scrubbed, financial and order records retained for statutory purposes, with an audit entry.
- **Driver location** is the most privacy-sensitive stream in the system. Approved handling (D-29 + clarification C-1) splits it in two:

  | Class                      | Purpose                                     | Retention                                                                   |
  | -------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- |
  | Ephemeral current position | Auto-nearest dispatch (D-18) while `ONLINE` | Overwritten per ping, **deleted on going offline**. Never a queryable trail |
  | Active-delivery trail      | Tracking and dispute resolution             | **Purged after 7 days**                                                     |

  No long-term movement history of any driver is retained. Drivers must be told at onboarding that their live position is used for assignment while they are online — using it silently would be the actual privacy failure here. The trail is visible only to the customer of that delivery and authorized ops staff.

- **Retention** per [`DATABASE.md` §13](./DATABASE.md); enforced by cron, not by intention.
- **Data residency:** prefer an India (ap-south) region for the primary database (D-01, region pick open as D-01a). Indian regulatory expectations around payment-data localisation should be confirmed with your payment provider and counsel — flagged, not assumed.
- **Vendor/driver KYC documents** are retained only as long as the relationship plus a statutory window, then purged.

---

## 11. Audit, monitoring and response

### Audit log

Append-only `audit_logs` (no update/delete endpoints exist). Records: actor, role, hashed IP, user agent, action, entity, before/after diff with secrets filtered, reason, `request_id`, timestamp.

Mandatory audit events: login/logout/failed login, every admin mutation, order/payment/delivery state changes, refunds and payouts, vendor/driver approval and suspension, role/permission changes, settings and feature-flag changes, PII reveals, data exports, document reviews, manual inventory adjustments, **cash deposit verification, cash adjustments and write-offs, COD collection variances, delivery-proof exception use (photo/signature instead of OTP)**, cancellation-policy edits, and impersonation if it is ever built.

### Monitoring and alerting

| Signal                                          | Threshold                                                                                                               |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Webhook signature failures                      | Any burst → immediate alert                                                                                             |
| Failed `/auth/session` exchanges                | Anomaly vs baseline — **our primary auth signal now that Firebase owns OTP**                                            |
| **Identity Platform SMS spend**                 | **Google Cloud billing alert — mandatory.** Phone Auth bills per verification, so this is the direct financial exposure |
| Firebase service-account key use                | Cloud Audit Logs anomaly                                                                                                |
| Payment failure rate                            | Sustained rise vs baseline                                                                                              |
| Orders stuck in `PENDING_PAYMENT`               | Age > threshold (reconciliation gap)                                                                                    |
| 5xx rate, DLQ depth, DB latency/pool saturation | Standard thresholds                                                                                                     |
| Permission-denied spike from one actor          | Possible probing                                                                                                        |
| Driver cash held beyond grace period            | Cash-loss exposure                                                                                                      |
| COD collection variance rate                    | Rising trend suggests process or integrity problem                                                                      |
| Delivery-proof exception rate per driver        | OTP bypass pattern                                                                                                      |

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
- [ ] Firebase token verification tested: valid, expired, wrong `aud`, wrong `iss`, wrong provider, `alg: none`, HMAC downgrade, tampered payload
- [ ] Firebase service-account key confirmed absent from source, client bundle and logs; IAM roles minimal
- [ ] Google Cloud **billing alert on Identity Platform SMS spend** active
- [ ] Firebase App Check enabled and enforced on auth
- [ ] Maps browser key referrer-restricted; server key IP-restricted and never shipped to the client
- [ ] `logout-all` verified to revoke **Firebase refresh tokens** as well as Parthik sessions
- [ ] COD: cash ledger idempotency verified under retry; driver cash limit blocks dispatch
- [ ] COD: deposit declare/verify separation verified; a driver cannot self-verify
- [ ] Delivery OTP mandatory path verified; exception path audited
- [ ] Driver ephemeral position confirmed deleted on going offline
- [ ] Location trail purge job verified at 7 days
- [ ] Hindi locale: no untranslated key leaks to UI; fallback renders English, never a raw key
- [ ] Confirmed **no tax line and no invoice** is rendered anywhere (D-14 blocked)
- [ ] Backup restore rehearsed successfully in staging
- [ ] Incident runbook reviewed with whoever will be on call

---

## 13. Decision status affecting security

### Resolved

| Decision      | Security outcome                                                                                                                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-09**      | **No passwords.** Eliminates credential stuffing, reuse, weak enrolment, reset-token interception and hash cracking. Increases dependence on SMS deliverability |
| **D-10**      | Session lifetimes fixed: customer 30 d, vendor/driver 14 d, admin 8 h + 30 min idle                                                                             |
| **D-12**      | COD introduces T13 (cash loss) with the §8.4 control set and three separated cash permissions                                                                   |
| **D-13**      | Razorpay webhook HMAC verification and replay guard per §8.2                                                                                                    |
| **D-20**      | Delivery OTP mandatory — closes the T14 bypass; exception use is audited                                                                                        |
| **D-23**      | Google Maps called **server-side only**; key never reaches the browser                                                                                          |
| **D-08/D-24** | **Firebase Authentication.** OTP codes never touch our systems; verification per §2.2                                                                           |
| **D-36**      | Identity Platform REST with a service-account-signed JWT; Admin SDK unusable on Workers                                                                         |
| **D-26**      | FCM — registration tokens are per-device and pruned when invalid                                                                                                |
| **D-27/D-28** | Cloud Logging/Monitoring and GA4/Firebase Analytics — both must respect the log-redaction allowlist; **no PII to either**                                       |
| **D-35**      | reCAPTCHA on Firebase auth (mandated) + Turnstile on other public forms                                                                                         |
| **D-29**      | Two-class location model above; no long-term driver movement history                                                                                            |
| **D-31**      | **No legacy PII enters the system yet**, which removes migration-inherited data risk from V1                                                                    |
| **D-33**      | Hindi templates must be DLT-registered separately; translated content is sanitized on save identically to English                                               |

### 🔴 Blocked

| Decision             | Security consequence                                                                                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D-25 email**       | 🔴 No email channel. **Password reset, email verification and email-based account recovery do not exist**, which removes those attack surfaces but also removes every account-recovery path other than the phone number. **A user who loses their phone number loses the account** — confirm this is acceptable |
| **D-34 non-OTP SMS** | 🔴 No SMS channel for order events. Security notifications (new device sign-in, role change) can only reach users via push/in-app                                                                                                                                                                               |
| **D-14 GST/tax**     | No invoices are generated, so no invoice-tampering or tax-misstatement surface exists yet. When unblocked, invoice generation and access control need their own review                                                                                                                                          |

### Still requires external confirmation

| Item                                                          | Why                                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Payment-data localisation obligations under Indian regulation | Must be confirmed with Razorpay and counsel. **Not something I should assume**, and it may constrain the D-01a region choice |
| ~~DLT registration~~                                          | ✅ **No longer required for OTP** — Firebase operates that path. It returns only if D-34 is unblocked                        |
| Firebase project region / data residency                      | Confirm where Identity Platform stores user data, alongside the payment-localisation question                                |
