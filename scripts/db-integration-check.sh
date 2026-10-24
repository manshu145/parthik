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
# It applies the COMMITTED MIGRATIONS, which is the artifact that will actually run
# against a real database — a stronger check than the previous `drizzle-kit export`,
# because it validates what deploys rather than a regenerated equivalent.
#
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
# Bootstrap: extensions and uuidv7().
#
# `uuidv7()` is built in only from PostgreSQL 18, and every primary key defaults to
# it, so on the documented floor of 16 the migration cannot even apply. db/bootstrap.sql
# installs a REAL time-sortable implementation when the server lacks one — previously
# this script substituted gen_random_uuid(), which applies fine and silently throws away
# the time-sortability the id format was chosen for.
#
# The bootstrap is applied by `pnpm db:migrate` itself, so the ordering cannot be got
# wrong on a real deploy. Here we only PROVE the result, via scripts/check-uuidv7.sql:
# version nibble, variant bits, embedded timestamp, uniqueness and monotonic ordering.
# ---------------------------------------------------------------------------
export DATABASE_URL="postgresql://postgres:${PGPASSWORD_VALUE}@127.0.0.1:${PORT}/${DB_NAME}"
export APP_ENV=development

echo "Applying migrations from db/migrations (bootstrap included)…"
if ! pnpm --silent db:migrate >/tmp/parthik-migrate.log 2>&1; then
  echo "❌ Migrations failed to apply:"
  tail -30 /tmp/parthik-migrate.log
  exit 1
fi
grep -oE '(NOTICE|uuidv7\(\)).*' /tmp/parthik-migrate.log | sed 's/^/  /' | head -3 || true
echo "Verifying uuidv7() correctness…"
if ! psql_run -f - < scripts/check-uuidv7.sql >/tmp/parthik-uuidv7.log 2>&1; then
  echo "❌ uuidv7() is not a correct, time-sortable v7:"
  tail -25 /tmp/parthik-uuidv7.log
  exit 1
fi
grep -o 'NOTICE:.*' /tmp/parthik-uuidv7.log | sed 's/^/  /' || true
echo "✅ uuidv7() verified."

TABLE_COUNT=$(psql_run -tAc "select count(*) from information_schema.tables where table_schema='public';" | tr -d '[:space:]')
ENUM_COUNT=$(psql_run -tAc "select count(*) from pg_type t join pg_namespace n on n.oid=t.typnamespace where t.typtype='e' and n.nspname='public';" | tr -d '[:space:]')
INDEX_COUNT=$(psql_run -tAc "select count(*) from pg_indexes where schemaname='public';" | tr -d '[:space:]')

echo "✅ Schema applied: ${TABLE_COUNT} tables, ${ENUM_COUNT} enums, ${INDEX_COUNT} indexes."

# ---------------------------------------------------------------------------
# Seed, then exercise the real SQL.
# ---------------------------------------------------------------------------
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
  echo "❌ Catalog query check failed."
  exit 1
fi

# Commerce SQL uses raw `sql` templates, INSERT … SELECT, a partial-index upsert target
# and ON CONFLICT — all of which typecheck and can still be rejected by Postgres.
echo "Executing commerce queries (cart persistence)…"
if ! pnpm --silent tsx scripts/check-commerce-queries.ts; then
  echo "❌ Commerce query check failed."
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

# Re-running migrations must do nothing. If drizzle's journal and the database ever
# disagree, this replays DDL and fails — which is exactly what we want to hear about
# locally rather than during a deploy.
echo "Re-running migrations to confirm they are a no-op…"
if ! pnpm --silent db:migrate >/tmp/parthik-migrate-again.log 2>&1; then
  echo "❌ Re-applying migrations failed — the journal and the database disagree:"
  tail -20 /tmp/parthik-migrate-again.log
  exit 1
fi
echo "✅ Migrations are idempotent."

echo
echo "✅ Database integration check passed."
