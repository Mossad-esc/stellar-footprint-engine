import {
  isTransientError,
  parseRetryAfterMs,
  RETRYABLE_HTTP_STATUSES,
  withRetry,
} from "../retry";

// Mock the logger to suppress output during tests
jest.mock("../logger", () => ({
  logger: { warn: jest.fn(), debug: jest.fn() },
}));

// Speed up tests by mocking setTimeout
jest.useFakeTimers();

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

  it("returns true for network timeout message", () => {
    expect(isTransientError(new Error("network timeout occurred"))).toBe(true);
  });

  it("returns false for simulation errors", () => {
    expect(
      isTransientError(new Error("simulation error: contract failed")),
    ).toBe(false);
  });

  it("returns false for invalid XDR", () => {
    expect(isTransientError(new Error("invalid xdr provided"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isTransientError("string error")).toBe(false);
    expect(isTransientError(null)).toBe(false);
  });
});

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

    // Attach rejection handler immediately to avoid PromiseRejectionHandledWarning,
    // then advance fake timers concurrently so the retry loop can complete.
    const [result] = await Promise.all([
      expect(withRetry(fn, "test", 3)).rejects.toThrow("connect ETIMEDOUT"),
      jest.runAllTimersAsync(),
    ]);
    void result;
    expect(fn).toHaveBeenCalledTimes(4); // initial + 3 retries
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
