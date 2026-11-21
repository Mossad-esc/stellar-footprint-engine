# Error Handling Guide

This guide documents all error types, HTTP status codes, and error response shapes returned by the Stellar Footprint Service API. Use it to build robust retry and error-handling logic in your client.

## Response Envelope

All API responses — success and error — use the same top-level envelope:

```json
{
  "success": true | false,
  "data": { ... },   // present on success responses
  "error": "..."     // present on error responses
}
```

A few endpoints (notably `/simulate`, `/simulate/batch`, and `/estimate-fee`) return a flatter shape that omits the `success` wrapper; those are documented in the endpoint-specific sections below.

---

## HTTP Status Codes

### 200 OK

The request was accepted and processed successfully.

```json
{
  "success": true,
  "data": { ... }
}
```

---

### 400 Bad Request

The request is malformed or missing required fields. No simulation or external call was attempted.

**Common causes**

| Cause | Example message |
|---|---|
| `xdr` field absent from body | `"Missing required field: xdr"` |
| `xdr` is empty string or whitespace | `"Missing required field: xdr"` |
| `network` is not `testnet`, `mainnet`, or `futurenet` | `"Invalid network. Use 'testnet', 'mainnet', or 'futurenet'"` |
| Batch `transactions` array is missing or empty | `"Missing required field: transactions (must be a non-empty array)"` |
| Batch size exceeds 10 | `"Batch size exceeds maximum of 10 transactions"` |
| `cpuInsns` or `memBytes` are not integer strings | `"cpuInsns and memBytes must be non-negative integer strings"` |
| XDR decode `type` parameter is unsupported | `"Invalid type. Supported types: transaction, operation, ledger_key"` |
| XDR base64 cannot be parsed | `"Failed to decode XDR: ..."` |

**Example — missing XDR**

```http
POST /api/v1/simulate
Content-Type: application/json

{ "network": "testnet" }
```

```json
{
  "success": false,
  "error": "Missing required field: xdr"
}
```

**Example — invalid network**

```json
{
  "success": false,
  "error": "Invalid network. Use 'testnet', 'mainnet', or 'futurenet'"
}
```

---

### 401 Unauthorized

The service does not currently issue `401` responses. Authentication is not required for any public endpoint. If you receive a `401`, it is being emitted by an upstream proxy or API gateway.

---

### 422 Unprocessable Entity

The request was well-formed and passed validation, but processing failed. The XDR was parseable but the Stellar RPC rejected the simulation.

**Common causes**

| Cause | Example message |
|---|---|
| Contract execution panic or assertion failure | `"contract panic: assertion failed"` |
| Ledger entry expired — restore required before simulating | `"Transaction requires ledger entry restoration before simulation."` |
| RPC returned a simulation error | RPC error message forwarded verbatim |
| `transactionData` missing from a successful RPC response | `"Simulation succeeded but transactionData is missing; cannot extract footprint."` |

**Example — contract error**

```json
{
  "success": false,
  "error": "contract panic: assertion failed"
}
```

**Example — restoration required**

```json
{
  "success": false,
  "error": "Transaction requires ledger entry restoration before simulation."
}
```

When you receive this error from `/simulate`, call `POST /api/v1/restore` with the same XDR to obtain a restoration transaction. Submit and confirm that transaction on-chain, then retry `/simulate`.

For a complete walkthrough of TTLs, rent, and `LEDGER_ENTRY_RESTORATION_REQUIRED` recovery, see the [Soroban State Archival & Restoration Lifecycle Guide](./state-archival-and-restoration.md).

---

### 429 Too Many Requests

The client has exceeded the rate limit for the `/simulate` endpoint.

**Response headers**

| Header | Description |
|---|---|
| `RateLimit-Limit` | Maximum requests allowed in the window |
| `RateLimit-Remaining` | Requests remaining in the current window |
| `RateLimit-Reset` | Unix timestamp (seconds) when the window resets |
| `X-RateLimit-Limit` | Legacy alias for `RateLimit-Limit` |
| `X-RateLimit-Remaining` | Legacy alias for `RateLimit-Remaining` |
| `X-RateLimit-Reset` | Legacy alias for `RateLimit-Reset` |
| `Retry-After` | Seconds to wait before retrying |

**Example**

```json
{
  "error": "Too Many Requests",
  "message": "Rate limit exceeded. Try again in 60 seconds.",
  "retryAfter": 60
}
```

**Brute-force block (also 429)**

IPs that exceed the failure threshold (`BRUTE_FORCE_BLOCK_THRESHOLD`, default 20 failed requests per window) are temporarily blocked for `BRUTE_FORCE_BLOCK_MS` (default 5 minutes).

```json
{
  "error": "Too many failed requests. Try again later.",
  "retryAfter": 287
}
```

**Client guidance**: read the `Retry-After` header and back off for at least that many seconds before retrying. Do not hammer the endpoint — repeated violations reset the window and extend the block.

---

### 500 Internal Server Error

An unexpected error occurred inside the service. The request was valid, but processing failed due to an unhandled condition.

**Example**

```json
{
  "success": false,
  "error": "Unexpected error"
}
```

`500` responses are logged server-side with full stack traces. If you encounter a persistent `500`, open an issue with the request body (redact any secrets) and the approximate timestamp.

---

### 503 Service Unavailable

The RPC circuit breaker is open. The Stellar RPC endpoint has returned too many consecutive failures (`CB_FAILURE_THRESHOLD`, default 5) and the service has stopped forwarding traffic to protect itself and the RPC from further load.

**Response header**

| Header | Description |
|---|---|
| `Retry-After` | Seconds until the circuit breaker will attempt recovery |

**Example**

```json
{
  "success": false,
  "error": "RPC circuit breaker is open. Try again later."
}
```

The circuit breaker automatically attempts recovery after `CB_RECOVERY_MS` (default 30 seconds). A single probe request is sent; if it succeeds, the breaker closes and normal traffic resumes. Clients should honour `Retry-After` and not retry immediately.

---

## Error Field Reference

| Field | Type | Present on | Description |
|---|---|---|---|
| `success` | boolean | All responses | `false` for all errors |
| `error` | string | All error responses | Human-readable error message |
| `message` | string | 429 rate-limit only | Extended message with retry guidance |
| `retryAfter` | integer | 429 responses | Seconds to wait before retrying |

---

## Internationalization

Error messages are returned in the language requested via the `Accept-Language` header when a translation is available. Currently supported: `en` (default), `es`.

```http
GET /api/v1/health
Accept-Language: es
```

The `error` field in the response body will contain the translated message.

---

## Retry Recommendations

| Status | Retry? | Strategy |
|---|---|---|
| 400 | No | Fix the request — retrying without changes will produce the same error |
| 422 (contract error) | No | The contract rejected the transaction; investigate the XDR |
| 422 (restore required) | Yes, after restore | Call `/restore`, submit the restore transaction, then retry |
| 429 | Yes, after delay | Wait for `Retry-After` seconds |
| 500 | Yes, with backoff | Transient; retry with exponential backoff (3 attempts max) |
| 503 | Yes, after delay | Wait for `Retry-After` seconds |

---

## Related

- [Rate Limiting Strategy — ADR 003](../adr/003-rate-limiting.md)
- [OpenAPI Specification](../../openapi.yaml)
