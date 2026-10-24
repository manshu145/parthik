#!/usr/bin/env bash
#
# End-to-end proof of the checkout quote against a live server and a real database.
#
# WHY: the unit tests cover the rules against in-memory fixtures. This covers the WIRING —
# session, cart, address book, settings and the pricing engine composed through real route
# handlers — and it is the only thing that would catch a quote that works in isolation and
# 500s when actually requested.
#
# Everything is torn down on exit. Requires docker or podman.
#
# Usage: bash scripts/check-checkout-flow.sh [port]

set -uo pipefail

PORT="${1:-3250}"
CONTAINER="parthik-checkout-check"
PG_PORT=55465
PG_PASSWORD="localonly"
DB_NAME="parthik_checkout_check"
BASE="http://127.0.0.1:${PORT}"

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
  rm -f /tmp/checkout-*.txt /tmp/checkout-server.log
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
export AUTH_SECRET="checkout-flow-check-secret-long-enough-ok"

echo "Applying migrations and seeding…"
pnpm --silent db:migrate >/dev/null 2>&1 || { echo "❌ Migrations failed."; exit 1; }
pnpm --silent seed >/dev/null 2>&1 || { echo "❌ Reference seed failed."; exit 1; }
pnpm --silent seed:demo >/dev/null 2>&1 || { echo "❌ Demo seed failed."; exit 1; }

if [ ! -d .next ]; then
  echo "❌ No production build. Run \`pnpm build\` first."
  exit 1
fi

echo "Starting the app…"
node_modules/.bin/next start --port "$PORT" > /tmp/checkout-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 45); do
  curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null && break
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server did not become ready:"
  tail -20 /tmp/checkout-server.log
  exit 1
fi

failures=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; echo "     $2"; failures=$((failures + 1)); }

psql_q() { "$RUNTIME" exec "$CONTAINER" psql -tAqU postgres -d "$DB_NAME" -c "$1" | tr -d '[:space:]'; }
jqv() { grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

VARIANT=$(psql_q "select pv.id from product_variants pv join products p on p.id = pv.product_id limit 1")
SERVICEABLE_PIN=$(psql_q "select pincode from zone_pincodes where is_active limit 1")

echo
echo "Checkout quote:"
echo

# Sign in and fill a cart.
curl -sS -c /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null
curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null

# ---------------------------------------------------------------------------
# 1. No address yet -> ADDRESS_REQUIRED, and not placeable.
# ---------------------------------------------------------------------------
Q=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d '{}')

if echo "$Q" | grep -q 'ADDRESS_REQUIRED'; then
  pass "blocks with ADDRESS_REQUIRED before an address exists"
else
  fail "blocks with ADDRESS_REQUIRED before an address exists" "$(echo "$Q" | head -c 300)"
fi

if [ "$(echo "$Q" | jqv canPlaceOrder)" = "false" ]; then
  pass "not placeable without an address"
else
  fail "not placeable without an address" "canPlaceOrder was $(echo "$Q" | jqv canPlaceOrder)"
fi

# ---------------------------------------------------------------------------
# 2. An UNSERVICEABLE address must be refused.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/addresses" \
  -H 'Content-Type: application/json' \
  -d '{"recipientName":"Far Away","recipientPhone":"9876543210","line1":"1 Nowhere Road","city":"Delhi","state":"Delhi","pincode":"110001"}' \
  -o /tmp/checkout-far.json

Q=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" -H 'Content-Type: application/json' -d '{}')

if echo "$Q" | grep -q 'NOT_SERVICEABLE'; then
  pass "blocks an unserviceable address (re-verified at checkout)"
else
  fail "blocks an unserviceable address" "$(echo "$Q" | head -c 300)"
fi

# ---------------------------------------------------------------------------
# 3. A serviceable address clears the blockers and quotes a fee.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/addresses" \
  -H 'Content-Type: application/json' \
  -d "{\"recipientName\":\"Near By\",\"recipientPhone\":\"9876543211\",\"line1\":\"2 Close Street\",\"city\":\"Indore\",\"state\":\"Madhya Pradesh\",\"pincode\":\"${SERVICEABLE_PIN}\",\"isDefault\":true}" \
  -o /dev/null

Q=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" -H 'Content-Type: application/json' -d '{}')

if ! echo "$Q" | grep -q 'NOT_SERVICEABLE'; then
  pass "a serviceable address clears NOT_SERVICEABLE"
else
  fail "a serviceable address clears NOT_SERVICEABLE" "$(echo "$Q" | head -c 400)"
fi

if [ -n "$(echo "$Q" | jqv zoneId)" ] && [ "$(echo "$Q" | jqv zoneId)" != "null" ]; then
  pass "resolves a delivery zone from the pincode"
else
  fail "resolves a delivery zone from the pincode" "zoneId was $(echo "$Q" | jqv zoneId)"
fi

TOTAL=$(echo "$Q" | jqv totalPaise)
if [ -n "$TOTAL" ] && [ "$TOTAL" -gt 0 ] 2>/dev/null; then
  pass "quotes a total ($TOTAL paise)"
else
  fail "quotes a total" "totalPaise was '$TOTAL'"
fi

# ---------------------------------------------------------------------------
# 4. NO TAX LINE while D-14 is blocked.
# ---------------------------------------------------------------------------
if echo "$Q" | grep -q '"isTaxDisplayable":false' && echo "$Q" | grep -q '"taxAmountPaise":0'; then
  pass "asserts no tax treatment (D-14 blocked)"
else
  fail "asserts no tax treatment" "tax fields were not zero/undisplayable"
fi

# ---------------------------------------------------------------------------
# 5. Payment methods: exactly the three V1 options, COD available.
# ---------------------------------------------------------------------------
for m in UPI CARD COD; do
  if echo "$Q" | grep -q "\"method\":\"$m\""; then
    pass "offers $m"
  else
    fail "offers $m" "$m missing from paymentMethods"
  fi
done

for m in NETBANKING WALLET; do
  if echo "$Q" | grep -q "\"method\":\"$m\""; then
    fail "does not offer the reserved method $m" "$m was offered"
  else
    pass "does not offer the reserved method $m"
  fi
done

# ---------------------------------------------------------------------------
# 6. A method must be CHOSEN before the order is placeable.
# ---------------------------------------------------------------------------
if [ "$(echo "$Q" | jqv canPlaceOrder)" = "false" ] && [ "$(echo "$Q" | jqv selectedMethod)" = "null" ]; then
  pass "not placeable until a payment method is chosen"
else
  fail "not placeable until a payment method is chosen" "canPlaceOrder=$(echo "$Q" | jqv canPlaceOrder)"
fi

Q=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d '{"paymentMethod":"COD"}')

if [ "$(echo "$Q" | jqv canPlaceOrder)" = "true" ]; then
  pass "placeable once COD is chosen"
else
  fail "placeable once COD is chosen" "$(echo "$Q" | head -c 400)"
fi

COD_AMOUNT=$(echo "$Q" | jqv codAmountPaise)
if [ "$COD_AMOUNT" = "$(echo "$Q" | jqv totalPaise)" ]; then
  pass "COD amount equals the total ($COD_AMOUNT paise)"
else
  fail "COD amount equals the total" "cod=$COD_AMOUNT total=$(echo "$Q" | jqv totalPaise)"
fi

Q_UPI=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d '{"paymentMethod":"UPI"}')
if echo "$Q_UPI" | grep -q '"codAmountPaise":null'; then
  pass "no COD amount on a prepaid quote"
else
  fail "no COD amount on a prepaid quote" "$(echo "$Q_UPI" | jqv codAmountPaise)"
fi

# ---------------------------------------------------------------------------
# 7. COD withdrawn when the order exceeds the configured ceiling.
# ---------------------------------------------------------------------------
psql_q "update admin_settings set value = '1'::jsonb where key = 'cod.max_order_value_paise'" >/dev/null
# The settings cache is 60s per isolate, so wait it out rather than assert a stale read.
sleep 62
Q=$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d '{"paymentMethod":"COD"}')

if echo "$Q" | grep -q 'COD_ORDER_VALUE_TOO_HIGH'; then
  pass "withdraws COD above the configured ceiling"
else
  fail "withdraws COD above the configured ceiling" "$(echo "$Q" | head -c 500)"
fi

if echo "$Q" | grep -q 'PAYMENT_METHOD_UNAVAILABLE'; then
  pass "blocks a quote that requests an unavailable method"
else
  fail "blocks a quote that requests an unavailable method" "$(echo "$Q" | head -c 400)"
fi

# UPI must still work — one withdrawn method must not break checkout.
if [ "$(curl -sS -b /tmp/checkout-jar.txt -X POST "${BASE}/api/v1/checkout/quote" -H 'Content-Type: application/json' -d '{"paymentMethod":"UPI"}' | jqv canPlaceOrder)" = "true" ]; then
  pass "UPI still placeable when COD is withdrawn"
else
  fail "UPI still placeable when COD is withdrawn" "UPI was blocked too"
fi

# ---------------------------------------------------------------------------
# 8. Anonymous callers cannot quote. There is no guest checkout in V1.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d '{}')
if [ "$CODE" = "401" ]; then
  pass "anonymous quote is refused with 401"
else
  fail "anonymous quote is refused with 401" "got HTTP $CODE"
fi

# ---------------------------------------------------------------------------
# 9. Another customer's address must not be usable.
# ---------------------------------------------------------------------------
FAR_ID=$(grep -o '"id":"[^"]*"' /tmp/checkout-far.json | head -1 | cut -d'"' -f4)
curl -sS -c /tmp/checkout-other.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"driver"}' -o /dev/null

CODE=$(curl -sS -b /tmp/checkout-other.txt -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/checkout/quote" \
  -H 'Content-Type: application/json' -d "{\"addressId\":\"${FAR_ID}\"}")
if [ "$CODE" = "404" ]; then
  pass "another customer's address resolves to 404, not 403"
else
  fail "another customer's address resolves to 404" "got HTTP $CODE"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "❌ Checkout flow: ${failures} failure(s)."
  echo "--- server log ---"
  tail -30 /tmp/checkout-server.log
  exit 1
fi

echo "✅ Checkout flow verified."
