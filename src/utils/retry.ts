import { logger } from "./logger";

/** Error codes considered transient network failures — safe to retry */
const RETRYABLE_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ENETUNREACH",
]);

/** HTTP status codes that indicate a transient server-side condition */
export const RETRYABLE_HTTP_STATUSES = new Set([429, 502, 503, 504]);

/**
 * Parse an HTTP Retry-After header value (seconds or HTTP-date) into ms.
 * Returns null when absent or unparseable.
 */
export function parseRetryAfterMs(
  retryAfter: string | number | null | undefined,
): number | undefined {
  if (retryAfter === null || retryAfter === undefined) return undefined;
  if (typeof retryAfter === "number") {
    return Number.isFinite(retryAfter) && retryAfter >= 0
      ? Math.min(300_000, retryAfter * 1000)
      : undefined;
  }
  const trimmed = String(retryAfter).trim();
  if (!trimmed) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(300_000, seconds * 1000);
  }
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    return Math.min(300_000, Math.max(0, dateMs - Date.now()));
  }
  return undefined;
}

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

  // Retry on retryable HTTP status codes
  if (typeof status === "number" && RETRYABLE_HTTP_STATUSES.has(status))
    return true;

  // Retry on known transient message patterns
  return RETRYABLE_MESSAGE_PATTERNS.some((p) => p.test(msg));
}

// ---------------------------------------------------------------------------
// Full-Jitter Exponential Backoff (AWS Architecture standard)
// sleep = random_between(0, min(cap, base * factor ** attempt))
// ---------------------------------------------------------------------------

export interface RetryOptions {
  /** Maximum number of retry attempts (not counting the initial call). Default: 3 */
  maxRetries?: number;
  /** Base delay in milliseconds. Default: 100 */
  initialDelayMs?: number;
  /** Upper bound on the computed delay (the "cap"). Default: 30 000 */
  maxDelayMs?: number;
  /** Exponential growth factor applied per attempt. Default: 2 */
  factor?: number;
  /**
   * Predicate that decides whether a given error is worth retrying.
   * Defaults to `isTransientError`.
   */
  isRetryable?: (err: unknown) => boolean;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_INITIAL_DELAY_MS = 100;
const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_FACTOR = 2;

const parsedMaxRetries = parseInt(
  process.env.RPC_MAX_RETRIES ?? String(DEFAULT_MAX_RETRIES),
  10,
);
export const RPC_MAX_RETRIES = Number.isFinite(parsedMaxRetries)
  ? parsedMaxRetries
  : DEFAULT_MAX_RETRIES;

/**
 * Compute the full-jitter sleep duration for a given attempt.
 * Returns a value uniformly distributed in [0, min(cap, base * factor^attempt)].
 */
export function fullJitterDelay(
  attempt: number,
  initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_DELAY_MS,
  factor = DEFAULT_FACTOR,
): number {
  const cap = Math.min(maxDelayMs, initialDelayMs * Math.pow(factor, attempt));
  return Math.random() * cap;
}

/**
 * Executes `fn` with Full-Jitter exponential backoff for transient RPC errors.
 *
 * Sleep between retries:
 *   sleep = random_between(0, min(maxDelayMs, initialDelayMs * factor ** attempt))
 *
 * Never retries simulation or validation errors (governed by `isRetryable`).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  context = "rpc",
  maxRetries = RPC_MAX_RETRIES,
  options: RetryOptions = {},
): Promise<T> {
  const {
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    factor = DEFAULT_FACTOR,
    isRetryable = isTransientError,
  } = options;

  // maxRetries can also come from options; the positional param takes precedence
  // to preserve backward-compatible call sites that pass it directly.
  const resolvedMaxRetries = options.maxRetries ?? maxRetries;

  let lastError: unknown;

  for (let attempt = 0; attempt <= resolvedMaxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (attempt >= resolvedMaxRetries || !isRetryable(err)) {
        throw err;
      }

      const delayMs = fullJitterDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        factor,
      );
      logger.warn(
        {
          context,
          attempt: attempt + 1,
          maxRetries: resolvedMaxRetries,
          delayMs: Math.round(delayMs),
          error: (err as Error).message,
        },
        `Transient RPC error on attempt ${attempt + 1}/${resolvedMaxRetries}, retrying in ${Math.round(delayMs)}ms`,
      );

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}
