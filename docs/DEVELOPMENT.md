# Development guide

Practical guide for working in this repository. Architecture rationale lives in [`ARCHITECTURE.md`](./ARCHITECTURE.md); this file is about day-to-day mechanics.

## Prerequisites

| Tool    | Version                                  |
| ------- | ---------------------------------------- |
| Node.js | 22 LTS                                   |
| pnpm    | 10+                                      |
| Docker  | Only from TASK 002, for local PostgreSQL |

## First run

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Nothing in `.env.local` is required. Every provider is optional and the app degrades safely — see [Provider configuration](#provider-configuration).

## Verification

Run before pushing. CI runs the same steps.

```bash
pnpm verify                             # typecheck + lint + format + test + build
pnpm cf:build                           # Cloudflare Workers target
bash scripts/verify-runtime.sh          # boot and smoke-test the built app
bash scripts/check-secrets.sh           # no committed credentials
bash scripts/db-integration-check.sh    # real PostgreSQL: schema + seeds + SQL
```

`pnpm cf:build` matters: the Workers bundle can fail even when `next build` succeeds. It already caught one real issue — `pg` pulls in a `pg-cloudflare` shim whose published entry point does not resolve, which is why this project uses `postgres.js`.

### `db-integration-check.sh`

Spins up a throwaway PostgreSQL container, applies the schema, seeds it, and executes every catalog query. Needs `docker` or `podman`; it skips cleanly when neither is present. It writes **no migration files** — `drizzle-kit export` prints SQL to stdout — and never touches a shared database.

This is the only check that runs real SQL. Drizzle typechecks the query _builder_, not the statement it emits, and the unit suite runs against in-memory repositories. Both of those pass on SQL that PostgreSQL rejects. It has already caught two bugs that nothing else could:

| Bug                                                             | Why nothing else caught it                                                                                                                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `search_vector_*` columns declared `text` instead of `tsvector` | A GIN index over `text` has no default operator class, so `CREATE INDEX ... USING gin` failed and **the whole schema could not be created**. Typechecked fine.                                                     |
| Translation CTEs aliased `t_${locale}`                          | The requested and fallback CTEs collided whenever the requested locale _was_ the fallback — i.e. **every English request**, the default. PostgreSQL rejected it with `Alias "t_en" is already used in this query`. |

> ⚠️ **PostgreSQL version.** Every primary key defaults to `uuidv7()`, which is native only in **PostgreSQL 18+**. `docs/DATABASE.md` and `docs/ARCHITECTURE.md` both state "PostgreSQL 16+". These disagree, and it matters for the managed-provider choice (D-01a). On a server below 18 this script installs a non-time-sortable `uuidv7()` shim so the rest of the schema can still be validated — that shim is for local validation only and is not a fix.

## Provider configuration

The app boots with zero credentials. `GET /api/v1/health/deep` reports what is configured:

```bash
curl -s localhost:3000/api/v1/health/deep | jq '.data.components'
```

| State                | Meaning                                                        |
| -------------------- | -------------------------------------------------------------- |
| `ok`                 | Configured                                                     |
| `not_configured`     | Absent. Features that need it are unavailable; nothing crashes |
| `degraded` / `error` | Configured but unhealthy                                       |

Using an unconfigured provider raises `ConfigurationError` → HTTP 503 with a safe message, never a `TypeError`.

### Firebase

Only `FIREBASE_PROJECT_ID` is needed to **verify** ID tokens. The service account is required only for privileged Identity Platform REST calls and FCM sends. Keeping these separate means sign-in is not blocked by a missing service account.

> `FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY` is the most sensitive secret in the system — it can act on any user account. Never commit it, never log it, and use minimum IAM roles.

### Google Maps

Two keys with different restrictions, deliberately not interchangeable:

| Key                                   | Restriction   | Allowed APIs                            |
| ------------------------------------- | ------------- | --------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_MAPS_BROWSER_KEY` | HTTP referrer | Maps JavaScript (display only)          |
| `GOOGLE_MAPS_SERVER_KEY`              | IP            | Places, Geocoding, Routes, Route Matrix |

Billable APIs are called server-side only, through `lib/maps`. Always pass a Places session token — Google bills per session rather than per keystroke when you do.

## Working on a feature

1. Branch from `develop`: `feature/task-00X-short-name`.
2. Identify the module. Business logic goes in `modules/<domain>/`, never in a component or a route file.
3. Follow the layering: `UI → route handler / server action → service → repository → database`.
4. Validate every external input with Zod at the boundary.
5. Authorize server-side. Middleware gating is not authorization.
6. Implement all eight UX states (`components/feedback/`).
7. Add both `en` and `hi` strings. A missing Hindi UI string fails the i18n test.
8. Test the critical logic. Money, permissions and state transitions need near-exhaustive coverage.
9. Run `pnpm verify`.
10. Open a PR to `develop` stating database, API and UI impact, plus remaining risks.

### Adding a translated string

```jsonc
// messages/en.json
{ "cart": { "empty": "Your cart is empty" } }
// messages/hi.json
{ "cart": { "empty": "आपकी कार्ट खाली है" } }
```

```tsx
// Server component
const t = await getTranslations('cart');
// Client component
const t = useTranslations('cart');
```

`tests/unit/i18n.test.ts` enforces that every English key has a Hindi counterpart, that no value is empty, and that Hindi values actually contain Devanagari — a copied English string will fail.

Use `Link`, `useRouter` and `redirect` from `@/i18n/navigation`, never from `next/link` or `next/navigation`, or links will drop the locale prefix.

### Working with money

```ts
import { paise, rupeesToPaise, addPaise, formatPaise } from '@/lib/money';

const price = rupeesToPaise(199); // 19900
const total = addPaise(price, paise(4000));
formatPaise(total); // "₹239"
```

Never use a plain `number` for currency and never use floats. The branded `Paise` type makes the mistake a compile error.

### Logging

```ts
import { logger } from '@/lib/logger';

logger.info('Order placed', { requestId, orderId, totalAmountPaise });
logger.exception(error, { requestId, orderId });
```

Pass explicit context fields, not whole entities. Sensitive keys are redacted automatically, but the reliable protection is not logging them in the first place. `logger.exception` picks severity from the error type, so expected errors do not pollute alerting.

### Route handlers

```ts
import { apiSuccess, apiError, requestIdFrom } from '@/lib/http/api-response';

export async function POST(request: Request) {
  const requestId = requestIdFrom(request);
  try {
    // validate -> authorize -> service call
    return apiSuccess(data, { meta: { requestId } });
  } catch (error) {
    return apiError(error, { requestId });
  }
}
```

Always return through these helpers so the envelope stays consistent and internal messages cannot leak.

## Testing

```bash
pnpm test                                  # all unit tests
pnpm test tests/unit/money.test.ts         # one file
pnpm test:watch
pnpm test:e2e
```

`tests/unit/setup.ts` resets `process.env` to a known baseline before every test, so a test that deliberately sets an invalid value cannot leak into another file.

### Testing against Google services

**No test may make a billable or rate-limited call to a real provider.**

| Dependency                    | Approach                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Firebase Auth                 | Firebase Auth Emulator (`FIREBASE_AUTH_EMULATOR_HOST`). Wired up in TASK 003                       |
| Token verifier                | Local RSA key pair and a stubbed certificate endpoint — see `tests/unit/helpers/firebase-token.ts` |
| Maps, FCM, GA4, Cloud Logging | Faked at the adapter boundary                                                                      |

Emulator tokens are unsigned, so that code path is rejected outright when `APP_ENV=production`. There is an explicit test for that.

## Cloudflare

```bash
pnpm cf:build      # build the Worker
pnpm cf:preview    # run it locally in workerd
pnpm cf:typegen    # regenerate binding types after editing wrangler.jsonc
```

Bindings in `wrangler.jsonc` are commented out until the corresponding Cloudflare resource exists. Uncommenting one without creating the resource fails the deploy, not the build.

Secrets are set with `wrangler secret put NAME` or in the dashboard, never in `wrangler.jsonc`.

### Workers Builds settings

These live in the Cloudflare dashboard under **Settings → Build**, not in this repository, so they are recorded here.

| Setting                              | Value                          |
| ------------------------------------ | ------------------------------ |
| Root directory                       | `/`                            |
| Build command                        | _leave empty_ — see below      |
| Deploy command                       | `npx wrangler deploy`          |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Builds for non-production branches   | enabled                        |
| Production branch                    | `main`                         |

**The build is owned by `wrangler.jsonc`, not by the dashboard.** `build.command` there runs `pnpm cf:build` for both `wrangler deploy` and `wrangler versions upload`, so `.open-next/` is always generated before the upload regardless of dashboard state.

That is deliberate. Workers Builds stores `build_command` **per trigger** — one trigger for the production branch, a separate one for preview branches — while the dashboard exposes a single "Build command" field. It is therefore easy to have the production trigger configured and the preview trigger's `build_command` still empty. The symptom is specific and easy to misread:

```
Installing project dependencies...
Executing user deploy command: npx wrangler versions upload   ← no build step ran
✘ The entry-point file at ".open-next/worker.js" was not found.
```

On the Cloudflare side the same failure can instead surface as `Could not detect a directory containing static files`, which reads like a wrong assets path but means the build never ran.

`pnpm cf:build` runs `next build` and then the Workers bundling step, so it is the only build command needed.

To inspect what a trigger actually has stored — the dashboard form can look correct while the preview trigger is empty — use the [Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/) with a **user-scoped** token (account-scoped tokens are rejected):

```bash
# 1. Worker tag (the API needs the tag, not the name)
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/workers/scripts" \
  -H "Authorization: Bearer $CF_API_TOKEN" | jq '.result[] | select(.id=="parthik") | .tag'

# 2. Both triggers, with the build command each one actually holds
curl -s "https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/builds/workers/$WORKER_TAG/triggers" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  | jq '.result[] | {trigger_name, branch_includes, branch_excludes, build_command, deploy_command}'
```

Reproduce the whole pipeline locally with `npx wrangler versions upload --dry-run`. Because the build is in `wrangler.jsonc`, that single command builds and validates from a clean checkout without deploying or needing credentials.

## Known warnings

| Warning                                                                       | Status                                                                                                                                                                                                      |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `The "middleware" file convention is deprecated. Please use "proxy" instead.` | Next.js 16.3 renames the convention. `middleware.ts` still works and the OpenNext adapter consumes it correctly. Migration is a small follow-up, tracked so it happens deliberately rather than mid-feature |
| PWA icons 404                                                                 | `public/icons/` is intentionally empty pending brand assets, so the app is not yet installable                                                                                                              |

## Troubleshooting

**`Invalid server environment configuration`** — the message lists the offending key. Compare with `.env.example`. Empty values are treated as unset, and `LOG_LEVEL` is accepted case-insensitively because hosting platforms commonly set `LOG_LEVEL=INFO` already.

**`ConfigurationError: ... is not configured`** — expected when a provider is absent. Check `/api/v1/health/deep`.

**ESLint import-boundary error** — not a lint nit. It means a layer was crossed; move the logic rather than suppressing the rule.

**Workers build fails but `pnpm build` passes** — a dependency is not Workers-compatible. Prefer a Web-API implementation, or move the work to a Node-only script.
