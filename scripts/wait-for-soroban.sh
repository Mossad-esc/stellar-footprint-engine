#!/usr/bin/env bash
set -euo pipefail

SOROBAN_RPC_URL="${SOROBAN_RPC_URL:-http://localhost:8000/soroban/rpc}"
TIMEOUT_SECONDS="${TIMEOUT_SECONDS:-120}"
POLL_INTERVAL="${POLL_INTERVAL:-2}"

echo "Waiting for Soroban RPC at ${SOROBAN_RPC_URL} (timeout: ${TIMEOUT_SECONDS}s)..."

elapsed=0
while [ "${elapsed}" -lt "${TIMEOUT_SECONDS}" ]; do
  response=$(
    curl -sS --max-time 3 -X POST \
      -H "Content-Type: application/json" \
      -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' \
      "${SOROBAN_RPC_URL}" 2>/dev/null || true
  )

  if echo "${response}" | grep -q '"status"[[:space:]]*:[[:space:]]*"healthy"'; then
    echo "Soroban RPC is healthy after ${elapsed}s."
    exit 0
  fi

  sleep "${POLL_INTERVAL}"
  elapsed=$((elapsed + POLL_INTERVAL))
done

echo "Timed out after ${TIMEOUT_SECONDS}s waiting for Soroban RPC at ${SOROBAN_RPC_URL}." >&2
exit 1
