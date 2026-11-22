import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

/**
 * #342 — HMAC-SHA256 signature verification middleware for inbound webhook routes.
 *
 * Expects the caller to send the signature in the `X-Webhook-Signature` header
 * as `sha256=<hex-digest>`. The shared secret is read from the
 * `WEBHOOK_VERIFY_SECRET` environment variable.
 *
 * Returns 401 if the header is missing, the secret is not configured, or the
 * signature does not match.
 */
export const WEBHOOK_SIGNATURE_HEADER = "x-webhook-signature";

/**
 * Header used for timestamped HMAC-SHA256 signatures on outgoing webhooks.
 * Format: `t=<unix-seconds>,v1=<hex-hmac-sha256>`.
 */
export const SIGNATURE_SHA256_HEADER = "x-signature-sha256";

/** Default tolerance (in seconds) for timestamped signature verification. */
export const DEFAULT_SIGNATURE_TOLERANCE_SECONDS = 300;

export interface VerifyWebhookSignatureOptions {
  /** Maximum allowed age of the timestamp, in seconds. Defaults to 300. */
  toleranceSeconds?: number;
  /** Current time in seconds since epoch. Defaults to `Date.now() / 1000`. */
  now?: number;
}

/**
 * Computes the timestamped HMAC-SHA256 signature for a payload.
 *
 * The signed message is `${timestamp}.${payload}`, matching the
 * Stripe/GitHub webhook signature convention.
 */
export function computeWebhookSignature(
  payload: string | Buffer,
  secret: string,
  timestamp: number,
): string {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(payload)
    .digest("hex");
}

/**
 * Parses a `t=<timestamp>,v1=<signature>` header value.
 * Returns `null` when the header is malformed.
 */
export function parseSignatureHeader(
  header: string,
): { timestamp: number; signature: string } | null {
  let timestamp: number | undefined;
  let signature: string | undefined;

  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;

    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();

    if (key === "t") {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      timestamp = parsed;
    } else if (key === "v1") {
      signature = value;
    }
  }

  if (timestamp === undefined || !signature) return null;

  return { timestamp, signature };
}

/**
 * Verifies a timestamped HMAC-SHA256 webhook signature using constant-time
 * comparison.
 *
 * Returns `true` only when the header is well-formed, the timestamp is within
 * the allowed tolerance, and the recomputed signature matches.
 */
export function verifyWebhookSignature(
  payload: string | Buffer,
  header: string | undefined | null,
  secret: string,
  options: VerifyWebhookSignatureOptions = {},
): boolean {
  if (!header || !secret) return false;

  const parsed = parseSignatureHeader(header);
  if (!parsed) return false;

  const tolerance =
    options.toleranceSeconds ?? DEFAULT_SIGNATURE_TOLERANCE_SECONDS;
  const now = options.now ?? Math.floor(Date.now() / 1000);

  if (Math.abs(now - parsed.timestamp) > tolerance) return false;

  const expected = computeWebhookSignature(payload, secret, parsed.timestamp);

  const sigBuffer = Buffer.from(parsed.signature, "utf8");
  const expBuffer = Buffer.from(expected, "utf8");

  if (sigBuffer.length !== expBuffer.length) return false;

  return crypto.timingSafeEqual(sigBuffer, expBuffer);
}

export function hmacVerify(
=======
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.WEBHOOK_VERIFY_SECRET;

  if (!secret) {
    res.status(401).json({ error: "Webhook secret not configured" });
    return;
  }

  const signature = req.headers[WEBHOOK_SIGNATURE_HEADER] as string | undefined;

  if (!signature) {
    res.status(401).json({ error: "Missing webhook signature" });
    return;
  }

  const rawBody: Buffer =
    (req as Request & { rawBody?: Buffer }).rawBody ??
    Buffer.from(JSON.stringify(req.body));

  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;

  const sigBuffer = Buffer.from(signature);
  const expBuffer = Buffer.from(expected);

  if (
    sigBuffer.length !== expBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, expBuffer)
  ) {
    res.status(401).json({ error: "Invalid webhook signature" });
    return;
  }

  next();
}
