#!/usr/bin/env bash
set -uo pipefail

# Post-deployment smoke test script for stellar-footprint-engine.
# Usage: ./scripts/smoke-test.sh <base-url>
# Optional env vars:
#   API_KEY          - X-API-Key header value if authentication is enabled
#   TIMEOUT_SECONDS  - cURL max-time per request in seconds (default: 15)

if [[ $# -lt 1 || -z "${1:-}" ]]; then
  echo "Usage: $0 <base-url>" >&2
  echo "Example: $0 https://staging.example.com" >&2
  exit 1
fi

RAW_URL="${1%/}"
if [[ "$RAW_URL" == */api/v1 ]]; then
  API_BASE="$RAW_URL"
else
  API_BASE="${RAW_URL}/api/v1"
fi

TIMEOUT="${TIMEOUT_SECONDS:-15}"
CURL_AUTH_ARGS=()
if [[ -n "${API_KEY:-}" ]]; then
  CURL_AUTH_ARGS=(-H "X-API-Key: ${API_KEY}")
fi

# Valid Testnet Soroban InvokeHostFunction XDR (from src/tests/fixtures/xdr.ts)
TESTNET_SIMULATE_XDR="AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg=="

PASSED=0
FAILED=0
ERRORS=()

run_get_check() {
  local name="$1"
  local path="$2"
  local url="${API_BASE}${path}"
  local response
  local status
  local body

  response=$(curl -sS --max-time "$TIMEOUT" -w "\n%{http_code}" "${CURL_AUTH_ARGS[@]}" "$url" 2>&1) || {
    local exit_code=$?
    FAILED=$((FAILED + 1))
    ERRORS+=("[$name] GET $url failed (curl exit $exit_code): $response")
    echo "FAIL: $name ($url) - curl error"
    return
  }

  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [[ "$status" == "200" && -n "$body" ]]; then
    PASSED=$((PASSED + 1))
    echo "PASS: $name ($url) -> HTTP $status"
  else
    FAILED=$((FAILED + 1))
    ERRORS+=("[$name] GET $url returned HTTP $status: ${body:0:200}")
    echo "FAIL: $name ($url) -> HTTP $status"
  fi
}

run_testnet_simulation() {
  local name="Testnet Simulation"
  local url="${API_BASE}/simulate"
  local payload
  payload=$(printf '{"xdr":"%s","network":"testnet"}' "$TESTNET_SIMULATE_XDR")
  local response
  local status
  local body

  response=$(curl -sS --max-time "$TIMEOUT" -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    "${CURL_AUTH_ARGS[@]}" \
    -d "$payload" \
    "$url" 2>&1) || {
    local exit_code=$?
    FAILED=$((FAILED + 1))
    ERRORS+=("[$name] POST $url failed (curl exit $exit_code): $response")
    echo "FAIL: $name ($url) - curl error"
    return
  }

  status=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [[ "$status" == "200" && -n "$body" ]]; then
    PASSED=$((PASSED + 1))
    echo "PASS: $name ($url) -> HTTP $status"
  else
    FAILED=$((FAILED + 1))
    ERRORS+=("[$name] POST $url returned HTTP $status: ${body:0:200}")
    echo "FAIL: $name ($url) -> HTTP $status"
  fi
}

echo "Running smoke tests against ${API_BASE} (timeout: ${TIMEOUT}s)..."

run_get_check "Liveness" "/health/live"
run_get_check "Readiness" "/health/ready"
run_get_check "Supported Networks" "/simulate/supported-networks"
run_get_check "OpenAPI Spec" "/openapi.json"
run_testnet_simulation

echo ""
echo "Smoke test results: ${PASSED} passed, ${FAILED} failed."

if [[ $FAILED -gt 0 ]]; then
  echo ""
  echo "Error summary:" >&2
  for err in "${ERRORS[@]}"; do
    echo "  - $err" >&2
  done
  exit 1
fi

exit 0
