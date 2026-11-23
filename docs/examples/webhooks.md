# Webhook Callbacks

When a simulation completes asynchronously, results are delivered to the client's registered webhook URL via an HTTP `POST` request. Every outgoing webhook is signed so that clients can verify the payload originated from our service and was not tampered with in transit.

## Signature Header

Each webhook request includes the following header:

```
X-Signature-SHA256: t=<timestamp>,v1=<signature>
```

- **`t`** — Unix timestamp (in seconds) of when the request was signed.
- **`v1`** — Hex-encoded HMAC-SHA256 signature.

The signature is computed over the string `"<timestamp>.<raw_request_body>"` using the shared `WEBHOOK_SECRET` as the HMAC key:

```
signed_payload = t + "." + raw_body
signature      = HMAC_SHA256(WEBHOOK_SECRET, signed_payload)
```

This follows the same timestamped HMAC scheme used by Stripe and GitHub webhooks.

## Timestamp Tolerance

To protect against replay attacks, reject requests whose timestamp (`t`) is too far from the current time. A tolerance of **5 minutes (300 seconds)** is recommended. Always compare the timestamp against your own server clock, not the client's.

## Verification Steps

1. Read the raw request body **before** any JSON parsing or middleware mutates it.
2. Parse the `X-Signature-SHA256` header to extract `t` and `v1`.
3. Reject the request if `t` is outside the tolerance window.
4. Recompute the expected signature over `"<t>.<raw_body>"` using your `WEBHOOK_SECRET`.
5. Compare the expected signature with `v1` using a **constant-time comparison** to avoid timing attacks.

> **Note:** The `WEBHOOK_SECRET` must never be exposed in client-side code. Perform verification on your server only.

## JavaScript (Node.js) Example

```js
const crypto = require('crypto');

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 300;

/**
 * Verify an incoming webhook signature.
 * @param {string} rawBody - The raw request body as a string (do NOT parse first).
 * @param {string} signatureHeader - Value of the X-Signature-SHA256 header.
 * @returns {boolean} true if the signature is valid and fresh.
 */
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!signatureHeader) return false;

  // Parse "t=<timestamp>,v1=<signature>"
  const parts = {};
  for (const segment of signatureHeader.split(',')) {
    const idx = segment.indexOf('=');
    if (idx === -1) continue;
    const key = segment.slice(0, idx).trim();
    const value = segment.slice(idx + 1).trim();
    parts[key] = value;
  }

  const timestamp = parts.t;
  const providedSignature = parts.v1;
  if (!timestamp || !providedSignature) return false;

  // Reject stale timestamps (replay protection).
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(timestamp)) > TOLERANCE_SECONDS) {
    return false;
  }

  // Recompute the expected signature.
  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedSignature = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(signedPayload, 'utf8')
    .digest('hex');

  // Constant-time comparison.
  const expected = Buffer.from(expectedSignature, 'utf8');
  const provided = Buffer.from(providedSignature, 'utf8');
  if (expected.length !== provided.length) return false;
  return crypto.timingSafeEqual(expected, provided);
}

// Example usage with Express (raw body required):
// app.post('/webhooks/simulation', express.raw({ type: '*/*' }), (req, res) => {
//   const rawBody = req.body.toString('utf8');
//   const header = req.get('X-Signature-SHA256');
//   if (!verifyWebhookSignature(rawBody, header)) {
//     return res.status(400).send('Invalid signature');
//   }
//   const payload = JSON.parse(rawBody);
//   // ... handle payload ...
//   res.status(200).send('OK');
// });
```

## Python Example

```python
import hashlib
import hmac
import os
import time

WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"].encode("utf-8")
TOLERANCE_SECONDS = 300


def verify_webhook_signature(raw_body: bytes, signature_header: str) -> bool:
    """Verify an incoming webhook signature.

    :param raw_body: The raw request body as bytes (do NOT parse first).
    :param signature_header: Value of the X-Signature-SHA256 header.
    :return: True if the signature is valid and fresh.
    """
    if not signature_header:
        return False

    # Parse "t=<timestamp>,v1=<signature>"
    parts = {}
    for segment in signature_header.split(","):
        if "=" not in segment:
            continue
        key, value = segment.split("=", 1)
        parts[key.strip()] = value.strip()

    timestamp = parts.get("t")
    provided_signature = parts.get("v1")
    if not timestamp or not provided_signature:
        return False

    # Reject stale timestamps (replay protection).
    now = int(time.time())
    try:
        if abs(now - int(timestamp)) > TOLERANCE_SECONDS:
            return False
    except ValueError:
        return False

    # Recompute the expected signature.
    signed_payload = f"{timestamp}.".encode("utf-8") + raw_body
    expected_signature = hmac.new(
        WEBHOOK_SECRET, signed_payload, hashlib.sha256
    ).hexdigest()

    # Constant-time comparison.
    return hmac.compare_digest(expected_signature, provided_signature)


# Example usage with Flask:
# @app.route("/webhooks/simulation", methods=["POST"])
# def handle_webhook():
#     raw_body = request.get_data()  # raw bytes
#     header = request.headers.get("X-Signature-SHA256", "")
#     if not verify_webhook_signature(raw_body, header):
#         return "Invalid signature", 400
#     payload = json.loads(raw_body)
#     # ... handle payload ...
#     return "OK", 200
```

## Best Practices

- **Always verify against the raw body.** Parsing and re-serializing JSON can change whitespace and key ordering, invalidating the signature.
- **Use constant-time comparison.** `crypto.timingSafeEqual` (Node.js) and `hmac.compare_digest` (Python) prevent timing side-channel attacks.
- **Enforce the timestamp tolerance** to mitigate replay attacks.
- **Store the secret securely** (e.g., environment variables or a secrets manager) and rotate it periodically.
- **Respond quickly** with a `2xx` status to acknowledge receipt; process heavy work asynchronously.