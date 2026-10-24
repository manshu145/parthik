#!/usr/bin/env bash
#
# Runs the Playwright suite against the production build.
#
# Starts the server, waits for readiness, runs the tests, then shuts the server
# down — so it completes rather than leaving a process behind.
#
# Usage: bash scripts/run-e2e.sh [port] [-- extra playwright args]

set -uo pipefail

PORT="${1:-3200}"
shift || true
BASE="http://127.0.0.1:${PORT}"
LOG=$(mktemp)

if [ ! -d .next ]; then
  echo "No production build found. Run \`pnpm build\` first." >&2
  exit 1
fi

echo "Starting server on port ${PORT}…"
#
# DEV_AUTH_ENABLED and AUTH_SECRET are required for the authenticated journeys
# (tests/e2e/helpers/auth.ts). Privileged routes are gated in every environment, so
# without a way to obtain a real session the dashboard suite could only ever assert
# redirects to the login page.
#
# The secret is throwaway and local to this process. It is never a default anywhere in
# the application: lib/config/env.ts deliberately has no fallback, precisely so a
# development value cannot reach production.
#
APP_ENV=development \
DEV_AUTH_ENABLED=true \
AUTH_SECRET="${AUTH_SECRET:-e2e-only-throwaway-secret-not-used-in-any-deployment}" \
  node_modules/.bin/next start --port "$PORT" > "$LOG" 2>&1 &
server_pid=$!

cleanup() {
  kill "$server_pid" 2>/dev/null || true
  wait "$server_pid" 2>/dev/null || true
  rm -f "$LOG"
}
trap cleanup EXIT

for _ in $(seq 1 45); do
  if curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
    break
  fi
  sleep 1
done

if ! curl -fsS -o /dev/null "${BASE}/api/v1/health" 2>/dev/null; then
  echo "❌ Server failed to become ready:" >&2
  cat "$LOG" >&2
  exit 1
fi

echo "✅ Server ready"
echo ""

# E2E_BASE_URL tells playwright.config.ts not to start its own webServer.
E2E_BASE_URL="$BASE" npx playwright test "$@"
status=$?

if [ "$status" -ne 0 ]; then
  echo ""
  echo "--- server output ---" >&2
  tail -40 "$LOG" >&2
fi

exit "$status"
