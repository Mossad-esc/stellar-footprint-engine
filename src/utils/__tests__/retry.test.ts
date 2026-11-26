import {
  withRetry,
  isTransientError,
  fullJitterDelay,
  parseRetryAfterMs,
  RETRYABLE_HTTP_STATUSES,
  RetryOptions,
} from "../retry";

// Mock the logger to suppress output during tests
jest.mock("../logger", () => ({
  logger: { warn: jest.fn(), debug: jest.fn() },
}));

// Speed up tests by mocking setTimeout
jest.useFakeTimers();

// ---------------------------------------------------------------------------
// isTransientError
// ---------------------------------------------------------------------------

describe("isTransientError", () => {
  it("returns true for ECONNRESET", () => {
    const err = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for ETIMEDOUT", () => {
    const err = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for ECONNREFUSED", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), {
      code: "ECONNREFUSED",
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for ENOTFOUND", () => {
    const err = Object.assign(new Error("getaddrinfo ENOTFOUND"), {
      code: "ENOTFOUND",
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for ENETUNREACH", () => {
    const err = Object.assign(new Error("connect ENETUNREACH"), {
      code: "ENETUNREACH",
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for HTTP 503 status", () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for network timeout message", () => {
    expect(isTransientError(new Error("network timeout occurred"))).toBe(true);
  });

  it("returns true for socket hang up", () => {
    expect(isTransientError(new Error("socket hang up"))).toBe(true);
  });

  it("returns false for simulation errors", () => {
    expect(
      isTransientError(new Error("simulation error: contract failed")),
    ).toBe(false);
  });

  it("returns false for invalid XDR", () => {
    expect(isTransientError(new Error("invalid xdr provided"))).toBe(false);
  });

  it("returns false for validation errors", () => {
    expect(isTransientError(new Error("validation failed"))).toBe(false);
  });

  it("returns false for wasm trap", () => {
    expect(isTransientError(new Error("wasm trap: unreachable"))).toBe(false);
  });

  it("returns false for host error", () => {
    expect(isTransientError(new Error("host error: out of budget"))).toBe(
      false,
    );
  });

  it("returns false for non-Error values", () => {
    expect(isTransientError("string error")).toBe(false);
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(42)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// fullJitterDelay
// ---------------------------------------------------------------------------

describe("fullJitterDelay", () => {
  it("always returns a non-negative value", () => {
    for (let attempt = 0; attempt < 10; attempt++) {
      expect(fullJitterDelay(attempt)).toBeGreaterThanOrEqual(0);
    }
  });

  it("never exceeds the computed cap", () => {
    // cap = min(maxDelayMs, initialDelayMs * factor^attempt)
    const initialDelayMs = 100;
    const maxDelayMs = 30_000;
    const factor = 2;

    for (let attempt = 0; attempt < 15; attempt++) {
      const delay = fullJitterDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        factor,
      );
      const expectedCap = Math.min(
        maxDelayMs,
        initialDelayMs * Math.pow(factor, attempt),
      );
      expect(delay).toBeLessThanOrEqual(expectedCap);
    }
  });

  it("respects maxDelayMs as an upper bound on the cap", () => {
    const maxDelayMs = 500;
    for (let attempt = 0; attempt < 20; attempt++) {
      expect(fullJitterDelay(attempt, 100, maxDelayMs, 2)).toBeLessThanOrEqual(
        maxDelayMs,
      );
    }
  });

  it("produces a spread of values across the full [0, cap] range (randomness check)", () => {
    // Run 1000 samples at attempt=5 and assert that we see both small (<25% of cap)
    // and large (>75% of cap) values — confirming jitter spans the whole interval.
    const initialDelayMs = 100;
    const maxDelayMs = 30_000;
    const factor = 2;
    const attempt = 5;
    const cap = Math.min(
      maxDelayMs,
      initialDelayMs * Math.pow(factor, attempt),
    );

    const samples = Array.from({ length: 1000 }, () =>
      fullJitterDelay(attempt, initialDelayMs, maxDelayMs, factor),
    );

    const smallCount = samples.filter((d) => d < cap * 0.25).length;
    const largeCount = samples.filter((d) => d > cap * 0.75).length;

    // With 1000 uniform samples the probability of seeing <10 in either
    // quartile is astronomically low.
    expect(smallCount).toBeGreaterThan(10);
    expect(largeCount).toBeGreaterThan(10);
  });

  it("scales with the factor parameter", () => {
    // cap at attempt=3 with factor=2  = 100 * 8  = 800
    // cap at attempt=3 with factor=4  = 100 * 64 = 6400 (capped at maxDelayMs)
    // The average of uniform(0, cap) is cap/2 so a larger factor produces a
    // larger mean. We verify this statistically with enough samples.
    const samples = (factor: number) =>
      Array.from({ length: 500 }, () =>
        fullJitterDelay(3, 100, 30_000, factor),
      );

    const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;

    expect(mean(samples(4))).toBeGreaterThan(mean(samples(2)));
  });

  it("uses default parameters when called with only attempt", () => {
    // Default: initialDelayMs=100, maxDelayMs=30000, factor=2
    // cap at attempt=0 = min(30000, 100 * 1) = 100
    for (let i = 0; i < 50; i++) {
      const delay = fullJitterDelay(0);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(100);
    }
  });
});

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

describe("withRetry", () => {
  it("returns result immediately on success", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const promise = withRetry(fn, "test", 3);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries on transient error and succeeds on third attempt", async () => {
    const transientErr = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    const fn = jest
      .fn()
      .mockRejectedValueOnce(transientErr)
      .mockRejectedValueOnce(transientErr)
      .mockResolvedValue("success");

    const promise = withRetry(fn, "test", 3);
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe("success");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry on simulation errors", async () => {
    const simErr = new Error("simulation error: wasm trap");
    const fn = jest.fn().mockRejectedValue(simErr);

    await expect(withRetry(fn, "test", 3)).rejects.toThrow(
      "simulation error: wasm trap",
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("exhausts retries and throws last error", async () => {
    const transientErr = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    const fn = jest.fn().mockRejectedValue(transientErr);

    const [result] = await Promise.all([
      expect(withRetry(fn, "test", 3)).rejects.toThrow("connect ETIMEDOUT"),
      jest.runAllTimersAsync(),
    ]);
    void result;
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
  });

  it("respects maxRetries=0 (no retries)", async () => {
    const transientErr = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    const fn = jest.fn().mockRejectedValue(transientErr);

    await expect(withRetry(fn, "test", 0)).rejects.toThrow("read ECONNRESET");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("accepts options.maxRetries overriding the positional param", async () => {
    const transientErr = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    const fn = jest.fn().mockRejectedValue(transientErr);

    const options: RetryOptions = { maxRetries: 1 };
    const [result] = await Promise.all([
      expect(withRetry(fn, "test", 5, options)).rejects.toThrow(),
      jest.runAllTimersAsync(),
    ]);
    void result;
    // maxRetries=1 → initial call + 1 retry = 2 total
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("honours a custom isRetryable predicate", async () => {
    // A predicate that retries only on a custom error type
    const customErr = Object.assign(new Error("custom retryable"), {
      retryable: true,
    });
    const nonCustomErr = new Error("not retryable");

    const isRetryable = (err: unknown): boolean =>
      err instanceof Error &&
      (err as { retryable?: boolean }).retryable === true;

    const fn = jest
      .fn()
      .mockRejectedValueOnce(customErr)
      .mockResolvedValue("done");

    const promise = withRetry(fn, "test", 3, { isRetryable });
    await jest.runAllTimersAsync();
    await expect(promise).resolves.toBe("done");
    expect(fn).toHaveBeenCalledTimes(2);

    // non-retryable should not be retried
    const fn2 = jest.fn().mockRejectedValue(nonCustomErr);
    await expect(withRetry(fn2, "test", 3, { isRetryable })).rejects.toThrow(
      "not retryable",
    );
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  it("delay stays within [0, maxDelayMs] across all attempts", async () => {
    // We instrument setTimeout to capture the actual delays used
    const delays: number[] = [];
    const realSetTimeout = global.setTimeout;
    jest
      .spyOn(global, "setTimeout")
      .mockImplementation(
        (fn: TimerHandler, ms?: number, ...args: unknown[]) => {
          if (typeof ms === "number") delays.push(ms);
          return realSetTimeout(fn as () => void, 0, ...args);
        },
      );

    const maxDelayMs = 500;
    const transientErr = Object.assign(new Error("connect ETIMEDOUT"), {
      code: "ETIMEDOUT",
    });
    const fn = jest.fn().mockRejectedValue(transientErr);

    const [result] = await Promise.all([
      expect(withRetry(fn, "test", 5, { maxDelayMs })).rejects.toThrow(),
      jest.runAllTimersAsync(),
    ]);
    void result;

    expect(delays.length).toBeGreaterThan(0);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(maxDelayMs);
    }

    jest.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// #63 — RETRYABLE_HTTP_STATUSES and parseRetryAfterMs
// ---------------------------------------------------------------------------

describe("RETRYABLE_HTTP_STATUSES", () => {
  it("contains 429, 502, 503, and 504", () => {
    expect(RETRYABLE_HTTP_STATUSES.has(429)).toBe(true);
    expect(RETRYABLE_HTTP_STATUSES.has(502)).toBe(true);
    expect(RETRYABLE_HTTP_STATUSES.has(503)).toBe(true);
    expect(RETRYABLE_HTTP_STATUSES.has(504)).toBe(true);
  });

  it("does not contain non-retryable codes like 400 or 500", () => {
    expect(RETRYABLE_HTTP_STATUSES.has(400)).toBe(false);
    expect(RETRYABLE_HTTP_STATUSES.has(500)).toBe(false);
    expect(RETRYABLE_HTTP_STATUSES.has(200)).toBe(false);
  });
});

describe("isTransientError — HTTP status codes", () => {
  it("returns true for HTTP 429", () => {
    const err = Object.assign(new Error("Too Many Requests"), { status: 429 });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for HTTP 502", () => {
    const err = Object.assign(new Error("Bad Gateway"), { status: 502 });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for HTTP 503", () => {
    const err = Object.assign(new Error("Service Unavailable"), {
      status: 503,
    });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns true for HTTP 504", () => {
    const err = Object.assign(new Error("Gateway Timeout"), { status: 504 });
    expect(isTransientError(err)).toBe(true);
  });

  it("returns false for HTTP 400", () => {
    const err = Object.assign(new Error("Bad Request"), { status: 400 });
    expect(isTransientError(err)).toBe(false);
  });

  it("returns false for HTTP 500 (not in retryable set)", () => {
    const err = Object.assign(new Error("Internal Server Error"), {
      status: 500,
    });
    expect(isTransientError(err)).toBe(false);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses a numeric seconds string", () => {
    expect(parseRetryAfterMs("30")).toBe(30_000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs("60")).toBe(60_000);
  });

  it("clamps numeric values to 300 000 ms (5 minutes)", () => {
    expect(parseRetryAfterMs("9999")).toBe(300_000);
  });

  it("parses an HTTP-date string", () => {
    const future = new Date(Date.now() + 10_000).toUTCString();
    const result = parseRetryAfterMs(future);
    expect(result).toBeDefined();
    expect(result!).toBeGreaterThan(0);
    expect(result!).toBeLessThanOrEqual(300_000);
  });

  it("returns undefined for undefined or null input", () => {
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs(null)).toBeUndefined();
  });

  it("returns undefined for an unparseable string", () => {
    expect(parseRetryAfterMs("not-a-date-or-number")).toBeUndefined();
  });
});
