#!/usr/bin/env bash
#
# Blocks committed credentials (docs/SECURITY.md §9.1, §12).
#
# Deliberately simple and dependency-free so it runs identically in CI and via a
# pre-commit hook. It is a guardrail, not a replacement for GitHub secret
# scanning — it catches the mistakes we are actually likely to make: committing a
# real .env, a service-account JSON, or a pasted private key.

set -euo pipefail

failed=0

fail() {
  echo "❌ $1" >&2
  failed=1
}

echo "Checking for committed secrets…"

# ---------------------------------------------------------------------------
# 1. Files that must never be tracked by git.
# ---------------------------------------------------------------------------
tracked_files=$(git ls-files)

while IFS= read -r file; do
  case "$file" in
    .env.example) ;;                                  # the template is expected
    .env|.env.*)                     fail "Environment file committed: $file" ;;
    *service-account*.json|*serviceaccount*.json) fail "Service-account key committed: $file" ;;
    *firebase-adminsdk*.json)        fail "Firebase admin key committed: $file" ;;
    *.pem|*.p12|*.pfx|*.key)         fail "Key/certificate committed: $file" ;;
    .dev.vars|.dev.vars.*)           fail "Wrangler dev vars committed: $file" ;;
  esac
done <<< "$tracked_files"

# ---------------------------------------------------------------------------
# 2. Credential-shaped content inside tracked source files.
# ---------------------------------------------------------------------------
scan_files=$(git ls-files -- \
  '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.json' '*.jsonc' '*.yml' '*.yaml' '*.sh' '*.md' \
  ':!:pnpm-lock.yaml' ':!:.env.example' ':!:scripts/check-secrets.sh' || true)

if [ -n "$scan_files" ]; then
  # PEM private keys.
  #
  # Matches the DER body rather than the BEGIN marker alone. Test fixtures and
  # documentation legitimately contain the marker with a stub body; a real key
  # always carries a long base64 run, so this keeps the check precise instead of
  # training people to ignore it.
  if echo "$scan_files" | xargs grep -lE 'MII[A-Za-z0-9+/=]{100,}' 2>/dev/null; then
    fail "PEM private key body found in tracked source (files listed above)"
  fi

  # Google API keys are a fixed, recognisable shape.
  if echo "$scan_files" | xargs grep -lE 'AIza[0-9A-Za-z_-]{35}' 2>/dev/null; then
    fail "Google API key found in tracked source (files listed above)"
  fi

  # Razorpay live/test key ids.
  if echo "$scan_files" | xargs grep -lE 'rzp_(live|test)_[0-9A-Za-z]{10,}' 2>/dev/null; then
    fail "Razorpay key id found in tracked source (files listed above)"
  fi

  # Service-account JSON fingerprint.
  if echo "$scan_files" | xargs grep -lE '"type"[[:space:]]*:[[:space:]]*"service_account"' 2>/dev/null; then
    fail "Service-account JSON content found in tracked source (files listed above)"
  fi
fi

if [ "$failed" -ne 0 ]; then
  echo "" >&2
  echo "Secret check FAILED. Remove the offending content and rotate anything exposed." >&2
  echo "Secrets belong in Cloudflare Worker secrets or GitHub Actions secrets." >&2
  exit 1
fi

echo "✅ No committed secrets detected."
