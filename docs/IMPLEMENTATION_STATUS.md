# Parthik implementation and production readiness

**Review date:** 24 October 2026  
**Repository:** [manshu145/parthik](https://github.com/manshu145/parthik)

This document separates repository code from live operational readiness. A route or service existing in GitHub does not, by itself, prove that the currently deployed instance uses it successfully.

## Branch and pull-request status

- `main` is the repository default branch.
- `develop` is the integration branch. It contains the customer core and transaction services, but still has some dashboard screens that are placeholders.
- [PR #17 — production readiness](https://github.com/manshu145/parthik/pull/17) contains the larger operational dashboard/API work for admin, vendor and driver areas. It is open and must pass all CI jobs before it is merged.
- Keep these branches distinct when reporting progress. A feature that exists only on PR #17 is not yet included in `develop`.

## Implemented code areas

The repository contains code for:

- Customer shell/PWA, English and Hindi routing, location selection/serviceability, catalog, search and cart.
- PostgreSQL schema/bootstrap and committed migrations.
- Firebase phone-token verification, application sessions and RBAC permissions.
- Checkout quoting, order creation/state transitions, cancellation policy engine, Razorpay adapter/webhooks, and COD cash-ledger services.
- Vendor product/inventory/order features, driver delivery/OTP/cash screens, and admin operational screens across orders, people, catalog, delivery, payments, cash, CMS, support, settings and permissions (some of this is in PR #17, not yet in `develop`).
- SEO, notification, analytics/health and support building blocks.

## Production launch gates

Do not treat the application as ready to accept real orders until each applicable item below is verified against the chosen deployment.

- [ ] Choose and document the supported production host. The architecture specification describes Cloudflare Workers/OpenNext/Hyperdrive, while PR #17 also contains a VPS Docker/Caddy path. The currently running VPS uses Nginx/systemd; do not mix deployment instructions without choosing a canonical release path.
- [ ] Configure a real PostgreSQL database, apply the committed migrations, seed reference data (not development demo fixtures), verify connectivity, and prove backup/restore.
- [ ] Set production environment values, rotate secrets, set a strong `AUTH_SECRET`, and ensure development/temporary authentication is disabled.
- [ ] Configure Firebase phone authentication, billing, restricted keys, App Check/reCAPTCHA and server-side identity settings; test login, revocation and banned/suspended-user behaviour.
- [ ] Configure Google Maps billing and restricted browser/server keys; verify real Places, Geocoding, route distance/ETA and zone-based serviceability.
- [ ] Configure Razorpay live keys and webhook secret, then test a real approved payment lifecycle, webhook signature failures/replays, reconciliation and refund operations before enabling prepaid checkout.
- [ ] Configure FCM/push and in-app notification flows. Decide whether push/in-app-only order updates are acceptable while email (D-25) and non-OTP SMS (D-34) remain blocked.
- [ ] Test the full customer → vendor → driver → delivery-OTP → order completion path with real DB-backed records.
- [ ] Verify cancellation/refund values (D-19a), tax/GST handling (D-14), and vendor store model (D-32) with the appropriate business/accounting owner; do not invent these rules.
- [ ] Verify role-based denies, audit trails, COD cash declare/verify separation, file-upload security, CSP, rate limits, data retention, monitoring, dependency scan and rollback.
- [ ] Complete the mobile/desktop Playwright E2E suite and monitor live health/error metrics after a staged deployment.
- [ ] Keep the old business data/system intact until any separate legacy migration plan has a rehearsed restore (D-31).

## Data and environment safety

- `pnpm seed` is for reference/configuration data; `pnpm seed:demo` is development/test fixture data and must not be used as production catalog or users.
- In-memory repository fallbacks are intended for development/preview. They are not a substitute for a production database.
- Missing optional credentials may let the app boot, but features depending on those credentials must fail visibly; a successful homepage response alone is not a launch check.

## Blocked or deferred business decisions

| Decision                         | Effect                                                                       |
| -------------------------------- | ---------------------------------------------------------------------------- |
| D-14 GST/tax                     | Tax calculations, tax display and invoices stay disabled until confirmed.    |
| D-19a cancellation/refund values | Order cancellation/refund permissions and amounts need agreed policy values. |
| D-25 transactional email         | No transactional email, email OTP fallback or email-based account recovery.  |
| D-32 vendor store model          | The vendor UI choice (one store vs multiple stores) is not final.            |
| D-34 non-OTP SMS                 | No order-status SMS; Firebase OTP does not supply general transactional SMS. |
| D-31 legacy data                 | Deliberately deferred; not part of the current cutover.                      |
| D-15 automated settlements       | V1 calculates payout records but vendor settlement remains manual.           |
