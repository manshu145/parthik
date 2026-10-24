#!/usr/bin/env bash
#
# End-to-end proof of the FULFILMENT path: vendor → dispatch → driver → OTP handover → cash.
#
# WHY: this is the only place the whole physical chain is exercised as one story. A COD order is
# placed, accepted, packed, dispatched, picked up, delivered against a real OTP, and the cash the
# driver took is followed all the way to a verified deposit. Every step in between is a transaction
# that touches several tables at once, and none of them can be checked in isolation:
#
#   * a delivered order whose stock was never consumed looks fine on the order screen
#   * cash collected with no ledger row is indistinguishable from cash that was never handed over
#   * a driver marking an order delivered without an OTP looks exactly like a successful delivery
#
# Everything is torn down on exit. Requires docker or podman.
#
# Usage: bash scripts/check-fulfilment-flow.sh [port]

set -uo pipefail

PORT="${1:-3280}"
CONTAINER="parthik-fulfilment-check"
PG_PORT=55468
PG_PASSWORD="localonly"
DB_NAME="parthik_fulfilment_check"
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
  rm -f /tmp/ful-*.txt /tmp/ful-*.json /tmp/ful-server.log
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
export AUTH_SECRET="fulfilment-flow-check-secret-long-enough"

echo "Applying migrations and seeding…"
pnpm --silent db:migrate >/dev/null 2>&1 || { echo "❌ Migrations failed."; exit 1; }
pnpm --silent seed >/dev/null 2>&1 || { echo "❌ Reference seed failed."; exit 1; }
pnpm --silent seed:demo >/dev/null 2>&1 || { echo "❌ Demo seed failed."; exit 1; }

if [ ! -d .next ]; then
  echo "❌ No production build. Run \`pnpm build\` first."
  exit 1
fi

echo "Starting the app…"
node_modules/.bin/next start --port "$PORT" > /tmp/ful-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 45); do
  curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null && break
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server did not become ready:"
  tail -20 /tmp/ful-server.log
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
echo "Fulfilment:"
echo

# ---- The demo driver must exist, or nothing below can happen ----
DRIVER_ID=$(psql_q "select id from drivers limit 1")
if [ -n "$DRIVER_ID" ]; then
  pass "the demo seed creates a driver row that a delivery can be assigned to"
else
  fail "the demo seed creates a driver" "no rows in drivers"
  echo "❌ Cannot continue without a driver."
  exit 1
fi

# ---- Sessions ----
curl -sS -c /tmp/ful-cust.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null
curl -sS -c /tmp/ful-vendor.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"vendor"}' -o /dev/null
curl -sS -c /tmp/ful-driver.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"driver"}' -o /dev/null
curl -sS -c /tmp/ful-admin.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"admin"}' -o /dev/null
curl -sS -c /tmp/ful-support.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"support"}' -o /dev/null

curl -sS -b /tmp/ful-cust.txt -X POST "${BASE}/api/v1/addresses" \
  -H 'Content-Type: application/json' \
  -d "{\"recipientName\":\"Ful Tester\",\"recipientPhone\":\"9876543210\",\"line1\":\"9 Handover Lane\",\"city\":\"Indore\",\"state\":\"Madhya Pradesh\",\"pincode\":\"${SERVICEABLE_PIN}\",\"isDefault\":true}" \
  -o /dev/null

place_cod_order() {
  curl -sS -b /tmp/ful-cust.txt -X POST "${BASE}/api/v1/cart/items" \
    -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null
  curl -sS -b /tmp/ful-cust.txt -X POST "${BASE}/api/v1/orders" \
    -H 'Content-Type: application/json' \
    -d "{\"idempotencyKey\":\"ful-$(date +%s%N)\",\"paymentMethod\":\"COD\"}" -o /tmp/ful-order.json
  jqv id < /tmp/ful-order.json
}

ORDER_ID=$(place_cod_order)
TOTAL=$(psql_q "select total_amount_paise from orders where id = '${ORDER_ID}'")

# ---------------------------------------------------------------------------
# 1. The vendor queue is tenant-scoped.
# ---------------------------------------------------------------------------
QUEUE=$(curl -sS -b /tmp/ful-vendor.txt "${BASE}/api/v1/vendor/orders?tab=new")
if echo "$QUEUE" | grep -q "$(psql_q "select order_number from orders where id = '${ORDER_ID}'")"; then
  pass "the new order appears in the vendor's queue"
else
  fail "the order appears in the vendor's queue" "$(echo "$QUEUE" | head -c 300)"
fi

CODE=$(curl -sS -b /tmp/ful-cust.txt -o /dev/null -w '%{http_code}' "${BASE}/api/v1/vendor/orders")
if [ "$CODE" = "403" ]; then
  pass "a customer cannot read the vendor queue"
else
  fail "a customer cannot read the vendor queue" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/ful-support.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/vendor/orders/${ORDER_ID}/accept")
if [ "$CODE" = "403" ]; then
  pass "an admin with no vendor grant cannot accept a vendor's order"
else
  fail "an admin with no vendor grant cannot accept" "got HTTP $CODE"
fi

VDETAIL=$(curl -sS -b /tmp/ful-vendor.txt "${BASE}/api/v1/vendor/orders/${ORDER_ID}")
if echo "$VDETAIL" | grep -q '"customerFirstName"' && ! echo "$VDETAIL" | grep -q 'Handover Lane'; then
  pass "the vendor sees a first name but NOT the delivery address (master spec §14)"
else
  fail "the vendor detail limits customer data" "$(echo "$VDETAIL" | head -c 300)"
fi

# ---------------------------------------------------------------------------
# 2. Vendor moves the order, and READY triggers dispatch.
# ---------------------------------------------------------------------------
for step in accept preparing; do
  CODE=$(curl -sS -b /tmp/ful-vendor.txt -o /tmp/ful-step.json -w '%{http_code}' -X POST \
    "${BASE}/api/v1/vendor/orders/${ORDER_ID}/${step}")
  if [ "$CODE" = "200" ]; then
    pass "vendor ${step}: accepted"
  else
    fail "vendor ${step}" "HTTP $CODE — $(head -c 200 /tmp/ful-step.json)"
  fi
done

CODE=$(curl -sS -b /tmp/ful-vendor.txt -o /tmp/ful-ready.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/vendor/orders/${ORDER_ID}/ready")
DELIVERY_ID=$(jqv deliveryId < /tmp/ful-ready.json)

if [ "$CODE" = "200" ] && [ -n "$DELIVERY_ID" ] && [ "$DELIVERY_ID" != "null" ]; then
  pass "marking the order READY created a delivery (REQUEST_DISPATCH honoured)"
else
  fail "marking ready created a delivery" "HTTP $CODE — $(head -c 300 /tmp/ful-ready.json)"
fi

if [ "$(psql_q "select status from deliveries where id = '${DELIVERY_ID}'")" = "PENDING_ASSIGNMENT" ]; then
  pass "the delivery waits for a driver"
else
  fail "the delivery waits for a driver" "$(psql_q "select status from deliveries where id = '${DELIVERY_ID}'")"
fi

if [ "$(psql_q "select length(delivery_otp_hash) from deliveries where id = '${DELIVERY_ID}'")" = "64" ]; then
  pass "an OTP HASH is stored, not a code (64 hex chars of SHA-256)"
else
  fail "an OTP hash is stored" "length was $(psql_q "select length(delivery_otp_hash) from deliveries where id = '${DELIVERY_ID}'")"
fi

if ! grep -qi '"otp"' /tmp/ful-ready.json; then
  pass "the vendor response carries NO delivery code"
else
  fail "the vendor response carries no delivery code" "an otp was returned to the vendor"
fi

# Dispatch twice must not create a second delivery.
curl -sS -b /tmp/ful-vendor.txt -o /dev/null -X POST "${BASE}/api/v1/vendor/orders/${ORDER_ID}/ready"
if [ "$(psql_q "select count(*) from deliveries where order_id = '${ORDER_ID}'")" = "1" ]; then
  pass "a repeated READY does not create a second delivery"
else
  fail "a repeated READY does not create a second delivery" "$(psql_q "select count(*) from deliveries where order_id = '${ORDER_ID}'")"
fi

# ---------------------------------------------------------------------------
# 3. The driver takes the job.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -b /tmp/ful-driver.txt -o /dev/null -w '%{http_code}' -X PATCH \
  "${BASE}/api/v1/driver/availability" -H 'Content-Type: application/json' -d '{"availability":"ONLINE"}')
if [ "$CODE" = "200" ]; then
  pass "the driver can go online"
else
  fail "the driver can go online" "got HTTP $CODE"
fi

OFFERS=$(curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/deliveries/available")
if echo "$OFFERS" | grep -q "$DELIVERY_ID"; then
  pass "the delivery is offered to the driver"
else
  fail "the delivery is offered to the driver" "$(echo "$OFFERS" | head -c 300)"
fi

if echo "$OFFERS" | grep -q '"cashBlocked":false'; then
  pass "the offer queue reports the driver is under the cash limit"
else
  fail "the offer queue reports the cash position" "$(echo "$OFFERS" | head -c 300)"
fi

if ! echo "$OFFERS" | grep -q 'Handover Lane'; then
  pass "an OFFER carries no full address — only an area and a PIN code"
else
  fail "an offer carries no full address" "the drop line1 was exposed"
fi

CODE=$(curl -sS -b /tmp/ful-cust.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/accept")
if [ "$CODE" = "404" ]; then
  pass "a customer with no driver profile cannot accept a delivery"
else
  fail "a customer cannot accept a delivery" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-accept.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/accept")
if [ "$CODE" = "201" ]; then
  pass "the driver accepts the delivery"
else
  fail "the driver accepts the delivery" "HTTP $CODE — $(head -c 300 /tmp/ful-accept.json)"
fi

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "ASSIGNED" ]; then
  pass "the ORDER moved to ASSIGNED in the same transaction"
else
  fail "the order moved to ASSIGNED" "$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select availability from drivers where id = '${DRIVER_ID}'")" = "ON_DELIVERY" ]; then
  pass "the driver is marked ON_DELIVERY so dispatch stops offering them work"
else
  fail "the driver is marked ON_DELIVERY" "$(psql_q "select availability from drivers where id = '${DRIVER_ID}'")"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/accept")
if [ "$CODE" = "409" ]; then
  pass "a second accept loses the race with a 409"
else
  fail "a second accept loses the race" "got HTTP $CODE"
fi

if curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/deliveries/active" | grep -q '9876543210'; then
  pass "the ACTIVE delivery reveals the customer's phone (only for an active assignment)"
else
  fail "the active delivery reveals the customer's phone" "phone missing"
fi

# ---------------------------------------------------------------------------
# 4. Pickup and the road.
# ---------------------------------------------------------------------------
for step in reached-store pickup en-route; do
  CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-step.json -w '%{http_code}' -X POST \
    "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/${step}" \
    -H 'Content-Type: application/json' -d '{"position":{"latitude":22.7201,"longitude":75.8582}}')
  if [ "$CODE" = "200" ]; then
    pass "driver ${step}: recorded"
  else
    fail "driver ${step}" "HTTP $CODE — $(head -c 200 /tmp/ful-step.json)"
  fi
done

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "OUT_FOR_DELIVERY" ]; then
  pass "the customer's order says OUT_FOR_DELIVERY"
else
  fail "the order says OUT_FOR_DELIVERY" "$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select count(*) from delivery_status_history where delivery_id = '${DELIVERY_ID}' and latitude is not null")" -ge 1 ]; then
  pass "the position trail is recorded on the active delivery (purged after 7 days)"
else
  fail "the position trail is recorded" "no coordinates in the history"
fi

# ---------------------------------------------------------------------------
# 5. The OTP handover (D-20).
# ---------------------------------------------------------------------------
RESERVED_BEFORE=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
AVAILABLE_BEFORE=$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-otp.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/orders/${ORDER_ID}/delivery-code")
if [ "$CODE" = "404" ]; then
  pass "a driver cannot ask for the customer's delivery code"
else
  fail "a driver cannot ask for the delivery code" "got HTTP $CODE"
fi

OTP=$(curl -sS -b /tmp/ful-cust.txt -X POST "${BASE}/api/v1/orders/${ORDER_ID}/delivery-code" | jqv otp)
if echo "$OTP" | grep -qE '^[0-9]{6}$'; then
  pass "the customer can reveal a 6-digit delivery code"
else
  fail "the customer can reveal a delivery code" "got '$OTP'"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-deliver.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/deliver" -H 'Content-Type: application/json' \
  -d '{"otp":"000000","codCollectedPaise":100}')
if [ "$CODE" = "400" ] && grep -q 'attemptsRemaining' /tmp/ful-deliver.json; then
  pass "a wrong code is refused and the remaining attempts are reported"
else
  fail "a wrong code is refused" "HTTP $CODE — $(head -c 250 /tmp/ful-deliver.json)"
fi

if [ "$(psql_q "select otp_attempts from deliveries where id = '${DELIVERY_ID}'")" = "1" ]; then
  pass "the failed attempt is counted in the same transaction that rejected it"
else
  fail "the failed attempt is counted" "$(psql_q "select otp_attempts from deliveries where id = '${DELIVERY_ID}'")"
fi

if [ "$(psql_q "select status from deliveries where id = '${DELIVERY_ID}'")" != "DELIVERED" ]; then
  pass "a wrong code delivered NOTHING"
else
  fail "a wrong code delivered nothing" "the delivery completed anyway"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-deliver.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/deliver" -H 'Content-Type: application/json' \
  -d "{\"otp\":\"${OTP}\"}")
if [ "$CODE" = "400" ]; then
  pass "a COD delivery cannot be completed without stating the cash collected"
else
  fail "a COD delivery requires the cash collected" "got HTTP $CODE"
fi

# Deliberately ₹5 short, to prove the variance path.
SHORT=$((TOTAL - 500))
CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-deliver.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/deliver" -H 'Content-Type: application/json' \
  -d "{\"otp\":\"${OTP}\",\"codCollectedPaise\":${SHORT},\"recipientName\":\"Ful Tester\"}")

if [ "$CODE" = "200" ]; then
  pass "the correct code completes the delivery"
else
  fail "the correct code completes the delivery" "HTTP $CODE — $(head -c 300 /tmp/ful-deliver.json)"
fi

if [ "$(jqv warning < /tmp/ful-deliver.json)" = "COD_AMOUNT_MISMATCH" ]; then
  pass "a short collection is reported as a WARNING, not a refusal"
else
  fail "a short collection is a warning" "$(head -c 250 /tmp/ful-deliver.json)"
fi

if [ "$(psql_q "select cod_variance_paise from deliveries where id = '${DELIVERY_ID}'")" = "500" ]; then
  pass "the ₹5 variance is recorded on the delivery"
else
  fail "the variance is recorded" "$(psql_q "select cod_variance_paise from deliveries where id = '${DELIVERY_ID}'")"
fi

# ---------------------------------------------------------------------------
# 6. Everything the handover had to settle, in one transaction.
# ---------------------------------------------------------------------------
if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "DELIVERED" ]; then
  pass "the ORDER is DELIVERED"
else
  fail "the order is DELIVERED" "$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select otp_verified_at is not null from deliveries where id = '${DELIVERY_ID}'")" = "t" ]; then
  pass "the OTP verification is stamped"
else
  fail "the OTP verification is stamped" "otp_verified_at was null"
fi

if [ "$(psql_q "select count(*) from delivery_proofs where delivery_id = '${DELIVERY_ID}' and proof_type = 'OTP' and otp_verified")" = "1" ]; then
  pass "an OTP proof row records the handover"
else
  fail "an OTP proof row is written" "no proof row"
fi

RESERVED_AFTER=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
AVAILABLE_AFTER=$(psql_q "select quantity_available from inventory where variant_id = '${VARIANT}'")

if [ "$RESERVED_AFTER" = "$((RESERVED_BEFORE - 6))" ] && [ "$AVAILABLE_AFTER" = "$AVAILABLE_BEFORE" ]; then
  pass "the reservation became a SALE: reserved −6, available unchanged"
else
  fail "the reservation became a sale" "reserved ${RESERVED_BEFORE}->${RESERVED_AFTER}, available ${AVAILABLE_BEFORE}->${AVAILABLE_AFTER}"
fi

if [ "$(psql_q "select count(*) from inventory_transactions where reference_id = '${ORDER_ID}' and txn_type = 'SALE'")" = "1" ]; then
  pass "the sale is in the stock ledger"
else
  fail "the sale is in the stock ledger" "no SALE row"
fi

if [ "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")" = "PAID" ]; then
  pass "the COD payment is PAID"
else
  fail "the COD payment is PAID" "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")"
fi

LEDGER_AMOUNT=$(psql_q "select amount_paise from driver_cash_ledger where delivery_id = '${DELIVERY_ID}' and entry_type = 'COLLECTION'")
if [ "$LEDGER_AMOUNT" = "$SHORT" ]; then
  pass "the driver's cash ledger records exactly what was COLLECTED, not what was owed"
else
  fail "the cash ledger records what was collected" "ledger=${LEDGER_AMOUNT} collected=${SHORT}"
fi

# ---------------------------------------------------------------------------
# 7. Replaying the handover must not double anything.
# ---------------------------------------------------------------------------
curl -sS -b /tmp/ful-driver.txt -o /dev/null -X POST \
  "${BASE}/api/v1/driver/deliveries/${DELIVERY_ID}/deliver" -H 'Content-Type: application/json' \
  -d "{\"otp\":\"${OTP}\",\"codCollectedPaise\":${SHORT}}"

if [ "$(psql_q "select count(*) from driver_cash_ledger where delivery_id = '${DELIVERY_ID}' and entry_type = 'COLLECTION'")" = "1" ]; then
  pass "a replayed handover writes NO second cash entry"
else
  fail "a replayed handover writes no second cash entry" "$(psql_q "select count(*) from driver_cash_ledger where delivery_id = '${DELIVERY_ID}'") rows"
fi

if [ "$(psql_q "select count(*) from inventory_transactions where reference_id = '${ORDER_ID}' and txn_type = 'SALE'")" = "1" ]; then
  pass "a replayed handover consumes the stock only once"
else
  fail "a replayed handover consumes stock once" "duplicate SALE rows"
fi

if [ "$(psql_q "select availability from drivers where id = '${DRIVER_ID}'")" = "ONLINE" ]; then
  pass "the driver is back ONLINE and can take more work"
else
  fail "the driver is back online" "$(psql_q "select availability from drivers where id = '${DRIVER_ID}'")"
fi

# ---------------------------------------------------------------------------
# 8. The cash the driver is now holding.
# ---------------------------------------------------------------------------
CASH=$(curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/cash")
if [ "$(echo "$CASH" | jqv cashInHandPaise)" = "$SHORT" ]; then
  pass "cash in hand is DERIVED from the ledger and equals the collection"
else
  fail "cash in hand equals the collection" "$(echo "$CASH" | head -c 250)"
fi

if echo "$CASH" | grep -q '"isCodBlocked":false'; then
  pass "the driver is still under the float limit"
else
  fail "the driver is under the float limit" "$(echo "$CASH" | head -c 250)"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-dep.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/cash/deposits" -H 'Content-Type: application/json' \
  -d "{\"declaredAmountPaise\":$((SHORT + 100000)),\"method\":\"OFFICE_CASH\",\"idempotencyKey\":\"dep-too-much-1\"}")
if [ "$CODE" = "400" ]; then
  pass "a driver cannot declare more cash than the ledger says they hold"
else
  fail "a driver cannot over-declare a deposit" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /tmp/ful-dep.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/cash/deposits" -H 'Content-Type: application/json' \
  -d "{\"declaredAmountPaise\":${SHORT},\"method\":\"OFFICE_CASH\",\"reference\":\"SLIP-001\",\"idempotencyKey\":\"dep-ok-1\"}")
DEPOSIT_ID=$(jqv depositId < /tmp/ful-dep.json)

if [ "$CODE" = "201" ] && [ -n "$DEPOSIT_ID" ]; then
  pass "the driver declares a deposit"
else
  fail "the driver declares a deposit" "HTTP $CODE — $(head -c 250 /tmp/ful-dep.json)"
fi

if [ "$(curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/cash" | jqv cashInHandPaise)" = "$SHORT" ]; then
  pass "DECLARING does not reduce the float — only a verified count does"
else
  fail "declaring does not reduce the float" "the float moved on a declaration"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/driver/cash/deposits" -H 'Content-Type: application/json' \
  -d "{\"declaredAmountPaise\":${SHORT},\"method\":\"OFFICE_CASH\",\"reference\":\"SLIP-001\",\"idempotencyKey\":\"dep-ok-1\"}")
if [ "$CODE" = "200" ] && [ "$(psql_q "select count(*) from cash_deposits")" = "1" ]; then
  pass "a repeated declaration is recognised rather than duplicated"
else
  fail "a repeated declaration is not duplicated" "HTTP $CODE, deposits=$(psql_q "select count(*) from cash_deposits")"
fi

# ---------------------------------------------------------------------------
# 9. Verification is the only thing that moves the float.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -b /tmp/ful-support.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/deposits/${DEPOSIT_ID}/verify" -H 'Content-Type: application/json' \
  -d "{\"verifiedAmountPaise\":${SHORT}}")
if [ "$CODE" = "403" ]; then
  pass "an admin without cash:reconcile cannot verify a deposit"
else
  fail "cash:reconcile is enforced" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/ful-driver.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/deposits/${DEPOSIT_ID}/verify" -H 'Content-Type: application/json' \
  -d "{\"verifiedAmountPaise\":${SHORT}}")
if [ "$CODE" = "403" ]; then
  pass "a driver cannot verify their own deposit"
else
  fail "a driver cannot verify their own deposit" "got HTTP $CODE"
fi

# Counted ₹2 short of the declaration, to prove the variance path.
VERIFIED=$((SHORT - 200))
CODE=$(curl -sS -b /tmp/ful-admin.txt -o /tmp/ful-verify.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/deposits/${DEPOSIT_ID}/verify" -H 'Content-Type: application/json' \
  -d "{\"verifiedAmountPaise\":${VERIFIED},\"notes\":\"Counted at the office\"}")

if [ "$CODE" = "200" ] && [ "$(jqv hasVariance < /tmp/ful-verify.json)" = "true" ]; then
  pass "verifying with a short count records a variance"
else
  fail "verifying records a variance" "HTTP $CODE — $(head -c 250 /tmp/ful-verify.json)"
fi

if [ "$(psql_q "select status from cash_deposits where id = '${DEPOSIT_ID}'")" = "PARTIAL" ]; then
  pass "the deposit is PARTIAL, keeping a discrepancy distinguishable from a clean settlement"
else
  fail "the deposit is marked PARTIAL" "$(psql_q "select status from cash_deposits where id = '${DEPOSIT_ID}'")"
fi

if [ "$(psql_q "select amount_paise from driver_cash_ledger where cash_deposit_id = '${DEPOSIT_ID}'")" = "-${VERIFIED}" ]; then
  pass "the ledger is credited with what was COUNTED, negative, not what was declared"
else
  fail "the ledger credits the counted amount" "$(psql_q "select amount_paise from driver_cash_ledger where cash_deposit_id = '${DEPOSIT_ID}'")"
fi

if [ "$(curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/cash" | jqv cashInHandPaise)" = "200" ]; then
  pass "the driver still owes exactly the ₹2 that was missing from the envelope"
else
  fail "the remaining float is the shortfall" "$(curl -sS -b /tmp/ful-driver.txt "${BASE}/api/v1/driver/cash" | jqv cashInHandPaise)"
fi

CODE=$(curl -sS -b /tmp/ful-admin.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/deposits/${DEPOSIT_ID}/verify" -H 'Content-Type: application/json' \
  -d "{\"verifiedAmountPaise\":${VERIFIED}}")
if [ "$CODE" = "400" ]; then
  pass "a deposit cannot be verified twice"
else
  fail "a deposit cannot be verified twice" "got HTTP $CODE"
fi

if [ "$(psql_q "select count(*) from driver_cash_ledger where cash_deposit_id = '${DEPOSIT_ID}'")" = "1" ]; then
  pass "the refused second verification moved no money"
else
  fail "the refused second verification moved no money" "duplicate DEPOSIT rows"
fi

# ---------------------------------------------------------------------------
# 10. The admin's view of the money.
# ---------------------------------------------------------------------------
BOARD=$(curl -sS -b /tmp/ful-admin.txt "${BASE}/api/v1/admin/cash/drivers")
if echo "$BOARD" | grep -q '"totalOutstandingPaise":200'; then
  pass "the admin board reports the platform's live cash exposure"
else
  fail "the admin board reports cash exposure" "$(echo "$BOARD" | head -c 300)"
fi

VAR=$(curl -sS -b /tmp/ful-admin.txt "${BASE}/api/v1/admin/cash/variances")
if echo "$VAR" | grep -q "$DELIVERY_ID"; then
  pass "the collection variance appears in the variance report"
else
  fail "the variance appears in the report" "$(echo "$VAR" | head -c 300)"
fi

CODE=$(curl -sS -b /tmp/ful-support.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/adjustments" -H 'Content-Type: application/json' \
  -d "{\"driverId\":\"${DRIVER_ID}\",\"amountPaise\":-200,\"reason\":\"support tried\"}")
if [ "$CODE" = "403" ]; then
  pass "cash:adjust is enforced separately from cash:reconcile"
else
  fail "cash:adjust is enforced separately" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/ful-admin.txt -o /tmp/ful-adj.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/cash/adjustments" -H 'Content-Type: application/json' \
  -d "{\"driverId\":\"${DRIVER_ID}\",\"amountPaise\":-200,\"reason\":\"Shortfall written off after review\",\"isWriteOff\":true}")
if [ "$CODE" = "201" ] && [ "$(jqv cashInHandPaise < /tmp/ful-adj.json)" = "0" ]; then
  pass "a write-off clears the shortfall and the float returns to zero"
else
  fail "a write-off clears the shortfall" "HTTP $CODE — $(head -c 250 /tmp/ful-adj.json)"
fi

if [ -n "$(psql_q "select reason from driver_cash_ledger where entry_type = 'WRITE_OFF'")" ]; then
  pass "the write-off carries a reason — the audit trail is the reason"
else
  fail "the write-off carries a reason" "reason was empty"
fi

# ---------------------------------------------------------------------------
# 11. The screens.
#
# The APIs above are proven; these assert the pages are actually wired to them and that the
# permission split is honoured in the UI as well as in the endpoint.
# ---------------------------------------------------------------------------
if curl -sS -b /tmp/ful-vendor.txt "${BASE}/vendor/orders" | grep -q 'data-testid="vendor-order-queue"'; then
  pass "/vendor/orders renders the real queue, not the placeholder"
else
  fail "/vendor/orders renders the real queue" "queue testid missing"
fi

if curl -sS -b /tmp/ful-vendor.txt "${BASE}/vendor/orders" | grep -q 'data-testid="dashboard-pending"'; then
  fail "/vendor/orders no longer shows the pending placeholder" "the placeholder is still rendered"
else
  pass "/vendor/orders no longer shows the pending placeholder"
fi

if curl -sS -b /tmp/ful-cust.txt "${BASE}/vendor/orders" | grep -q 'data-testid="vendor-order-queue"'; then
  fail "a customer cannot see the vendor queue screen" "the queue rendered for a customer"
else
  pass "a customer cannot see the vendor queue screen"
fi

if curl -sS -b /tmp/ful-driver.txt "${BASE}/driver" | grep -q 'data-testid="driver-console"'; then
  pass "/driver renders the working console"
else
  fail "/driver renders the working console" "console testid missing"
fi

if curl -sS -b /tmp/ful-driver.txt "${BASE}/driver/cash" | grep -q 'data-testid="driver-cash-panel"'; then
  pass "/driver/cash renders the float panel"
else
  fail "/driver/cash renders the float panel" "panel testid missing"
fi

if curl -sS -b /tmp/ful-admin.txt "${BASE}/admin/cash" | grep -q 'data-testid="admin-cash-board"'; then
  pass "/admin/cash renders the reconciliation board"
else
  fail "/admin/cash renders the reconciliation board" "board testid missing"
fi

# `cash:view` without `cash:reconcile` must see the queue and not the controls.
if curl -sS -b /tmp/ful-support.txt "${BASE}/admin/cash" | grep -q 'data-testid="admin-cash-board"'; then
  fail "an admin without cash:view cannot open the board" "the board rendered"
else
  pass "an admin without cash:view cannot open the board"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "❌ Fulfilment flow: ${failures} failure(s)."
  echo "--- server log ---"
  tail -40 /tmp/ful-server.log
  exit 1
fi

echo "✅ Fulfilment flow verified."
