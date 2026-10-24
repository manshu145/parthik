#!/usr/bin/env bash
#
# End-to-end proof that the cart persists in Postgres for a signed-in customer and that
# a guest cart survives sign-in.
#
# WHY A SCRIPT RATHER THAN A UNIT TEST: the interesting behaviour spans a database, a
# session cookie, four route handlers and the sign-in merge. Unit tests cover the rules;
# only a running server proves the wiring — and the wiring is what was actually missing
# (the cart service was always storage-agnostic, nothing persisted it).
#
# Everything is torn down on exit. Requires docker or podman.
#
# Usage: bash scripts/check-cart-persistence.sh [port]

set -uo pipefail

PORT="${1:-3240}"
CONTAINER="parthik-cart-check"
PG_PORT=55455
PG_PASSWORD="localonly"
DB_NAME="parthik_cart_check"
BASE="http://127.0.0.1:${PORT}"
SECRET="cart-persistence-check-secret-long-enough"

RUNTIME=""
for candidate in podman docker; do
  command -v "$candidate" >/dev/null 2>&1 && RUNTIME="$candidate" && break
done

if [ -z "$RUNTIME" ]; then
  echo "⏭️  Skipping: neither podman nor docker is available."
  exit 0
fi

server_pid=""
cleanup() {
  [ -n "$server_pid" ] && kill "$server_pid" 2>/dev/null
  "$RUNTIME" rm -f "$CONTAINER" >/dev/null 2>&1
  rm -f /tmp/cart-*.txt /tmp/cart-server.log
}
trap cleanup EXIT

"$RUNTIME" rm -f "$CONTAINER" >/dev/null 2>&1

echo "Starting PostgreSQL…"
if ! "$RUNTIME" run -d --replace --name "$CONTAINER" \
  -e POSTGRES_PASSWORD="$PG_PASSWORD" -e POSTGRES_DB="$DB_NAME" \
  -p "${PG_PORT}:5432" postgres:16-alpine >/dev/null 2>&1; then
  echo "⏭️  Skipping: could not start PostgreSQL."
  exit 0
fi

for _ in $(seq 1 60); do
  "$RUNTIME" exec "$CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1 && break
  sleep 1
done

if ! "$RUNTIME" exec "$CONTAINER" pg_isready -U postgres -d "$DB_NAME" >/dev/null 2>&1; then
  echo "⏭️  Skipping: PostgreSQL did not become ready."
  exit 0
fi

export DATABASE_URL="postgresql://postgres:${PG_PASSWORD}@127.0.0.1:${PG_PORT}/${DB_NAME}"
export APP_ENV=development
export DEV_AUTH_ENABLED=true
export AUTH_SECRET="$SECRET"

echo "Applying migrations and seeding…"
pnpm --silent db:migrate >/dev/null 2>&1 || { echo "❌ Migrations failed."; exit 1; }
pnpm --silent seed >/dev/null 2>&1 || { echo "❌ Reference seed failed."; exit 1; }
pnpm --silent seed:demo >/dev/null 2>&1 || { echo "❌ Demo seed failed."; exit 1; }

if [ ! -d .next ]; then
  echo "❌ No production build. Run \`pnpm build\` first."
  exit 1
fi

echo "Starting the app…"
node_modules/.bin/next start --port "$PORT" > /tmp/cart-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 45); do
  curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null && break
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server did not become ready:"
  tail -20 /tmp/cart-server.log
  exit 1
fi

failures=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; echo "     $2"; failures=$((failures + 1)); }

psql_q() { "$RUNTIME" exec "$CONTAINER" psql -tAqU postgres -d "$DB_NAME" -c "$1" | tr -d '[:space:]'; }

# A real seeded variant, so the cart is exercised against real catalogue data.
VARIANT=$(psql_q "select pv.id from product_variants pv join products p on p.id = pv.product_id limit 1")
VARIANT2=$(psql_q "select pv.id from product_variants pv join products p on p.id = pv.product_id offset 1 limit 1")

echo
echo "Cart persistence:"
echo

# ---------------------------------------------------------------------------
# 1. Guest cart lives in the cookie and writes NO database row.
# ---------------------------------------------------------------------------
curl -sS -c /tmp/cart-guest.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":2}" -o /dev/null

if grep -q parthik_cart /tmp/cart-guest.txt; then
  pass "guest add stores the cart in a cookie"
else
  fail "guest add stores the cart in a cookie" "no parthik_cart cookie was set"
fi

if [ "$(psql_q 'select count(*) from carts')" = "0" ]; then
  pass "guest cart writes no database row"
else
  fail "guest cart writes no database row" "carts is not empty"
fi

# ---------------------------------------------------------------------------
# 2. Sign in with that cookie jar: the guest cart must MERGE into Postgres.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/cart-guest.txt -c /tmp/cart-guest.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null

if [ "$(psql_q 'select count(*) from carts')" = "1" ]; then
  pass "signing in merges the guest cart into the database"
else
  fail "signing in merges the guest cart into the database" \
       "expected 1 cart row, found $(psql_q 'select count(*) from carts')"
fi

if [ "$(psql_q 'select quantity from cart_items limit 1')" = "2" ]; then
  pass "merged line keeps its quantity"
else
  fail "merged line keeps its quantity" "quantity is $(psql_q 'select quantity from cart_items limit 1')"
fi

# The snapshot exists to DETECT a price change, so it must actually be populated.
SNAPSHOT=$(psql_q 'select unit_price_paise_snapshot from cart_items limit 1')
if [ -n "$SNAPSHOT" ] && [ "$SNAPSHOT" != "0" ]; then
  pass "price snapshot is populated from the database ($SNAPSHOT paise)"
else
  fail "price snapshot is populated from the database" "snapshot is '$SNAPSHOT'"
fi

# product_id must be resolved server-side, never supplied by the client.
if [ "$(psql_q 'select count(*) from cart_items where product_id is null')" = "0" ]; then
  pass "product_id resolved server-side"
else
  fail "product_id resolved server-side" "found NULL product_id"
fi

# ---------------------------------------------------------------------------
# 3. A signed-in mutation goes to Postgres, and survives losing the cart cookie.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/cart-guest.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT2}\",\"quantity\":3}" -o /dev/null

if [ "$(psql_q 'select count(*) from cart_items')" = "2" ]; then
  pass "signed-in add persists to the database"
else
  fail "signed-in add persists to the database" \
       "expected 2 items, found $(psql_q 'select count(*) from cart_items')"
fi

# Keep only the session cookie: this is the "different device" case.
grep -v parthik_cart /tmp/cart-guest.txt > /tmp/cart-session-only.txt

COUNT=$(curl -sS -b /tmp/cart-session-only.txt "${BASE}/api/v1/cart" | grep -o '"itemCount":[0-9]*' | head -1 | cut -d: -f2)
if [ "$COUNT" = "5" ]; then
  pass "cart survives without the cart cookie (itemCount 5 from Postgres)"
else
  fail "cart survives without the cart cookie" "itemCount was '$COUNT', expected 5"
fi

# ---------------------------------------------------------------------------
# 4. Clearing removes the row rather than leaving an empty shell.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/cart-session-only.txt -X DELETE "${BASE}/api/v1/cart" -o /dev/null

if [ "$(psql_q 'select count(*) from carts')" = "0" ]; then
  pass "clearing deletes the cart row"
else
  fail "clearing deletes the cart row" "carts still has $(psql_q 'select count(*) from carts') row(s)"
fi

# ---------------------------------------------------------------------------
# 5. Two customers must never see each other's cart.
# ---------------------------------------------------------------------------
curl -sS -c /tmp/cart-a.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null
curl -sS -b /tmp/cart-a.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":4}" -o /dev/null

curl -sS -c /tmp/cart-b.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"driver"}' -o /dev/null
B_COUNT=$(curl -sS -b /tmp/cart-b.txt "${BASE}/api/v1/cart" | grep -o '"itemCount":[0-9]*' | head -1 | cut -d: -f2)

if [ "$B_COUNT" = "0" ]; then
  pass "a second customer sees their own empty cart"
else
  fail "a second customer sees their own empty cart" "itemCount was '$B_COUNT', expected 0"
fi

A_COUNT=$(curl -sS -b /tmp/cart-a.txt "${BASE}/api/v1/cart" | grep -o '"itemCount":[0-9]*' | head -1 | cut -d: -f2)
if [ "$A_COUNT" = "4" ]; then
  pass "the first customer's cart is untouched"
else
  fail "the first customer's cart is untouched" "itemCount was '$A_COUNT', expected 4"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "❌ Cart persistence: ${failures} failure(s)."
  echo "--- server log ---"
  tail -30 /tmp/cart-server.log
  exit 1
fi

echo "✅ Cart persistence verified."
