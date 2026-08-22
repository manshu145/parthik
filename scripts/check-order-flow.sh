#!/usr/bin/env bash
#
# End-to-end proof of ORDER PLACEMENT against a live server and a real database.
#
# WHY THIS EXISTS SEPARATELY from the unit tests: placing an order is the one operation that
# spans everything at once — session, cart, address book, settings, the pricing engine, a
# sequence, a stock reservation under a row lock, a payment row, a history row and a cookie
# that has to be cleared afterwards. Every one of those is verified in isolation elsewhere.
# None of that would catch an order that is created and then leaves the cart full, or a
# reservation that is never released on cancellation.
#
# It also pins the two things that are invisible to a typechecker and to a fake repository:
#   * the idempotency replay returns the SAME order rather than creating a second one
#   * the list query's item count is real (a correlated subquery that resolves against the
#     wrong table returns 0 for every order and looks completely normal)
#
# Everything is torn down on exit. Requires docker or podman.
#
# Usage: bash scripts/check-order-flow.sh [port]

set -uo pipefail

PORT="${1:-3260}"
CONTAINER="parthik-order-check"
PG_PORT=55466
PG_PASSWORD="localonly"
DB_NAME="parthik_order_check"
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
  rm -f /tmp/order-*.txt /tmp/order-*.json /tmp/order-server.log
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
export AUTH_SECRET="order-flow-check-secret-long-enough-ok"

echo "Applying migrations and seeding…"
pnpm --silent db:migrate >/dev/null 2>&1 || { echo "❌ Migrations failed."; exit 1; }
pnpm --silent seed >/dev/null 2>&1 || { echo "❌ Reference seed failed."; exit 1; }
pnpm --silent seed:demo >/dev/null 2>&1 || { echo "❌ Demo seed failed."; exit 1; }

if [ ! -d .next ]; then
  echo "❌ No production build. Run \`pnpm build\` first."
  exit 1
fi

echo "Starting the app…"
node_modules/.bin/next start --port "$PORT" > /tmp/order-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 45); do
  curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null && break
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server did not become ready:"
  tail -20 /tmp/order-server.log
  exit 1
fi

failures=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; echo "     $2"; failures=$((failures + 1)); }

psql_q() { "$RUNTIME" exec "$CONTAINER" psql -tAqU postgres -d "$DB_NAME" -c "$1" | tr -d '[:space:]'; }
jqv() { grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

VARIANT=$(psql_q "select pv.id from product_variants pv join products p on p.id = pv.product_id order by pv.id limit 1")
SERVICEABLE_PIN=$(psql_q "select pincode from zone_pincodes where is_active limit 1")

echo
echo "Order placement:"
echo

# ---- Set up a customer who can actually place an order ----
curl -sS -c /tmp/order-jar.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null
curl -sS -b /tmp/order-jar.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null
curl -sS -b /tmp/order-jar.txt -X POST "${BASE}/api/v1/addresses" \
  -H 'Content-Type: application/json' \
  -d "{\"recipientName\":\"Order Tester\",\"recipientPhone\":\"9876543210\",\"line1\":\"3 Order Lane\",\"city\":\"Indore\",\"state\":\"Madhya Pradesh\",\"pincode\":\"${SERVICEABLE_PIN}\",\"isDefault\":true}" \
  -o /dev/null

RESERVED_BEFORE=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
AVAILABLE_BEFORE=$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")

# ---------------------------------------------------------------------------
# 1. Guards before anything is created.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/orders" \
  -H 'Content-Type: application/json' -d '{"idempotencyKey":"anon-key-123456","paymentMethod":"COD"}')
if [ "$CODE" = "401" ]; then
  pass "anonymous placement is refused with 401 (no guest checkout in V1)"
else
  fail "anonymous placement is refused with 401" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/orders" \
  -H 'Content-Type: application/json' -d '{"idempotencyKey":"key-without-a-method"}')
if [ "$CODE" = "422" ]; then
  pass "a body with no payment method is rejected"
else
  fail "a body with no payment method is rejected" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/orders" \
  -H 'Content-Type: application/json' -d '{"idempotencyKey":"short","paymentMethod":"COD"}')
if [ "$CODE" = "422" ]; then
  pass "an unusably short idempotency key is rejected"
else
  fail "an unusably short idempotency key is rejected" "got HTTP $CODE"
fi

if [ "$(psql_q "select count(*) from orders")" = "0" ]; then
  pass "no order row was created by any rejected request"
else
  fail "no order row was created by any rejected request" "orders table is not empty"
fi

# ---------------------------------------------------------------------------
# 2. Place a COD order.
# ---------------------------------------------------------------------------
KEY="cod-$(date +%s)-aaaa"
CODE=$(curl -sS -b /tmp/order-jar.txt -o /tmp/order-cod.json -w '%{http_code}' \
  -X POST "${BASE}/api/v1/orders" -H 'Content-Type: application/json' \
  -d "{\"idempotencyKey\":\"${KEY}\",\"paymentMethod\":\"COD\",\"customerNote\":\"Ring the bell\"}")

if [ "$CODE" = "201" ]; then
  pass "a COD order is created with 201"
else
  fail "a COD order is created with 201" "got HTTP $CODE — $(head -c 400 /tmp/order-cod.json)"
fi

ORDER_ID=$(jqv id < /tmp/order-cod.json)
ORDER_NUMBER=$(jqv orderNumber < /tmp/order-cod.json)

if [ "$(jqv status < /tmp/order-cod.json)" = "CONFIRMED" ]; then
  pass "COD enters CONFIRMED, with no payment to wait for"
else
  fail "COD enters CONFIRMED" "status was $(jqv status < /tmp/order-cod.json)"
fi

if [ "$(jqv requiresPayment < /tmp/order-cod.json)" = "false" ]; then
  pass "COD reports requiresPayment: false"
else
  fail "COD reports requiresPayment: false" "$(jqv requiresPayment < /tmp/order-cod.json)"
fi

if echo "$ORDER_NUMBER" | grep -qE '^PK-[0-9]{4}-[0-9]{6}$'; then
  pass "order number is human-quotable ($ORDER_NUMBER)"
else
  fail "order number is human-quotable" "got '$ORDER_NUMBER'"
fi

if [ "$(jqv codAmountPaise < /tmp/order-cod.json)" = "$(jqv totalAmountPaise < /tmp/order-cod.json)" ]; then
  pass "the cash to collect equals the order total"
else
  fail "the cash to collect equals the order total" "$(head -c 300 /tmp/order-cod.json)"
fi

# ---------------------------------------------------------------------------
# 3. Side effects of a real creation.
# ---------------------------------------------------------------------------
RESERVED_AFTER=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
AVAILABLE_AFTER=$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")

if [ "$RESERVED_AFTER" = "$((RESERVED_BEFORE + 6))" ] && [ "$AVAILABLE_AFTER" = "$((AVAILABLE_BEFORE - 6))" ]; then
  pass "stock is RESERVED, not merely counted (reserved +6, available −6)"
else
  fail "stock is reserved" "reserved ${RESERVED_BEFORE}->${RESERVED_AFTER}, available ${AVAILABLE_BEFORE}->${AVAILABLE_AFTER}"
fi

if [ "$(psql_q "select count(*) from inventory_transactions where reference_id = '${ORDER_ID}' and txn_type = 'RESERVE'")" -ge 1 ]; then
  pass "the reservation is written to the stock ledger and linked to the order"
else
  fail "the reservation is in the ledger" "no RESERVE row references the order"
fi

if [ "$(psql_q "select count(*) from payments where order_id = '${ORDER_ID}' and status = 'PENDING'")" = "1" ]; then
  pass "a payments row exists for COD too (cash is still a payment)"
else
  fail "a payments row exists for COD" "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}' and from_status is null")" = "1" ]; then
  pass "the first history row is recorded with a null from-status"
else
  fail "the first history row is recorded" "history rows: $(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select tax_amount_paise from orders where id = '${ORDER_ID}'")" = "0" ]; then
  pass "tax is written as ZERO — no rate is invented while D-14 is blocked"
else
  fail "tax is written as zero" "tax_amount_paise was $(psql_q "select tax_amount_paise from orders where id = '${ORDER_ID}'")"
fi

CART_ITEMS=$(curl -sS -b /tmp/order-jar.txt "${BASE}/api/v1/cart" | jqv itemCount)
if [ "$CART_ITEMS" = "0" ]; then
  pass "the cart is emptied once the order exists"
else
  fail "the cart is emptied once the order exists" "itemCount was $CART_ITEMS"
fi

# ---------------------------------------------------------------------------
# 4. IDEMPOTENCY — the reason the key is client-supplied.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -b /tmp/order-jar.txt -o /tmp/order-replay.json -w '%{http_code}' \
  -X POST "${BASE}/api/v1/orders" -H 'Content-Type: application/json' \
  -d "{\"idempotencyKey\":\"${KEY}\",\"paymentMethod\":\"COD\"}")

if [ "$CODE" = "200" ]; then
  pass "a replayed key answers 200, not 201 — nothing was created"
else
  fail "a replayed key answers 200" "got HTTP $CODE"
fi

if [ "$(jqv id < /tmp/order-replay.json)" = "$ORDER_ID" ] && [ "$(jqv wasReplay < /tmp/order-replay.json)" = "true" ]; then
  pass "the replay returns the ORIGINAL order"
else
  fail "the replay returns the original order" "$(head -c 300 /tmp/order-replay.json)"
fi

if [ "$(psql_q "select count(*) from orders")" = "1" ]; then
  pass "the database still holds exactly one order"
else
  fail "the database still holds one order" "count was $(psql_q "select count(*) from orders")"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$RESERVED_AFTER" ]; then
  pass "the replay reserved no additional stock"
else
  fail "the replay reserved no additional stock" "reserved moved to $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

# ---------------------------------------------------------------------------
# 5. Reads, and ownership.
# ---------------------------------------------------------------------------
DETAIL=$(curl -sS -b /tmp/order-jar.txt "${BASE}/api/v1/orders/${ORDER_ID}")
if echo "$DETAIL" | grep -q "$ORDER_NUMBER"; then
  pass "the owner can read their own order"
else
  fail "the owner can read their own order" "$(echo "$DETAIL" | head -c 300)"
fi

if [ "$(echo "$DETAIL" | jqv isActive)" = "true" ] && [ "$(echo "$DETAIL" | jqv canCancel)" = "true" ]; then
  pass "the detail response drives the UI: isActive and canCancel are both true"
else
  fail "the detail response drives the UI" "$(echo "$DETAIL" | head -c 400)"
fi

LIST=$(curl -sS -b /tmp/order-jar.txt "${BASE}/api/v1/orders?limit=20")
LIST_COUNT=$(echo "$LIST" | jqv itemCount)
if [ "$LIST_COUNT" = "6" ]; then
  pass "the list reports a REAL item count ($LIST_COUNT) — the subquery regression"
else
  fail "the list reports a real item count" "itemCount was '$LIST_COUNT', expected 6"
fi

if echo "$LIST" | grep -q '"firstItemName":"[^"]'; then
  pass "the list carries a line summary for the card"
else
  fail "the list carries a line summary" "$(echo "$LIST" | head -c 400)"
fi

curl -sS -c /tmp/order-other.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"driver"}' -o /dev/null

CODE=$(curl -sS -b /tmp/order-other.txt -o /dev/null -w '%{http_code}' "${BASE}/api/v1/orders/${ORDER_ID}")
if [ "$CODE" = "404" ]; then
  pass "another account gets 404, not 403 — a 403 would confirm the order exists"
else
  fail "another account gets 404" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-other.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/orders/${ORDER_ID}/cancel" -H 'Content-Type: application/json' \
  -d '{"reason":"not mine but let me try"}')
if [ "$CODE" = "404" ]; then
  pass "another account cannot cancel this order"
else
  fail "another account cannot cancel this order" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' \
  "${BASE}/api/v1/orders/00000000-0000-7000-8000-000000000000")
if [ "$CODE" = "404" ]; then
  pass "an unknown order id is a 404"
else
  fail "an unknown order id is a 404" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' "${BASE}/api/v1/orders/not-a-uuid")
if [ "$CODE" = "422" ]; then
  pass "a malformed order id is rejected before it reaches the database"
else
  fail "a malformed order id is rejected" "got HTTP $CODE"
fi

# ---------------------------------------------------------------------------
# 6. Pages render server-side, with real data in the HTML.
#
# No `/en` prefix anywhere below: `localePrefix: 'as-needed'` means English is served
# unprefixed and `/en/orders` is itself a 307 to `/orders`. Requesting the prefixed URL
# would test the locale redirect and nothing else.
# ---------------------------------------------------------------------------
if curl -sS -b /tmp/order-jar.txt "${BASE}/orders" | grep -q 'data-testid="order-list"'; then
  pass "/orders renders the history on the server"
else
  fail "/orders renders the history" "no order-list testid in the HTML"
fi

if curl -sS -b /tmp/order-jar.txt "${BASE}/orders" | grep -q "$ORDER_NUMBER"; then
  pass "/orders has the order number in the HTML, not behind a fetch"
else
  fail "/orders has the order number in the HTML" "order number missing"
fi

DETAIL_HTML=$(curl -sS -b /tmp/order-jar.txt "${BASE}/orders/${ORDER_ID}")
if echo "$DETAIL_HTML" | grep -q 'data-testid="order-detail"'; then
  pass "/orders/[id] renders the order"
else
  fail "/orders/[id] renders the order" "no order-detail testid"
fi

if echo "$DETAIL_HTML" | grep -q 'data-testid="order-no-invoice-notice"'; then
  pass "/orders/[id] states plainly that it is not a tax invoice (D-14)"
else
  fail "/orders/[id] states it is not a tax invoice" "notice missing"
fi

if echo "$DETAIL_HTML" | grep -q 'data-testid="order-cancel-open"'; then
  pass "/orders/[id] offers cancellation while the policy permits it"
else
  fail "/orders/[id] offers cancellation" "cancel button missing"
fi

if curl -sS -b /tmp/order-jar.txt "${BASE}/orders/${ORDER_ID}/track" | grep -q 'data-testid="order-tracker-stages"'; then
  pass "/orders/[id]/track renders the first snapshot on the server"
else
  fail "/orders/[id]/track renders the first snapshot" "no tracker stages in the HTML"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' "${BASE}/account/orders")
if [ "$CODE" = "308" ]; then
  pass "/account/orders redirects to the canonical /orders"
else
  fail "/account/orders redirects to /orders" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' "${BASE}/order/${ORDER_ID}")
if [ "$CODE" = "308" ]; then
  pass "/order/[id] redirects to the canonical /orders/[id]"
else
  fail "/order/[id] redirects to /orders/[id]" "got HTTP $CODE"
fi

CODE=$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/orders")
if [ "$CODE" = "307" ] || [ "$CODE" = "302" ]; then
  pass "an anonymous visitor is redirected away from /orders"
else
  fail "an anonymous visitor is redirected away from /orders" "got HTTP $CODE"
fi

# ---------------------------------------------------------------------------
# 7. Cancellation, and the stock it must give back.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/orders/${ORDER_ID}/cancel" -H 'Content-Type: application/json' -d '{"reason":"x"}')
if [ "$CODE" = "422" ]; then
  pass "a cancellation with no real reason is rejected"
else
  fail "a cancellation with no real reason is rejected" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /tmp/order-cancel.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/orders/${ORDER_ID}/cancel" -H 'Content-Type: application/json' \
  -d '{"reason":"Ordered by mistake"}')

if [ "$CODE" = "200" ] && [ "$(jqv status < /tmp/order-cancel.json)" = "CANCELLED" ]; then
  pass "the customer can cancel before the vendor accepts"
else
  fail "the customer can cancel before the vendor accepts" "HTTP $CODE — $(head -c 300 /tmp/order-cancel.json)"
fi

if [ "$(jqv isPayable < /tmp/order-cancel.json)" = "false" ]; then
  pass "no refund is promised on a COD order — there was no payment to reverse"
else
  fail "no refund is promised on a COD order" "$(head -c 300 /tmp/order-cancel.json)"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$RESERVED_BEFORE" ] &&
   [ "$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")" = "$AVAILABLE_BEFORE" ]; then
  pass "cancellation RELEASES the reservation exactly, back to where it started"
else
  fail "cancellation releases the reservation" "reserved=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'") available=$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")"
fi

if [ "$(psql_q "select cancellation_reason from orders where id = '${ORDER_ID}'")" = "Orderedbymistake" ]; then
  pass "the cancellation reason is stored, which is what makes the rate diagnosable"
else
  fail "the cancellation reason is stored" "$(psql_q "select cancellation_reason from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}'")" = "2" ]; then
  pass "the cancellation is in the history — every transition without exception"
else
  fail "the cancellation is in the history" "rows: $(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}'")"
fi

CODE=$(curl -sS -b /tmp/order-jar.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/orders/${ORDER_ID}/cancel" -H 'Content-Type: application/json' \
  -d '{"reason":"Cancelling it a second time"}')
if [ "$CODE" = "400" ]; then
  pass "a second cancellation is refused rather than releasing the stock twice"
else
  fail "a second cancellation is refused" "got HTTP $CODE"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$RESERVED_BEFORE" ]; then
  pass "the refused second cancellation moved no stock"
else
  fail "the refused second cancellation moved no stock" "reserved is now $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

if curl -sS -b /tmp/order-jar.txt "${BASE}/orders/${ORDER_ID}" | grep -q 'data-testid="order-cancel-open"'; then
  fail "the cancel button disappears once cancelled" "it is still rendered"
else
  pass "the cancel button disappears once cancelled"
fi

# ---------------------------------------------------------------------------
# 8. A prepaid order, and the sequence.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/order-jar.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null

CODE=$(curl -sS -b /tmp/order-jar.txt -o /tmp/order-upi.json -w '%{http_code}' \
  -X POST "${BASE}/api/v1/orders" -H 'Content-Type: application/json' \
  -d "{\"idempotencyKey\":\"upi-$(date +%s)-bbbb\",\"paymentMethod\":\"UPI\"}")

if [ "$CODE" = "201" ] && [ "$(jqv status < /tmp/order-upi.json)" = "PENDING_PAYMENT" ]; then
  pass "a prepaid order waits in PENDING_PAYMENT for a verified payment"
else
  fail "a prepaid order waits in PENDING_PAYMENT" "HTTP $CODE — $(head -c 300 /tmp/order-upi.json)"
fi

if [ "$(jqv requiresPayment < /tmp/order-upi.json)" = "true" ] && echo /tmp/order-upi.json | grep -qv 'codAmountPaise":[0-9]'; then
  pass "the prepaid response says a payment is still required"
else
  fail "the prepaid response says a payment is required" "$(head -c 300 /tmp/order-upi.json)"
fi

if [ "$(psql_q "select cod_amount_paise is null from orders where id = '$(jqv id < /tmp/order-upi.json)'")" = "t" ]; then
  pass "a prepaid order carries NO cash amount (the check constraint enforces it)"
else
  fail "a prepaid order carries no cash amount" "cod_amount_paise was set"
fi

FIRST_SEQ=${ORDER_NUMBER##*-}
SECOND_SEQ=$(jqv orderNumber < /tmp/order-upi.json)
SECOND_SEQ=${SECOND_SEQ##*-}
if [ "$((10#$SECOND_SEQ))" = "$((10#$FIRST_SEQ + 1))" ]; then
  pass "order numbers come from a sequence and ascend ($FIRST_SEQ → $SECOND_SEQ)"
else
  fail "order numbers ascend" "$FIRST_SEQ then $SECOND_SEQ"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "❌ Order flow: ${failures} failure(s)."
  echo "--- server log ---"
  tail -40 /tmp/order-server.log
  exit 1
fi

echo "✅ Order flow verified."
