---
inclusion: always
---

# External provider credentials — development workflow

**Approved 2026-08-14. Applies to every remaining task.**

## Rule

**Never block development on external API credentials.** Live credentials for
Google Maps, Firebase billing, payment gateways, SMS, email or any other external
service are provisioned near the **final integration phase**, once the complete
application is available in preview.

Do not ask the product owner to configure billing or API keys before then.

## What this requires of every provider integration

1. **A clean interface first.** Business modules depend on an interface in
   `lib/<provider>/types.ts`, never on a vendor SDK type.
2. **A deterministic mock implementation** usable in development and tests.
   Deterministic means the same input always yields the same output, so tests
   assert real values rather than "something was returned".
3. **Environment-based selection** via a factory. A `<PROVIDER>_PROVIDER` variable
   accepts `auto` (default), `mock`, or the real adapter name.
4. **`auto` resolves to mock when credentials are absent** in development, preview
   and test — so a fresh clone works with no secrets at all.
5. **Mock providers are refused in production.** `auto` in production resolves to
   the real adapter and raises a typed `ConfigurationError` (503) if credentials
   are missing. A mock must never silently serve real customers.

## Non-negotiables

- **Never hardcode a key**, not even a test one. All credentials come from
  validated config in `lib/config/env.ts`.
- **Never weaken validation because credentials are missing.** Input validation,
  authorization and business rules run identically against mock and real
  providers. A mock replaces the _network call_, nothing else.
- **Provider configuration status is exposed in development diagnostics only.**
  `/api/v1/diagnostics/*` returns 404 in production. Never reveal which providers
  are configured, or any part of a key, on a public surface.
- **The application must build, run and pass its full test suite with no external
  credentials.** If a task cannot be completed without a key, the interface and
  mock are still delivered and the gap is reported — the task is not paused.

## Verification

Every task must pass `pnpm verify` and `pnpm cf:build` on a checkout with **no
`.env.local` at all**. If that fails, the abstraction is wrong.
