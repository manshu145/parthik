#!/usr/bin/env bash
#
# Runtime smoke verification without a browser.
#
# Boots the built application, exercises the routes the foundation is supposed to
# serve, then shuts down. Used to satisfy the TASK 001 verification steps for
# local startup, i18n (en + hi) and safe degradation when Firebase is absent.
#
# Usage: bash scripts/verify-runtime.sh [port]

set -uo pipefail

PORT="${1:-3111}"
BASE="http://127.0.0.1:${PORT}"
LOG=$(mktemp)
failures=0

check() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    printf '  ✅ %-52s %s\n' "$label" "$actual"
  else
    printf '  ❌ %-52s got %s, expected %s\n' "$label" "$actual" "$expected"
    failures=$((failures + 1))
  fi
}

contains() {
  local label="$1" needle="$2" haystack="$3"
  if printf '%s' "$haystack" | grep -q "$needle"; then
    printf '  ✅ %s\n' "$label"
  else
    printf '  ❌ %s (missing: %s)\n' "$label" "$needle"
    failures=$((failures + 1))
  fi
}

echo "Starting server on port ${PORT}…"
APP_ENV=development PORT="$PORT" node_modules/.bin/next start --port "$PORT" > "$LOG" 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

# Wait for readiness rather than sleeping a fixed amount.
ready=0
for _ in $(seq 1 40); do
  if curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" -ne 1 ]; then
  echo "❌ Server failed to become ready. Output:"
  cat "$LOG"
  exit 1
fi

echo "✅ Server started"
echo ""

status() { curl -s -o /dev/null -w '%{http_code}' "$1"; }

echo "Routes:"
check "GET /  (English)"                    200 "$(status "${BASE}/")"
check "GET /hi  (Hindi)"                    200 "$(status "${BASE}/hi")"
check "GET /login  (placeholder)"           200 "$(status "${BASE}/login")"
check "GET /unknown-route  -> 404"          404 "$(status "${BASE}/unknown-route")"
check "GET /fr  (unsupported locale) -> 404" 404 "$(status "${BASE}/fr")"

echo ""
echo "SEO and PWA:"
check "GET /robots.txt"                     200 "$(status "${BASE}/robots.txt")"
check "GET /sitemap.xml"                     200 "$(status "${BASE}/sitemap.xml")"
check "GET /manifest.webmanifest"            200 "$(status "${BASE}/manifest.webmanifest")"
contains "sitemap advertises hreflang alternates" "hreflang" "$(curl -fsS "${BASE}/sitemap.xml")"
# Outside production the whole site is disallowed, which is stronger than listing
# individual private prefixes. The production ruleset is asserted in unit tests.
contains "robots.txt blocks indexing outside production" "Disallow: /" "$(curl -fsS "${BASE}/robots.txt")"

echo ""
echo "i18n (D-33):"
html_en=$(curl -fsS "${BASE}/")
html_hi=$(curl -fsS "${BASE}/hi")
contains "English page declares lang=\"en-IN\"" 'lang="en-IN"' "$html_en"
contains "Hindi page declares lang=\"hi-IN\""   'lang="hi-IN"'  "$html_hi"
contains "English page renders English copy"    'Parthik'       "$html_en"
# Devanagari must actually be present, not English fallback.
if printf '%s' "$html_hi" | grep -qP '[\x{0900}-\x{097F}]'; then
  echo "  ✅ Hindi page renders Devanagari content"
else
  echo "  ❌ Hindi page renders no Devanagari content"
  failures=$((failures + 1))
fi

echo ""
echo "Health and safe degradation (no credentials configured):"
check "GET /api/v1/health"       200 "$(status "${BASE}/api/v1/health")"
# 200 even with zero provider credentials: optional providers are not required.
check "GET /api/v1/health/deep"  200 "$(status "${BASE}/api/v1/health/deep")"
deep=$(curl -fsS "${BASE}/api/v1/health/deep")
contains "reports firebase-auth-client"        'firebase-auth-client'  "$deep"
contains "firebase reported not_configured"    'not_configured'        "$deep"
contains "reports google-maps"                 'google-maps'           "$deep"
contains "email documented as BLOCKED (D-25)"  'BLOCKED by D-25'       "$deep"
contains "sms documented as BLOCKED (D-34)"    'BLOCKED by D-34'       "$deep"
contains "overall status is ok"                '"status":"ok"'         "$deep"

echo ""
echo "Security headers (docs/SECURITY.md §9.5):"
headers=$(curl -fsS -D - -o /dev/null "${BASE}/")
contains "X-Content-Type-Options: nosniff"     'nosniff'                            "$headers"
contains "Referrer-Policy set"                 'strict-origin-when-cross-origin'    "$headers"
contains "CSP present (report-only)"           'content-security-policy-report-only' "$(printf '%s' "$headers" | tr 'A-Z' 'a-z')"
contains "Permissions-Policy set"              'geolocation=(self)'                 "$headers"
contains "X-Request-Id echoed"                 'x-request-id'                        "$(printf '%s' "$headers" | tr 'A-Z' 'a-z')"
# Non-production deployments must never be indexable.
contains "X-Robots-Tag noindex outside production" 'noindex'                        "$(printf '%s' "$headers" | tr 'A-Z' 'a-z')"

echo ""
echo "Coarse auth gate (docs/ROUTES.md §10):"
redirect=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "${BASE}/account")
printf '  → /account responds: %s\n' "$redirect"
contains "unauthenticated /account redirects to /login" '/login' "$redirect"
redirect_hi=$(curl -s -o /dev/null -w '%{redirect_url}' "${BASE}/hi/account")
printf '  → /hi/account redirects to: %s\n' "$redirect_hi"
contains "Hindi private route redirects to /hi/login" '/hi/login' "$redirect_hi"

echo ""
if [ "$failures" -eq 0 ]; then
  echo "✅ Runtime verification passed."
  exit 0
fi

echo "❌ Runtime verification failed with ${failures} problem(s)."
echo "--- server output ---"
cat "$LOG"
exit 1
