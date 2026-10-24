#!/usr/bin/env bash
#
# End-to-end proof of the PAYMENT path against a live server and a real database.
#
# WHY THIS EXISTS: every rule that protects money here is invisible to a typechecker and to a
# unit test with a fake repository. A forged webhook, a replayed webhook, a capture for the
# wrong amount and a late failure after a successful capture all LOOK like ordinary successful
# requests. The only way to know they are handled is to send them at a real route handler with a
# real database behind it and then read the rows.
#
# It runs against the MOCK GATEWAY (no RAZORPAY_KEY_ID present), which signs with the same Web
# Crypto HMAC code as production under a published development secret. So the signature path
# under test is the one that ships — the merchant account is the only thing being stood in for.
#
# Everything is torn down on exit. Requires docker or podman.
#
# Usage: bash scripts/check-payment-flow.sh [port]

set -uo pipefail

PORT="${1:-3270}"
CONTAINER="parthik-payment-check"
PG_PORT=55467
PG_PASSWORD="localonly"
DB_NAME="parthik_payment_check"
BASE="http://127.0.0.1:${PORT}"
MOCK_SECRET="parthik-mock-webhook-secret"

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
  rm -f /tmp/pay-*.txt /tmp/pay-*.json /tmp/pay-server.log
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
export AUTH_SECRET="payment-flow-check-secret-long-enough-ok"
# Left UNSET deliberately: `auto` must resolve to the mock gateway outside production.
unset RAZORPAY_KEY_ID RAZORPAY_KEY_SECRET RAZORPAY_WEBHOOK_SECRET PAYMENTS_PROVIDER 2>/dev/null || true

echo "Applying migrations and seeding…"
pnpm --silent db:migrate >/dev/null 2>&1 || { echo "❌ Migrations failed."; exit 1; }
pnpm --silent seed >/dev/null 2>&1 || { echo "❌ Reference seed failed."; exit 1; }
pnpm --silent seed:demo >/dev/null 2>&1 || { echo "❌ Demo seed failed."; exit 1; }

if [ ! -d .next ]; then
  echo "❌ No production build. Run \`pnpm build\` first."
  exit 1
fi

echo "Starting the app…"
node_modules/.bin/next start --port "$PORT" > /tmp/pay-server.log 2>&1 &
server_pid=$!

for _ in $(seq 1 45); do
  curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null && break
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server did not become ready:"
  tail -20 /tmp/pay-server.log
  exit 1
fi

failures=0
pass() { echo "  ✅ $1"; }
fail() { echo "  ❌ $1"; echo "     $2"; failures=$((failures + 1)); }

psql_q() { "$RUNTIME" exec "$CONTAINER" psql -tAqU postgres -d "$DB_NAME" -c "$1" | tr -d '[:space:]'; }
jqv() { grep -o "\"$1\":[^,}]*" | head -1 | cut -d: -f2- | tr -d '"'; }

# Builds a signed mock webhook body. Node's crypto is fine HERE — this is a check script, not
# application code that has to run on Cloudflare Workers.
sign_body() {
  node -e '
    const crypto = require("node:crypto");
    const body = process.argv[1];
    process.stdout.write(crypto.createHmac("sha256", process.argv[2]).update(body).digest("hex"));
  ' "$1" "$MOCK_SECRET"
}

capture_body() {
  # $1 = payment id, $2 = provider order id, $3 = amount paise, $4 = event ("captured"/"failed")
  local status="captured"
  local event="payment.captured"
  if [ "${4:-captured}" = "failed" ]; then status="failed"; event="payment.failed"; fi

  local error_fields='"error_code":null,"error_description":null'
  if [ "${4:-captured}" = "failed" ]; then
    error_fields='"error_code":"BAD_REQUEST_ERROR","error_description":"Payment declined by bank"'
  fi

  printf '{"entity":"event","event":"%s","created_at":%s,"payload":{"payment":{"entity":{"id":"%s","order_id":"%s","amount":%s,"currency":"INR","status":"%s","method":"upi",%s}}}}' \
    "$event" "$(date +%s)" "$1" "$2" "$3" "$status" "$error_fields"
}

post_webhook() {
  # $1 = raw body, $2 = signature, $3 = event id, $4 = provider path segment
  curl -sS -o /tmp/pay-webhook.json -w '%{http_code}' -X POST \
    "${BASE}/api/v1/webhooks/payments/${4:-mock}" \
    -H 'Content-Type: application/json' \
    -H "x-razorpay-signature: ${2}" \
    -H "x-razorpay-event-id: ${3}" \
    --data-binary "$1"
}

VARIANT=$(psql_q "select pv.id from product_variants pv join products p on p.id = pv.product_id order by pv.id limit 1")
SERVICEABLE_PIN=$(psql_q "select pincode from zone_pincodes where is_active limit 1")

echo
echo "Payments:"
echo

# ---- A customer with a cart and an address ----
curl -sS -c /tmp/pay-jar.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"customer"}' -o /dev/null
curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/addresses" \
  -H 'Content-Type: application/json' \
  -d "{\"recipientName\":\"Pay Tester\",\"recipientPhone\":\"9876543210\",\"line1\":\"7 Pay Lane\",\"city\":\"Indore\",\"state\":\"Madhya Pradesh\",\"pincode\":\"${SERVICEABLE_PIN}\",\"isDefault\":true}" \
  -o /dev/null

place_prepaid_order() {
  curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/cart/items" \
    -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null
  curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/orders" \
    -H 'Content-Type: application/json' \
    -d "{\"idempotencyKey\":\"pay-$(date +%s%N)\",\"paymentMethod\":\"UPI\"}" -o /tmp/pay-order.json
  jqv id < /tmp/pay-order.json
}

ORDER_ID=$(place_prepaid_order)

if [ -n "$ORDER_ID" ] && [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "PENDING_PAYMENT" ]; then
  pass "a prepaid order waits in PENDING_PAYMENT"
else
  fail "a prepaid order waits in PENDING_PAYMENT" "$(head -c 300 /tmp/pay-order.json)"
fi

RESERVED_AFTER_ORDER=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")

# ---------------------------------------------------------------------------
# 1. The intent.
# ---------------------------------------------------------------------------
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${ORDER_ID}\"}")
if [ "$CODE" = "401" ]; then
  pass "an anonymous caller cannot create a payment intent"
else
  fail "an anonymous caller cannot create a payment intent" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/pay-jar.txt -o /tmp/pay-intent.json -w '%{http_code}' \
  -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${ORDER_ID}\"}")

PROVIDER_ORDER=$(jqv providerOrderId < /tmp/pay-intent.json)
PAYMENT_ID=$(jqv id < /tmp/pay-intent.json)

if [ "$CODE" = "200" ] && [ -n "$PROVIDER_ORDER" ]; then
  pass "the intent returns a gateway reference ($PROVIDER_ORDER)"
else
  fail "the intent returns a gateway reference" "HTTP $CODE — $(head -c 300 /tmp/pay-intent.json)"
fi

if [ "$(jqv provider < /tmp/pay-intent.json)" = "mock" ]; then
  pass "PAYMENTS_PROVIDER=auto resolved to the mock gateway with no credentials present"
else
  fail "auto resolved to the mock gateway" "provider was $(jqv provider < /tmp/pay-intent.json)"
fi

if ! grep -qi 'secret' /tmp/pay-intent.json; then
  pass "the intent response carries no secret"
else
  fail "the intent response carries no secret" "found a secret-looking field"
fi

if [ "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")" = "PENDING" ]; then
  pass "the payment row moved to PENDING and stored the gateway reference"
else
  fail "the payment row moved to PENDING" "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")"
fi

curl -sS -b /tmp/pay-jar.txt -o /tmp/pay-intent2.json -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${ORDER_ID}\"}"

if [ "$(jqv providerOrderId < /tmp/pay-intent2.json)" = "$PROVIDER_ORDER" ]; then
  pass "a repeated intent returns the SAME gateway order, not a second payable one"
else
  fail "a repeated intent returns the same gateway order" "$(jqv providerOrderId < /tmp/pay-intent2.json)"
fi

if [ "$(psql_q "select count(*) from payments where order_id = '${ORDER_ID}'")" = "1" ]; then
  pass "there is still exactly ONE payment row for the order"
else
  fail "there is one payment row for the order" "$(psql_q "select count(*) from payments where order_id = '${ORDER_ID}'")"
fi

# ---------------------------------------------------------------------------
# 2. Forged and malformed webhooks change nothing.
# ---------------------------------------------------------------------------
BODY=$(capture_body "pay_mock_1" "$PROVIDER_ORDER" 173400)
GOOD_SIG=$(sign_body "$BODY")

CODE=$(post_webhook "$BODY" "deadbeef" "evt-forged-1")
if [ "$CODE" = "401" ]; then
  pass "a webhook with a WRONG signature is refused with 401"
else
  fail "a webhook with a wrong signature is refused" "got HTTP $CODE"
fi

CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/webhooks/payments/mock" \
  -H 'Content-Type: application/json' --data-binary "$BODY")
if [ "$CODE" = "401" ]; then
  pass "a webhook with NO signature is refused with 401"
else
  fail "a webhook with no signature is refused" "got HTTP $CODE"
fi

# The tampering the signature exists to stop: same shape, different number.
TAMPERED=${BODY/173400/1}
CODE=$(post_webhook "$TAMPERED" "$GOOD_SIG" "evt-tampered-1")
if [ "$CODE" = "401" ]; then
  pass "a body modified after signing is refused"
else
  fail "a body modified after signing is refused" "got HTTP $CODE"
fi

if [ "$(psql_q "select count(*) from payment_events")" = "0" ]; then
  pass "NOTHING was stored for any unverified body"
else
  fail "nothing was stored for an unverified body" "$(psql_q "select count(*) from payment_events") event rows exist"
fi

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "PENDING_PAYMENT" ]; then
  pass "the order was untouched by the forged webhooks"
else
  fail "the order was untouched by the forged webhooks" "$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

CODE=$(post_webhook "$BODY" "$GOOD_SIG" "evt-unknown-provider" "razorpay")
if [ "$CODE" = "401" ]; then
  pass "the razorpay endpoint refuses everything while no webhook secret is configured"
else
  fail "the razorpay endpoint refuses without a secret" "got HTTP $CODE"
fi

CODE=$(post_webhook "$BODY" "$GOOD_SIG" "evt-bad-path" "stripe")
if [ "$CODE" = "404" ]; then
  pass "an unknown provider in the path is a 404"
else
  fail "an unknown provider in the path is a 404" "got HTTP $CODE"
fi

# ---------------------------------------------------------------------------
# 3. A correctly signed capture for the WRONG amount must not confirm the order.
# ---------------------------------------------------------------------------
SHORT_BODY=$(capture_body "pay_mock_short" "$PROVIDER_ORDER" 100)
SHORT_SIG=$(sign_body "$SHORT_BODY")

CODE=$(post_webhook "$SHORT_BODY" "$SHORT_SIG" "evt-short-1")
if [ "$CODE" = "200" ]; then
  pass "a short capture is accepted for logging (retrying would not help)"
else
  fail "a short capture is accepted for logging" "got HTTP $CODE"
fi

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "PENDING_PAYMENT" ] &&
   [ "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")" = "PENDING" ]; then
  pass "an amount mismatch confirms NOTHING — the order and payment are unchanged"
else
  fail "an amount mismatch confirms nothing" "order=$(psql_q "select status from orders where id = '${ORDER_ID}'") payment=$(psql_q "select status from payments where order_id = '${ORDER_ID}'")"
fi

if [ -n "$(psql_q "select processing_error from payment_events where provider_event_id = 'evt-short-1'")" ]; then
  pass "the mismatch is recorded on the event, not silently dropped"
else
  fail "the mismatch is recorded on the event" "processing_error was empty"
fi

# ---------------------------------------------------------------------------
# 4. The real capture.
# ---------------------------------------------------------------------------
TOTAL=$(psql_q "select total_amount_paise from orders where id = '${ORDER_ID}'")
CAP_BODY=$(capture_body "pay_mock_paid_1" "$PROVIDER_ORDER" "$TOTAL")
CAP_SIG=$(sign_body "$CAP_BODY")

CODE=$(post_webhook "$CAP_BODY" "$CAP_SIG" "evt-capture-1")
if [ "$CODE" = "200" ]; then
  pass "a verified capture is accepted"
else
  fail "a verified capture is accepted" "HTTP $CODE — $(head -c 300 /tmp/pay-webhook.json)"
fi

if [ "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")" = "PAID" ]; then
  pass "the payment is PAID"
else
  fail "the payment is PAID" "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "CONFIRMED" ]; then
  pass "the ORDER is CONFIRMED in the same transaction"
else
  fail "the order is CONFIRMED" "$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select payment_status from orders where id = '${ORDER_ID}'")" = "PAID" ]; then
  pass "the order's payment status agrees with the payment row"
else
  fail "the order's payment status agrees" "$(psql_q "select payment_status from orders where id = '${ORDER_ID}'")"
fi

if [ "$(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}' and to_status = 'CONFIRMED' and changed_by_role = 'SYSTEM'")" = "1" ]; then
  pass "the confirmation is in the order history, attributed to SYSTEM"
else
  fail "the confirmation is in the order history" "no SYSTEM history row"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$RESERVED_AFTER_ORDER" ]; then
  pass "stock stays RESERVED on payment — it is consumed at delivery, not at capture"
else
  fail "stock stays reserved on payment" "reserved is now $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

if [ -n "$(psql_q "select paid_at from payments where order_id = '${ORDER_ID}'")" ]; then
  pass "paid_at is stamped"
else
  fail "paid_at is stamped" "paid_at was null"
fi

if [ "$(psql_q "select payment_id is not null from payment_events where provider_event_id = 'evt-capture-1'")" = "t" ]; then
  pass "the stored event is linked to the payment"
else
  fail "the stored event is linked to the payment" "payment_id was null"
fi

# ---------------------------------------------------------------------------
# 5. REPLAY — the case a unique index has to win.
# ---------------------------------------------------------------------------
CODE=$(post_webhook "$CAP_BODY" "$CAP_SIG" "evt-capture-1")
if [ "$CODE" = "200" ] && grep -q 'REPLAYED' /tmp/pay-webhook.json; then
  pass "a replayed delivery is reported as REPLAYED with 200"
else
  fail "a replayed delivery is reported as REPLAYED" "HTTP $CODE — $(head -c 200 /tmp/pay-webhook.json)"
fi

if [ "$(psql_q "select count(*) from payment_events where provider_event_id = 'evt-capture-1'")" = "1" ]; then
  pass "the unique index kept exactly one event row"
else
  fail "the unique index kept one event row" "$(psql_q "select count(*) from payment_events where provider_event_id = 'evt-capture-1'")"
fi

if [ "$(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}' and to_status = 'CONFIRMED'")" = "1" ]; then
  pass "the replay produced NO second confirmation in the history"
else
  fail "the replay produced no second confirmation" "$(psql_q "select count(*) from order_status_history where order_id = '${ORDER_ID}' and to_status = 'CONFIRMED'")"
fi

# A late failure for an earlier attempt must not undo a successful capture.
LATE_BODY=$(capture_body "pay_mock_failed_1" "$PROVIDER_ORDER" "$TOTAL" failed)
LATE_SIG=$(sign_body "$LATE_BODY")
post_webhook "$LATE_BODY" "$LATE_SIG" "evt-late-failure-1" >/dev/null

if [ "$(psql_q "select status from orders where id = '${ORDER_ID}'")" = "CONFIRMED" ] &&
   [ "$(psql_q "select status from payments where order_id = '${ORDER_ID}'")" = "PAID" ]; then
  pass "a late failure event does NOT undo a capture"
else
  fail "a late failure does not undo a capture" "order=$(psql_q "select status from orders where id = '${ORDER_ID}'")"
fi

# ---------------------------------------------------------------------------
# 6. The status endpoint.
# ---------------------------------------------------------------------------
STATUS=$(curl -sS -b /tmp/pay-jar.txt "${BASE}/api/v1/payments/${PAYMENT_ID}/status")
if [ "$(echo "$STATUS" | jqv status)" = "PAID" ] && echo "$STATUS" | grep -q '"isPending":false'; then
  pass "the status endpoint reports PAID and stops the client polling"
else
  fail "the status endpoint reports PAID" "$(echo "$STATUS" | head -c 300)"
fi

curl -sS -c /tmp/pay-other.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"driver"}' -o /dev/null

CODE=$(curl -sS -b /tmp/pay-other.txt -o /dev/null -w '%{http_code}' \
  "${BASE}/api/v1/payments/${PAYMENT_ID}/status")
if [ "$CODE" = "404" ]; then
  pass "another account gets 404 for someone else's payment"
else
  fail "another account gets 404 for someone else's payment" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/pay-jar.txt -o /dev/null -w '%{http_code}' \
  -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${ORDER_ID}\"}")
if [ "$CODE" = "400" ]; then
  pass "a paid order refuses a new intent, so it cannot be paid twice"
else
  fail "a paid order refuses a new intent" "got HTTP $CODE"
fi

# ---------------------------------------------------------------------------
# 7. A FAILED payment releases the stock.
# ---------------------------------------------------------------------------
FAIL_ORDER=$(place_prepaid_order)
curl -sS -b /tmp/pay-jar.txt -o /tmp/pay-intent3.json -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${FAIL_ORDER}\"}"
FAIL_PROVIDER_ORDER=$(jqv providerOrderId < /tmp/pay-intent3.json)

RESERVED_BEFORE_FAIL=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
FAIL_TOTAL=$(psql_q "select total_amount_paise from orders where id = '${FAIL_ORDER}'")

F_BODY=$(capture_body "pay_mock_failed_2" "$FAIL_PROVIDER_ORDER" "$FAIL_TOTAL" failed)
F_SIG=$(sign_body "$F_BODY")
post_webhook "$F_BODY" "$F_SIG" "evt-failure-2" >/dev/null

if [ "$(psql_q "select status from orders where id = '${FAIL_ORDER}'")" = "PAYMENT_FAILED" ]; then
  pass "a verified failure moves the order to PAYMENT_FAILED"
else
  fail "a verified failure moves the order to PAYMENT_FAILED" "$(psql_q "select status from orders where id = '${FAIL_ORDER}'")"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$((RESERVED_BEFORE_FAIL - 6))" ]; then
  pass "the failure RELEASES the reserved stock — holding it would strangle availability"
else
  fail "the failure releases the reserved stock" "reserved ${RESERVED_BEFORE_FAIL} -> $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

if [ -n "$(psql_q "select failure_code from payments where order_id = '${FAIL_ORDER}'")" ]; then
  pass "the gateway's failure code is recorded"
else
  fail "the gateway's failure code is recorded" "failure_code was empty"
fi

CODE=$(curl -sS -b /tmp/pay-jar.txt -o /dev/null -w '%{http_code}' \
  -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${FAIL_ORDER}\"}")
if [ "$CODE" = "200" ]; then
  pass "a failed order can be retried — this is the recovery path"
else
  fail "a failed order can be retried" "got HTTP $CODE"
fi

RETRY_PROVIDER_ORDER=$(curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/payments/intent" \
  -H 'Content-Type: application/json' -d "{\"orderId\":\"${FAIL_ORDER}\"}" | jqv providerOrderId)

RESERVED_BEFORE_RECOVERY=$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")
R_BODY=$(capture_body "pay_mock_paid_recovered" "$RETRY_PROVIDER_ORDER" "$FAIL_TOTAL")
R_SIG=$(sign_body "$R_BODY")
R_CODE=$(post_webhook "$R_BODY" "$R_SIG" "evt-recovery-1")

if [ "$(psql_q "select status from orders where id = '${FAIL_ORDER}'")" = "CONFIRMED" ]; then
  pass "a recovered payment confirms the previously failed order"
else
  fail "a recovered payment confirms the failed order" "order=$(psql_q "select status from orders where id = '${FAIL_ORDER}'") payment=$(psql_q "select status from payments where order_id = '${FAIL_ORDER}'") webhook=HTTP ${R_CODE} $(head -c 200 /tmp/pay-webhook.json)"
fi

if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$((RESERVED_BEFORE_RECOVERY + 6))" ]; then
  pass "recovery RE-RESERVES the stock the failure released"
else
  fail "recovery re-reserves the released stock" "reserved ${RESERVED_BEFORE_RECOVERY} -> $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

# An ADJUSTMENT, not a second RESERVE: the unique index on (reference_id, variant_id, txn_type)
# is what makes RESERVE and RELEASE idempotent per order, so a second RESERVE row cannot exist.
if [ "$(psql_q "select count(*) from inventory_transactions where reference_id = '${FAIL_ORDER}' and txn_type = 'ADJUSTMENT'")" = "1" ]; then
  pass "the re-reservation is an attributable ADJUSTMENT row, so stock stays reproducible"
else
  fail "the re-reservation is in the ledger" "$(psql_q "select count(*) from inventory_transactions where reference_id = '${FAIL_ORDER}' and txn_type = 'ADJUSTMENT'") ADJUSTMENT rows"
fi

# Replaying the recovery capture must not remove the units twice.
post_webhook "$R_BODY" "$R_SIG" "evt-recovery-1" >/dev/null
if [ "$(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")" = "$((RESERVED_BEFORE_RECOVERY + 6))" ]; then
  pass "a replayed recovery capture re-reserves nothing further"
else
  fail "a replayed recovery capture re-reserves nothing further" "reserved is now $(psql_q "select quantity_reserved from inventory where variant_id = '${VARIANT}'")"
fi

# ---------------------------------------------------------------------------
# 8. Refunds, and who may issue them.
# ---------------------------------------------------------------------------
curl -sS -c /tmp/pay-support.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"support"}' -o /dev/null

CODE=$(curl -sS -b /tmp/pay-support.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/orders/${ORDER_ID}/refund" -H 'Content-Type: application/json' \
  -d '{"amountPaise":1000,"reason":"support tried"}')
if [ "$CODE" = "403" ]; then
  pass "an admin WITHOUT refund:manage is refused with 403"
else
  fail "an admin without refund:manage is refused" "got HTTP $CODE"
fi

CODE=$(curl -sS -b /tmp/pay-jar.txt -o /dev/null -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/orders/${ORDER_ID}/refund" -H 'Content-Type: application/json' \
  -d '{"amountPaise":1000,"reason":"customer tried"}')
if [ "$CODE" = "403" ]; then
  pass "a customer cannot refund their own order"
else
  fail "a customer cannot refund their own order" "got HTTP $CODE"
fi

curl -sS -c /tmp/pay-admin.txt -X POST "${BASE}/api/v1/auth/dev-session" \
  -H 'Content-Type: application/json' -d '{"role":"admin"}' -o /dev/null

CODE=$(curl -sS -b /tmp/pay-admin.txt -o /tmp/pay-refund.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/orders/${ORDER_ID}/refund" -H 'Content-Type: application/json' \
  -d '{"amountPaise":1000,"reason":"Damaged item"}')

if [ "$CODE" = "201" ] && [ "$(jqv refundMode < /tmp/pay-refund.json)" = "GATEWAY" ]; then
  pass "an authorised refund on a prepaid order goes through the GATEWAY"
else
  fail "an authorised refund goes through the gateway" "HTTP $CODE — $(head -c 300 /tmp/pay-refund.json)"
fi

if [ "$(psql_q "select count(*) from refunds where order_id = '${ORDER_ID}'")" = "1" ]; then
  pass "the refund is recorded with its initiator"
else
  fail "the refund is recorded" "$(psql_q "select count(*) from refunds where order_id = '${ORDER_ID}'")"
fi

if [ -n "$(psql_q "select initiated_by from refunds where order_id = '${ORDER_ID}'")" ]; then
  pass "who authorised the money leaving is stored"
else
  fail "who authorised the refund is stored" "initiated_by was null"
fi

CODE=$(curl -sS -b /tmp/pay-admin.txt -o /tmp/pay-refund2.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/orders/${ORDER_ID}/refund" -H 'Content-Type: application/json' \
  -d "{\"amountPaise\":${TOTAL},\"reason\":\"Second refund\"}")
if [ "$CODE" = "400" ]; then
  pass "the refund CEILING is enforced on the SUM, not per refund"
else
  fail "the refund ceiling is enforced on the sum" "got HTTP $CODE"
fi

if [ "$(psql_q "select count(*) from refunds where order_id = '${ORDER_ID}'")" = "1" ]; then
  pass "the refused refund wrote nothing"
else
  fail "the refused refund wrote nothing" "$(psql_q "select count(*) from refunds where order_id = '${ORDER_ID}'")"
fi

# A COD order has no gateway payment to reverse.
curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/cart/items" \
  -H 'Content-Type: application/json' -d "{\"variantId\":\"${VARIANT}\",\"quantity\":6}" -o /dev/null
curl -sS -b /tmp/pay-jar.txt -X POST "${BASE}/api/v1/orders" \
  -H 'Content-Type: application/json' \
  -d "{\"idempotencyKey\":\"cod-$(date +%s%N)\",\"paymentMethod\":\"COD\"}" -o /tmp/pay-cod.json
COD_ORDER=$(jqv id < /tmp/pay-cod.json)

CODE=$(curl -sS -b /tmp/pay-admin.txt -o /tmp/pay-cod-refund.json -w '%{http_code}' -X POST \
  "${BASE}/api/v1/admin/orders/${COD_ORDER}/refund" -H 'Content-Type: application/json' \
  -d '{"amountPaise":5000,"reason":"Goodwill"}')

if [ "$CODE" = "201" ] && [ "$(jqv refundMode < /tmp/pay-cod-refund.json)" = "MANUAL_PAYOUT" ]; then
  pass "a COD refund is a MANUAL_PAYOUT, not a promise the gateway will pay"
else
  fail "a COD refund is a MANUAL_PAYOUT" "HTTP $CODE — $(head -c 300 /tmp/pay-cod-refund.json)"
fi

if [ "$(psql_q "select payment_id is null from refunds where order_id = '${COD_ORDER}'")" = "t" ]; then
  pass "the manual payout is NOT linked to a gateway payment that does not exist"
else
  fail "the manual payout is not linked to a gateway payment" "payment_id was set"
fi

# ---------------------------------------------------------------------------
# 9. Pages.
# ---------------------------------------------------------------------------
RETRY_ORDER=$(place_prepaid_order)

if curl -sS -b /tmp/pay-jar.txt "${BASE}/checkout/payment/${RETRY_ORDER}" | grep -q 'data-testid="payment-handoff"'; then
  pass "/checkout/payment/[id] renders the handoff on the server"
else
  fail "/checkout/payment/[id] renders the handoff" "no payment-handoff testid"
fi

if curl -sS -b /tmp/pay-jar.txt "${BASE}/orders/${RETRY_ORDER}" | grep -q 'data-testid="order-complete-payment"'; then
  pass "/orders/[id] offers the payment CTA on an unpaid order"
else
  fail "/orders/[id] offers the payment CTA" "CTA missing"
fi

if curl -sS -b /tmp/pay-jar.txt "${BASE}/orders/${ORDER_ID}" | grep -q 'data-testid="order-complete-payment"'; then
  fail "the payment CTA disappears once paid" "it is still rendered"
else
  pass "the payment CTA disappears once paid"
fi

# Asserted on CONTENT, not on the status code: these segments stream (there is a loading.tsx
# above them), so the 200 is committed before the page body runs and `redirect()`/`notFound()`
# can only take effect client-side. What matters is that no payment surface is rendered.
if curl -sS -b /tmp/pay-jar.txt "${BASE}/checkout/payment/${COD_ORDER}" | grep -q 'data-testid="payment-handoff"'; then
  fail "a COD order is sent away from the payment page" "the handoff was rendered for a cash order"
else
  pass "a COD order is sent away from the payment page"
fi

if curl -sS -b /tmp/pay-other.txt "${BASE}/checkout/payment/${RETRY_ORDER}" | grep -q 'data-testid="payment-handoff"'; then
  fail "another account cannot open someone else's payment page" "the handoff was rendered"
else
  pass "another account cannot open someone else's payment page"
fi

# ---------------------------------------------------------------------------
# 10. Diagnostics tell the truth about the gateway.
# ---------------------------------------------------------------------------
DIAG=$(curl -sS "${BASE}/api/v1/diagnostics/providers")
if echo "$DIAG" | grep -q '"active":"mock"' && echo "$DIAG" | grep -q '"webhookSecretPresent":true'; then
  pass "diagnostics report the active gateway and its capabilities"
else
  fail "diagnostics report the active gateway" "$(echo "$DIAG" | head -c 400)"
fi

if ! echo "$DIAG" | grep -qi 'rzp_\|key_secret'; then
  pass "diagnostics leak no key material"
else
  fail "diagnostics leak no key material" "found something key-shaped"
fi

echo
if [ "$failures" -ne 0 ]; then
  echo "❌ Payment flow: ${failures} failure(s)."
  echo "--- server log ---"
  tail -40 /tmp/pay-server.log
  exit 1
fi

echo "✅ Payment flow verified."
