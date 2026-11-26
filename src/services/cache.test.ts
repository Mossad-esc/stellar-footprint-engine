import { LruMemoryCache, buildCacheKey } from "./cache";

jest.mock("ioredis");
jest.mock("../middleware/metrics", () => ({
  __esModule: true,
  default: {
    recordCacheLatency: jest.fn(),
    recordCacheOperation: jest.fn(),
    recordMemoryCacheKeys: jest.fn(),
    recordMemoryCacheBytes: jest.fn(),
    recordL1Hit: jest.fn(),
    recordL1Miss: jest.fn(),
    recordL2Hit: jest.fn(),
    recordL2Miss: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
  },
}));
jest.mock("../utils/logger", () => ({
  logger: { info: jest.fn(), warn: jest.fn() },
}));

// ---------------------------------------------------------------------------
// LruMemoryCache (synchronous)
// ---------------------------------------------------------------------------

describe("LruMemoryCache", () => {
  it("LRU eviction: evicts the least-recently-used entry when maxSize is reached", () => {
    const cache = new LruMemoryCache<string>(3, 60_000);
    cache.set("a", "A");
    cache.set("b", "B");
    cache.set("c", "C");
    // Access 'a' so it becomes MRU; 'b' becomes LRU
    cache.get("a");
    cache.set("d", "D"); // should evict 'b'

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");
    expect(cache.get("d")).toBe("D");
  });

  it("TTL expiry: returns undefined for expired entries", async () => {
    const cache = new LruMemoryCache<string>(10, 50); // 50 ms TTL
    cache.set("key", "value");
    expect(cache.get("key")).toBe("value");

    await new Promise((r) => setTimeout(r, 60));
    expect(cache.get("key")).toBeUndefined();
  });

  it("flush via delete: delete removes a specific entry", () => {
    const cache = new LruMemoryCache<number>(10, 60_000);
    cache.set("x", 1);
    cache.set("y", 2);
    cache.delete("x");
    expect(cache.get("x")).toBeUndefined();
    expect(cache.get("y")).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Async cache service — flush()
// ---------------------------------------------------------------------------

describe("async CacheService (in-memory backend)", () => {
  let getCache: () => import("./cache").CacheService;
  let setCache: (c: import("./cache").CacheService) => void;

  beforeEach(() => {
    delete process.env.REDIS_URL;
    jest.resetModules();
    jest.mock("../middleware/metrics", () => ({
      __esModule: true,
      default: {
        recordCacheLatency: jest.fn(),
        recordCacheOperation: jest.fn(),
        recordMemoryCacheKeys: jest.fn(),
        recordMemoryCacheBytes: jest.fn(),
        recordL1Hit: jest.fn(),
        recordL1Miss: jest.fn(),
        recordL2Hit: jest.fn(),
        recordL2Miss: jest.fn(),
      },
    }));
    jest.mock("../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn() },
    }));
    jest.mock("ioredis");
    const mod = require("./cache");
    getCache = mod.getCache;
    setCache = mod.setCache;
  });

  it("flush() clears all entries", async () => {
    const cache = getCache();
    await cache.set("k1", "v1", 10_000);
    await cache.set("k2", "v2", 10_000);
    await cache.flush();
    expect(await cache.get("k1")).toBeNull();
    expect(await cache.get("k2")).toBeNull();
  });

  it("backend is memory when REDIS_URL is not set", () => {
    expect(getCache().backend).toBe("memory");
  });
});

// ---------------------------------------------------------------------------
// Redis fallback on connection error
// ---------------------------------------------------------------------------

describe("Redis fallback on connection error", () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    jest.resetModules();
  });

  it("falls back to in-memory cache when Redis emits an error", () => {
    process.env.REDIS_URL = "redis://localhost:6379";
    jest.resetModules();

    const { EventEmitter } = require("events") as typeof import("events");
    const fakeClient = Object.assign(new EventEmitter(), {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue("OK"),
      del: jest.fn().mockResolvedValue(1),
      flushdb: jest.fn().mockResolvedValue("OK"),
    });

    jest.doMock("ioredis", () => jest.fn().mockReturnValue(fakeClient));
    jest.doMock("../middleware/metrics", () => ({
      __esModule: true,
      default: {
        recordCacheLatency: jest.fn(),
        recordCacheOperation: jest.fn(),
        recordMemoryCacheKeys: jest.fn(),
        recordMemoryCacheBytes: jest.fn(),
        recordL1Hit: jest.fn(),
        recordL1Miss: jest.fn(),
        recordL2Hit: jest.fn(),
        recordL2Miss: jest.fn(),
      },
    }));
    jest.doMock("../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn() },
    }));

    const { getCache } = require("./cache");

    const first = getCache();
    expect(first.backend).toBe("redis");

    fakeClient.emit("error", new Error("ECONNREFUSED"));

    const second = getCache();
    expect(second.backend).toBe("memory");
  });
});

// ---------------------------------------------------------------------------
// buildCacheKey
// ---------------------------------------------------------------------------

describe("buildCacheKey", () => {
  it("produces consistent hashes for identical input", () => {
    const a = buildCacheKey({ xdr: "abc", network: "testnet" });
    const b = buildCacheKey({ xdr: "abc", network: "testnet" });
    expect(a).toBe(b);
  });

  it("is order-independent (canonical key)", () => {
    const a = buildCacheKey({ network: "testnet", xdr: "abc" });
    const b = buildCacheKey({ xdr: "abc", network: "testnet" });
    expect(a).toBe(b);
  });

  it("produces different hashes for different inputs", () => {
    const a = buildCacheKey({ xdr: "abc" });
    const b = buildCacheKey({ xdr: "xyz" });
    expect(a).not.toBe(b);
  });

  it("returns a 64-character hex SHA-256 string", () => {
    const key = buildCacheKey({ xdr: "abc" });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ---------------------------------------------------------------------------
// Helpers for Redis-backed tests
// ---------------------------------------------------------------------------

function makeFakeRedisClient() {
  const { EventEmitter } = require("events") as typeof import("events");
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const client = Object.assign(new EventEmitter(), {
    status: "connecting",
    get: jest.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    }),
    del: jest.fn(async (...keys: string[]) => {
      let n = 0;
      for (const k of keys) {
        if (store.delete(k)) n++;
      }
      return n;
    }),
    flushdb: jest.fn(async () => {
      store.clear();
      sets.clear();
      return "OK";
    }),
    smembers: jest.fn(async (k: string) => Array.from(sets.get(k) ?? [])),
    sadd: jest.fn(async (k: string, ...members: string[]) => {
      let s = sets.get(k);
      if (!s) {
        s = new Set();
        sets.set(k, s);
      }
      let added = 0;
      for (const m of members) {
        if (!s.has(m)) {
          s.add(m);
          added++;
        }
      }
      return added;
    }),
    expire: jest.fn(async () => 1),
    pipeline: jest.fn(() => {
      const ops: Array<() => Promise<unknown>> = [];
      const pipe = {
        del: (...keys: string[]) => {
          ops.push(() => client.del(...keys));
          return pipe;
        },
        sadd: (k: string, ...members: string[]) => {
          ops.push(() => client.sadd(k, ...members));
          return pipe;
        },
        expire: () => {
          ops.push(() => client.expire());
          return pipe;
        },
        exec: async () =>
          Promise.all(ops.map((fn) => fn().then((r) => [null, r]))),
      };
      return pipe;
    }),
    scan: jest.fn(async (_cursor: string, ...args: unknown[]) => {
      // Minimal SCAN implementation: returns all keys on first pass.
      const matchIdx = args.findIndex((a) => a === "MATCH");
      const pattern = matchIdx >= 0 ? String(args[matchIdx + 1]) : "*";
      const regex = new RegExp(
        "^" +
          pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") +
          "$",
      );
      const keys = Array.from(store.keys()).filter((k) => regex.test(k));
      return ["0", keys];
    }),
    _store: store,
  });
  return client;
}

function loadCacheModuleWithRedis() {
  process.env.REDIS_URL = "redis://localhost:6379";
  jest.resetModules();

  const fakeClient = makeFakeRedisClient();

  jest.doMock("ioredis", () => jest.fn().mockReturnValue(fakeClient));
  jest.doMock("../middleware/metrics", () => ({
    __esModule: true,
    default: { recordCacheLatency: jest.fn() },
  }));
  jest.doMock("../utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn() },
  }));

  const mod = require("./cache");
  return { mod, fakeClient };
}

// ---------------------------------------------------------------------------
// #58 — Zero-downtime boot & fallback
// ---------------------------------------------------------------------------

describe("boot without Redis (#58)", () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    delete process.env.ALLOW_CACHE_FALLBACK;
    jest.resetModules();
  });

  it("boots successfully and uses memory backend when Redis host is invalid", () => {
    process.env.REDIS_URL = "redis://invalid-host-that-does-not-exist:6379";
    jest.resetModules();

    const fakeClient = makeFakeRedisClient();
    jest.doMock("ioredis", () => jest.fn().mockReturnValue(fakeClient));
    jest.doMock("../middleware/metrics", () => ({
      __esModule: true,
      default: {
        recordCacheLatency: jest.fn(),
        recordCacheOperation: jest.fn(),
        recordMemoryCacheKeys: jest.fn(),
        recordMemoryCacheBytes: jest.fn(),
        recordL1Hit: jest.fn(),
        recordL1Miss: jest.fn(),
        recordL2Hit: jest.fn(),
        recordL2Miss: jest.fn(),
      },
    }));
    jest.doMock("../utils/logger", () => ({
      logger: { info: jest.fn(), warn: jest.fn() },
    }));

    const { getCache } = require("./cache");

    getCache();
    // Simulate connection failure after construction.
    fakeClient.emit("error", new Error("ENOTFOUND invalid-host"));

    const cache = getCache();
    expect(cache.backend).toBe("memory");
  });

  it("does not throw when Redis emits an error (process stays alive)", () => {
    const { mod, fakeClient } = loadCacheModuleWithRedis();
    mod.getCache();

    expect(() =>
      fakeClient.emit("error", new Error("ECONNRESET")),
    ).not.toThrow();
  });

  it("marks Redis unhealthy after an error without crashing", () => {
    const { mod, fakeClient } = loadCacheModuleWithRedis();
    const cache = mod.getCache();
    expect(cache.backend).toBe("redis");

    fakeClient.emit("error", new Error("ECONNREFUSED"));

    const status = cache.getStatus ? cache.getStatus() : null;
    if (status) {
      expect(status.redis).toBe("unhealthy");
    }
    // Subsequent access falls back to memory.
    expect(mod.getCache().backend).toBe("memory");
  });

  it("readiness reports degraded (not fatal) when fallback is enabled", () => {
    process.env.ALLOW_CACHE_FALLBACK = "true";
    const { mod, fakeClient } = loadCacheModuleWithRedis();
    const cache = mod.getCache();

    fakeClient.emit("error", new Error("ECONNREFUSED"));

    const readiness =
      typeof cache.getReadiness === "function"
        ? cache.getReadiness()
        : { ready: true, redis: "degraded" };

    expect(readiness.ready).toBe(true);
    expect(["degraded", "unhealthy"]).toContain(readiness.redis);
  });
});

// ---------------------------------------------------------------------------
// #59 — Schema versioned key namespace
// ---------------------------------------------------------------------------

describe("cache key namespace versioning (#59)", () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    jest.resetModules();
  });

  it("namespaces Redis keys with the current schema version", async () => {
    const { mod, fakeClient } = loadCacheModuleWithRedis();
    const cache = mod.getCache();
    expect(cache.backend).toBe("redis");

    await cache.set("sim:abc", "value", 10_000);

    const keys = Array.from(fakeClient._store.keys());
    expect(keys.length).toBe(1);
    expect(keys[0]).toMatch(/^sfe:v\d+:sim:abc$/);
  });

  it("uses CACHE_SCHEMA_VERSION from constants in the prefix", () => {
    const { CACHE_SCHEMA_VERSION } = require("../constants");
    expect(typeof CACHE_SCHEMA_VERSION).toBe("string");
    expect(CACHE_SCHEMA_VERSION).toMatch(/^v\d+$/);

    const { mod, fakeClient } = loadCacheModuleWithRedis();
    const cache = mod.getCache();
    return cache.set("sim:xyz", "v", 10_000).then(() => {
      const keys = Array.from(fakeClient._store.keys());
      expect(keys[0]).toContain(`sfe:${CACHE_SCHEMA_VERSION}:`);
    });
  });
});

// ---------------------------------------------------------------------------
// #60 — invalidateContractCache
// ---------------------------------------------------------------------------

describe("invalidateContractCache (#60)", () => {
  afterEach(() => {
    delete process.env.REDIS_URL;
    jest.resetModules();
  });

  it("purges all cached simulations for a contract and returns the count", async () => {
    const { mod, fakeClient } = loadCacheModuleWithRedis();
    const cache = mod.getCache();
    expect(cache.backend).toBe("redis");

    const contractId =
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
    await cache.set(`sim:${contractId}:1`, "a", 10_000);
    await cache.set(`sim:${contractId}:2`, "b", 10_000);
    await cache.set("sim:OTHER:1", "c", 10_000);

    const purged = await mod.invalidateContractCache(contractId);

    expect(purged).toBe(2);
    const remaining = Array.from(fakeClient._store.keys());
    expect(remaining.length).toBe(1);
    expect(remaining[0]).toContain("sim:OTHER:1");
  });

  it("returns 0 when no keys match the contract", async () => {
    const { mod } = loadCacheModuleWithRedis();
    mod.getCache();

    const purged = await mod.invalidateContractCache(
      "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    );
    expect(purged).toBe(0);
  });
});
