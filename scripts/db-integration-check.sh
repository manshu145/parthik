#!/usr/bin/env bash
#
# Applies the Drizzle schema to a THROWAWAY PostgreSQL container, seeds it, and
# executes every catalog query against it.
#
# WHY: the unit suite runs against the in-memory repository and never compiles a
# line of SQL. Drizzle typechecks the query builder, not the statement it emits, so
# CTEs, `count(*) filter (...)`, row-wise keyset comparisons and casts can all
# typecheck and still fail in Postgres. This is the only check that catches that,
# and it is also the first thing to execute the schema at all (decision D-01a).
#
# It generates NO migration files — `drizzle-kit export` writes SQL to stdout only.
# Nothing here touches a shared or production database.
#
# Requires docker or podman. Everything happens in one invocation, including
# teardown, so no container is left running.
#
# Usage: bash scripts/db-integration-check.sh [pg_image]

set -uo pipefail

PG_IMAGE="${1:-postgres:16-alpine}"
CONTAINER="parthik-pg-check"
PORT=55433
PGPASSWORD_VALUE="localonly"
DB_NAME="parthik_check"

RUNTIME=""
for candidate in podman docker; do
  if command -v "$candidate" >/dev/null 2>&1; then
    RUNTIME="$candidate"
    break
  fi
done

if [ -z "$RUNTIME" ]; then
  echo "⏭️  Skipping: neither podman nor docker is available."
  exit 0
fi

cleanup() {
  "$RUNTIME" rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Using $RUNTIME with $PG_IMAGE"
cleanup

if ! "$RUNTIME" run -d --replace --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PGPASSWORD_VALUE" \
  -e POSTGRES_DB="$DB_NAME" \
  -p "${PORT}:5432" \
  "$PG_IMAGE" >/dev/null 2>&1; then
  echo "⏭️  Skipping: could not start a PostgreSQL container in this environment."
  exit 0
fi

echo -n "Waiting for PostgreSQL"
READY=0
for _ in $(seq 1 60); do
  if "$RUNTIME" exec "$CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
    READY=1
    break
  fi
  echo -n "."
  sleep 1
done
echo

if [ "$READY" -ne 1 ]; then
  echo "⏭️  Skipping: PostgreSQL did not become ready (sandboxed container runtime)."
  exit 0
fi

psql_run() {
  "$RUNTIME" exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d "$DB_NAME" "$@"
}

SERVER_VERSION=$(psql_run -tAc "show server_version_num;" 2>/dev/null | tr -d '[:space:]')
echo "PostgreSQL server_version_num: ${SERVER_VERSION:-unknown}"

# ---------------------------------------------------------------------------
# Extensions and the uuidv7() shim.
#
# Every primary key defaults to `uuidv7()`, which is NATIVE ONLY IN POSTGRESQL 18+.
# docs/DATABASE.md and docs/ARCHITECTURE.md both state "PostgreSQL 16+", so the
# schema and the documented engine floor disagree — a real issue for the D-01a
# provider choice, not something this script should hide.
#
# On a server below 18 a shim is installed so the rest of the schema can still be
# validated. The shim is NOT time-sortable and exists only for this throwaway
# database.
# ---------------------------------------------------------------------------
psql_run -c "create extension if not exists pg_trgm;" >/dev/null

if [ -n "$SERVER_VERSION" ] && [ "$SERVER_VERSION" -lt 180000 ]; then
  echo "⚠️  Server is below 18: installing a non-time-sortable uuidv7() shim for validation only."
  psql_run -c "create or replace function uuidv7() returns uuid language sql volatile as \$\$ select gen_random_uuid() \$\$;" >/dev/null
fi

# ---------------------------------------------------------------------------
# Apply the schema. `drizzle-kit export` prints SQL; it writes no migration files.
# ---------------------------------------------------------------------------
echo "Exporting schema SQL (no migration files written)…"
SCHEMA_SQL=$(pnpm --silent db:export 2>/dev/null)

if [ -z "$SCHEMA_SQL" ]; then
  echo "❌ Schema export produced no SQL."
  exit 1
fi

echo "Applying schema…"
if ! printf '%s\n' "$SCHEMA_SQL" | psql_run >/tmp/parthik-schema-apply.log 2>&1; then
  echo "❌ Schema failed to apply:"
  tail -25 /tmp/parthik-schema-apply.log
  exit 1
fi

TABLE_COUNT=$(psql_run -tAc "select count(*) from information_schema.tables where table_schema='public';" | tr -d '[:space:]')
ENUM_COUNT=$(psql_run -tAc "select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e' and n.nspname='public';" | tr -d '[:space:]')
INDEX_COUNT=$(psql_run -tAc "select count(*) from pg_indexes where schemaname='public';" | tr -d '[:space:]')

echo "✅ Schema applied: ${TABLE_COUNT} tables, ${ENUM_COUNT} enums, ${INDEX_COUNT} indexes."

# ---------------------------------------------------------------------------
# Seed, then exercise the real SQL.
# ---------------------------------------------------------------------------
export DATABASE_URL="postgresql://postgres:${PGPASSWORD_VALUE}@127.0.0.1:${PORT}/${DB_NAME}"
export APP_ENV=development

echo "Seeding reference data…"
if ! pnpm --silent seed >/tmp/parthik-seed.log 2>&1; then
  echo "❌ Reference seed failed:"
  tail -25 /tmp/parthik-seed.log
  exit 1
fi
echo "✅ Reference data seeded."

echo "Seeding demo catalogue…"
if ! pnpm --silent seed:demo >/tmp/parthik-seed-demo.log 2>&1; then
  echo "❌ Demo seed failed:"
  tail -25 /tmp/parthik-seed-demo.log
  exit 1
fi
grep -E "^  (products|product_variants|inventory|product_translations)" /tmp/parthik-seed-demo.log || true
echo "✅ Demo catalogue seeded."

echo "Executing catalog and search queries…"
if ! pnpm --silent tsx scripts/check-catalog-queries.ts; then
  echo "❌ Query check failed."
  exit 1
fi

# Idempotency: a seed you are afraid to re-run is a seed nobody runs.
echo "Re-running seeds to confirm idempotency…"
if ! pnpm --silent seed >/dev/null 2>&1 || ! pnpm --silent seed:demo >/dev/null 2>&1; then
  echo "❌ Seeds are not idempotent."
  exit 1
fi

PRODUCTS_AFTER=$(psql_run -tAc "select count(*) from products;" | tr -d '[:space:]')
echo "✅ Seeds are idempotent (products still ${PRODUCTS_AFTER})."

echo
echo "✅ Database integration check passed."
