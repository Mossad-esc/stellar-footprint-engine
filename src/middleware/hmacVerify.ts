import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

import { redisClient } from "../services/cache";

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
 * #86 — Replay attack prevention.
 *
 * Signed requests must also carry a Unix timestamp (seconds) and a unique
 * nonce. Timestamps older than `MAX_TIMESTAMP_DRIFT_SECONDS` are rejected, and
 * nonces are stored in Redis with a TTL so that a replayed request is blocked.
 */
export const REQUEST_TIMESTAMP_HEADER = "x-request-timestamp";
export const REQUEST_NONCE_HEADER = "x-request-nonce";

export const MAX_TIMESTAMP_DRIFT_SECONDS = 300;
export const NONCE_TTL_SECONDS = 600;
export const NONCE_KEY_PREFIX = "nonce:";

/**
 * Verify a `t=<unix_seconds>,v1=<hex_hmac>` webhook signature header.
 */
export function verifySignature(
  payload: string,
  header: string,
  secret: string,
  toleranceSeconds: number = MAX_TIMESTAMP_DRIFT_SECONDS,
): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",");
  let timestampStr: string | undefined;
  let sigHex: string | undefined;
  for (const part of parts) {
    const [k, v] = part.split("=");
    if (k === "t") timestampStr = v;
    else if (k === "v1") sigHex = v;
  }
  if (!timestampStr || !sigHex) return false;
  const timestamp = Number(timestampStr);
  if (!Number.isFinite(timestamp)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestamp) > toleranceSeconds) return false;

  const expectedHex = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const sigBuf = Buffer.from(sigHex, "utf8");
  const expBuf = Buffer.from(expectedHex, "utf8");
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function hmacVerify(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
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

  const timestampHeader = req.headers[REQUEST_TIMESTAMP_HEADER] as
    | string
    | undefined;
  const nonce = req.headers[REQUEST_NONCE_HEADER] as string | undefined;

  if (!timestampHeader) {
    res.status(401).json({ error: "Missing x-request-timestamp header" });
    return;
  }

  if (!nonce) {
    res.status(401).json({ error: "Missing x-request-nonce header" });
    return;
  }

  const timestamp = Number(timestampHeader);

  if (!Number.isFinite(timestamp) || !Number.isInteger(timestamp)) {
    res.status(401).json({ error: "Invalid request timestamp" });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1000);

  if (Math.abs(nowSeconds - timestamp) > MAX_TIMESTAMP_DRIFT_SECONDS) {
    res.status(401).json({ error: "Request timestamp expired" });
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

  try {
    const result = await redisClient.set(
      `${NONCE_KEY_PREFIX}${nonce}`,
      "1",
      "EX",
      NONCE_TTL_SECONDS,
      "NX",
    );

    if (result === null) {
      res.status(401).json({ error: "Replay detected: nonce already used" });
      return;
    }
  } catch {
    res.status(503).json({ error: "Unable to verify request nonce" });
    return;
  }

  next();
}
