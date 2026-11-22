/**
 * Chaos test: Redis outage and recovery under simulated traffic.
 *
 * Issue #101 — Sends continuous requests to /simulate while simulating a
 * Redis network partition (via the ioredis "error" event), asserting that
 * zero requests return 500 errors and that the cache backend recovers to
 * Redis upon reconnection (via the ioredis "ready" event) without restarting
 * the process.
 */

import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Fake Redis client
// ---------------------------------------------------------------------------

/**
 * A fake Redis client backed by an EventEmitter so the cache module's
 * "error" / "connect" / "ready" handlers fire.  The get/set/del/flushdb/pttl
 * stubs let the RedisCache adapter operate without a real Redis instance.
 *
 * The variable name starts with "mock" so Jest permits its use inside
 * jest.mock factories (Jest's out-of-scope variable check exempts "mock*").
 */
type MockRedisClient = EventEmitter & {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  flushdb: jest.Mock;
  pttl: jest.Mock;
};

function createMockClient(): MockRedisClient {
  return Object.assign(new EventEmitter(), {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue("OK"),
    del: jest.fn().mockResolvedValue(1),
    flushdb: jest.fn().mockResolvedValue("OK"),
    pttl: jest.fn().mockResolvedValue(-1),
  });
}

const mockClient = createMockClient();

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted by Jest above imports)
// ---------------------------------------------------------------------------

jest.mock("ioredis", () => jest.fn(() => mockClient));

jest.mock("@middleware/metrics", () => ({
  __esModule: true,
  default: {
    incrementActiveSimulations: jest.fn(),
    decrementActiveSimulations: jest.fn(),
    recordSimulation: jest.fn(),
    recordSimulationDuration: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRpcError: jest.fn(),
    recordCacheLatency: jest.fn(),
    recordXdrBytes: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(""),
  },
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) =>
    next(),
  metrics: { getMetrics: jest.fn().mockResolvedValue("") },
}));

/**
 * Mock the simulator so /simulate exercises the REAL cache layer
 * (getCache / buildCacheKey) without hitting the Stellar RPC network.
 * This is what lets the chaos test observe the cache fallback and
 * recovery behaviour through the HTTP layer.
 */
jest.mock("@services/simulator", () => {
  const { getCache, buildCacheKey } = require("../../services/cache");
  const RESULT = {
    success: true,
    footprint: { readOnly: [] as string[], readWrite: [] as string[] },
    cost: { cpuInsns: "1000", memBytes: "2000" },
    cacheHit: false,
  };
  return {
    simulateTransaction: jest.fn(async (xdr: string, network: string) => {
      const cache = getCache();
      const key = buildCacheKey({ xdr, network });
      const cached = await cache.get<typeof RESULT>(key);
      if (cached) {
        cached.cacheHit = true;
        return cached;
      }
      await cache.set(key, RESULT, 60_000);
      return { ...RESULT };
    }),
    simulationCache: { get: jest.fn(), set: jest.fn() },
  };
});

// ---------------------------------------------------------------------------
// Imports — use the mocked modules
// ---------------------------------------------------------------------------

import request from "supertest";

import app from "../../index";
import { getCache } from "../../services/cache";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const VALID_XDR = "AAAAAgAAAAC" + "A".repeat(40) + "==";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface TrafficResult {
  status: number;
  durationMs: number;
}

/**
 * Dispatches requests at ~20 req/sec (50 ms interval) for the given duration.
 */
async function trafficWorker(durationMs: number): Promise<TrafficResult[]> {
  const results: TrafficResult[] = [];
  const end = Date.now() + durationMs;
  while (Date.now() < end) {
    const start = Date.now();
    const res = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: VALID_XDR, network: "testnet" });
    results.push({ status: res.status, durationMs: Date.now() - start });
    const elapsed = Date.now() - start;
    const wait = Math.max(0, 50 - elapsed);
    if (wait > 0) await sleep(wait);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Chaos: Redis outage and recovery under simulated traffic", () => {
  beforeEach(() => {
    process.env.NODE_ENV = "test";
    process.env.REDIS_URL = "redis://localhost:6379";
  });

  afterEach(() => {
    delete process.env.REDIS_URL;
  });

  it("serves zero 500s during Redis outage using memory fallback and recovers on reconnection", async () => {
    // ── Phase 0: Prime — first request triggers getCache() to create the
    // Redis backend wrapping mockClient ──
    const prime = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: VALID_XDR, network: "testnet" });
    expect(prime.status).toBe(200);
    expect(getCache().backend).toBe("redis");

    // ── Phase 1: Baseline traffic (Redis healthy) — ~20 req/sec for 1s ──
    const baseline = await trafficWorker(1000);
    expect(baseline.length).toBeGreaterThanOrEqual(15);
    expect(baseline.filter((r) => r.status === 500)).toHaveLength(0);
    expect(baseline.every((r) => r.status === 200)).toBe(true);

    const setCallsBeforeOutage = mockClient.set.mock.calls.length;
    expect(setCallsBeforeOutage).toBeGreaterThan(0);

    // ── Phase 2: Simulate Redis outage — emit "error" event ──
    mockClient.emit("error", new Error("ECONNREFUSED"));

    // Cache should have fallen back to in-memory
    expect(getCache().backend).toBe("memory");

    // Continue traffic during outage — ~20 req/sec for 2s
    const outage = await trafficWorker(2000);
    expect(outage.length).toBeGreaterThanOrEqual(30);
    // Assert zero 500 errors during Redis outage
    expect(outage.filter((r) => r.status === 500)).toHaveLength(0);
    expect(outage.every((r) => r.status === 200)).toBe(true);

    // No Redis writes during outage — all writes went to the memory cache
    const setCallsAfterOutage = mockClient.set.mock.calls.length;
    expect(setCallsAfterOutage).toBe(setCallsBeforeOutage);

    // ── Phase 3: Simulate Redis recovery — emit "ready" event ──
    mockClient.emit("ready");

    // Cache should have restored to Redis backend
    expect(getCache().backend).toBe("redis");

    // Continue traffic after recovery — ~20 req/sec for 1s
    const recovery = await trafficWorker(1000);
    expect(recovery.length).toBeGreaterThanOrEqual(15);
    // Assert zero 500 errors after recovery
    expect(recovery.filter((r) => r.status === 500)).toHaveLength(0);
    expect(recovery.every((r) => r.status === 200)).toBe(true);

    // Redis writes resumed after recovery (cache re-established without
    // restarting the process)
    const setCallsAfterRecovery = mockClient.set.mock.calls.length;
    expect(setCallsAfterRecovery).toBeGreaterThan(setCallsAfterOutage);

    // Performance recovered — recovery requests complete quickly
    const maxRecoveryMs = Math.max(...recovery.map((r) => r.durationMs));
    expect(maxRecoveryMs).toBeLessThan(2000);
  }, 30_000); // 30 s timeout for the full chaos scenario
});
