import { logger } from "./logger";

/** Error codes considered transient network failures — safe to retry */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
]);

/**
 * HTTP status codes that signal a transient server-side condition and should
 * trigger a retry (potentially against a different provider).
 * 429 — Too Many Requests
 * 502 — Bad Gateway
 * 503 — Service Unavailable
 * 504 — Gateway Timeout
 */
export const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

/** Patterns in error messages that indicate a transient network issue */
const RETRYABLE_MESSAGE_PATTERNS = [
  /network.*timeout/i,
  /connection.*reset/i,
  /connection.*refused/i,
  /socket.*hang.*up/i,
  /econnreset/i,
  /etimedout/i,
];

/** Patterns that indicate simulation/validation errors — never retry these */
const NON_RETRYABLE_MESSAGE_PATTERNS = [
  /simulation.*error/i,
  /invalid.*xdr/i,
  /contract.*not.*found/i,
  /insufficient.*balance/i,
  /exceeded.*instructions/i,
  /exceeded.*memory/i,
  /host.*error/i,
  /wasm.*trap/i,
  /validation/i,
];

export function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const msg = err.message ?? "";
  const code = (err as NodeJS.ErrnoException).code ?? "";
  const status = (err as { status?: number }).status;

  // Never retry simulation/validation errors
  if (NON_RETRYABLE_MESSAGE_PATTERNS.some((p) => p.test(msg))) return false;

  // Retry on known error codes
  if (RETRYABLE_CODES.has(code)) return true;

  // Retry on retryable HTTP status codes (429, 502, 503, 504)
  if (typeof status === "number" && RETRYABLE_HTTP_STATUSES.has(status))
    return true;

  // Retry on known transient message patterns
  return RETRYABLE_MESSAGE_PATTERNS.some((p) => p.test(msg));
}

/**
 * Extract the back-off duration from a Retry-After header value.
 *
 * The header value may be:
 * - A number of seconds (e.g. "30")
 * - An HTTP-date string (e.g. "Wed, 21 Oct 2015 07:28:00 GMT")
 *
 * Returns the value in milliseconds, clamped to [0, 300_000] (5 minutes).
 * Returns `undefined` when the header is absent or unparseable.
 */
export function parseRetryAfterMs(
  retryAfter: string | undefined | null,
): number | undefined {
  if (!retryAfter) return undefined;

  // Try numeric seconds first
  const seconds = Number(retryAfter.trim());
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 300_000);
  }

  // Try HTTP-date
  const date = new Date(retryAfter);
  if (!isNaN(date.getTime())) {
    const ms = date.getTime() - Date.now();
    return Math.min(Math.max(ms, 0), 300_000);
  }

  return undefined;
}

const DEFAULT_MAX_RETRIES = 3;
const BASE_DELAY_MS = 100;

const parsedMaxRetries = parseInt(
  process.env.RPC_MAX_RETRIES ?? String(DEFAULT_MAX_RETRIES),
  10,
);
export const RPC_MAX_RETRIES = Number.isFinite(parsedMaxRetries)
  ? parsedMaxRetries
  : DEFAULT_MAX_RETRIES;

/**
 * Executes `fn` with exponential backoff retry for transient RPC errors.
 * Delays: 100ms, 200ms, 400ms (doubles each attempt).
 * Never retries simulation or validation errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context = "rpc",
  maxRetries = RPC_MAX_RETRIES,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= maxRetries || !isTransientError(err)) {
        throw err;
      }

      const delayMs = BASE_DELAY_MS * Math.pow(2, attempt);
      logger.warn(
        {
          context,
          attempt: attempt + 1,
          maxRetries,
          delayMs,
          error: (err as Error).message,
        },
        `Transient RPC error on attempt ${attempt + 1}/${maxRetries}, retrying in ${delayMs}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
