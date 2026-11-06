import type { NextFunction, Request, Response } from "express";

const makeReq = (ip: string): Request =>
  ({ ip, socket: { remoteAddress: ip } }) as unknown as Request;

const makeRes = (): Response => {
  const res = {} as Response;
  (res as unknown as Record<string, unknown>).status = jest
    .fn()
    .mockReturnValue(res);
  (res as unknown as Record<string, unknown>).json = jest
    .fn()
    .mockReturnValue(res);
  return res;
};

// Low thresholds and short window to keep tests fast.
const ENV_OVERRIDES = {
  BRUTE_FORCE_DELAY_THRESHOLD: "2",
  BRUTE_FORCE_BLOCK_THRESHOLD: "4",
  BRUTE_FORCE_WINDOW_MS: "200",
  BRUTE_FORCE_DELAY_MS: "50",
  BRUTE_FORCE_BLOCK_MS: "60000",
};

describe("bruteForceMiddleware", () => {
  let bruteForceMiddleware: (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => Promise<void>;
  let recordFailure: (ip: string) => Promise<void>;

  beforeEach(() => {
    Object.assign(process.env, ENV_OVERRIDES);
    jest.resetModules();
    const mod = require("./bruteForce");
    bruteForceMiddleware = mod.bruteForceMiddleware;
    recordFailure = mod.recordFailure;
  });

  afterEach(() => {
    Object.keys(ENV_OVERRIDES).forEach((k) => delete process.env[k]);
    jest.useRealTimers();
  });

  it("passes through immediately when below delay threshold", async () => {
    const next = jest.fn();
    await bruteForceMiddleware(makeReq("10.0.0.1"), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requests above delay threshold are delayed then calls next", async () => {
    jest.useFakeTimers();
    const ip = "10.0.0.2";
    await recordFailure(ip);
    await recordFailure(ip); // count = 2 >= DELAY_THRESHOLD

    const next = jest.fn();
    const promise = bruteForceMiddleware(makeReq(ip), makeRes(), next);
    await Promise.resolve();
    expect(next).not.toHaveBeenCalled(); // still awaiting the delay
    jest.runAllTimers();
    await promise;
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requests above block threshold return 429", async () => {
    const ip = "10.0.0.3";
    for (let i = 0; i < 4; i++) await recordFailure(ip); // count = 4 >= BLOCK_THRESHOLD

    const res = makeRes();
    const next = jest.fn();
    await bruteForceMiddleware(makeReq(ip), res, next);

    expect(
      (res as unknown as Record<string, jest.Mock>).status,
    ).toHaveBeenCalledWith(429);
    expect(next).not.toHaveBeenCalled();
  });

  it("counter resets after window expires", async () => {
    jest.useFakeTimers();
    const ip = "10.0.0.4";
    recordFailure(ip);
    recordFailure(ip); // count = 2 >= DELAY_THRESHOLD

    // Advance past the 200 ms window
    jest.advanceTimersByTime(201);

    const next = jest.fn();
    const res = makeRes();
    const promise = bruteForceMiddleware(makeReq(ip), res, next);
    jest.runAllTimers();
    await promise;

    expect(next).toHaveBeenCalledTimes(1);
    expect(
      (res as unknown as Record<string, jest.Mock>).status,
    ).not.toHaveBeenCalled();
  });
});
