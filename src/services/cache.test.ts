import * as StellarSdk from "@stellar/stellar-sdk";

import {
  LruMemoryCache,
  buildCacheKey,
  canonicalizeTransactionXdr,
} from "./cache";

jest.mock("ioredis");
jest.mock("../middleware/metrics", () => ({
  __esModule: true,
  default: { recordCacheLatency: jest.fn() },
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
      default: { recordCacheLatency: jest.fn() },
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
      default: { recordCacheLatency: jest.fn() },
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
// Issue #18: Canonical XDR normalization
// ---------------------------------------------------------------------------

describe("canonicalizeTransactionXdr", () => {
  const kp = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
  const kp2 = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
  const contract = StellarSdk.Address.contract(Buffer.alloc(32, 7)).toString();

  function makeTx(auth: StellarSdk.xdr.SorobanAuthorizationEntry[] = []) {
    return new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(kp.publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
            new StellarSdk.xdr.InvokeContractArgs({
              contractAddress: new StellarSdk.Address(contract).toScAddress(),
              functionName: "transfer",
              args: [],
            }),
          ),
          auth,
        }),
      )
      .setTimeout(0)
      .build();
  }

  function makeAuthEntry(
    key: StellarSdk.Keypair,
    nonce: bigint = 1n,
  ): StellarSdk.xdr.SorobanAuthorizationEntry {
    return new StellarSdk.xdr.SorobanAuthorizationEntry({
      credentials: StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
        new StellarSdk.xdr.SorobanAddressCredentials({
          address: new StellarSdk.Address(key.publicKey()).toScAddress(),
          nonce,
          signatureExpirationLedger: 1000,
          signature: StellarSdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: new StellarSdk.xdr.SorobanAuthorizedInvocation({
        function:
          StellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new StellarSdk.xdr.InvokeContractArgs({
              contractAddress: new StellarSdk.Address(contract).toScAddress(),
              functionName: "transfer",
              args: [],
            }),
          ),
        subInvocations: [],
      }),
    });
  }

  it("transactions identical except for outer signatures produce the same canonical XDR", () => {
    const tx = makeTx();
    const xdr1 = tx.toXDR();
    const signed = makeTx();
    signed.sign(kp);
    const xdr2 = signed.toXDR();

    expect(xdr1).not.toBe(xdr2);
    expect(canonicalizeTransactionXdr(xdr1)).toBe(
      canonicalizeTransactionXdr(xdr2),
    );
  });

  it("transactions with different auth entry order produce the same canonical XDR", () => {
    const auth1 = [makeAuthEntry(kp, 1n), makeAuthEntry(kp2, 2n)];
    const auth2 = [makeAuthEntry(kp2, 2n), makeAuthEntry(kp, 1n)];

    const xdr1 = makeTx(auth1).toXDR();
    const xdr2 = makeTx(auth2).toXDR();

    // Different XDRs due to auth order
    expect(xdr1).not.toBe(xdr2);
    // After canonicalization they should match
    expect(canonicalizeTransactionXdr(xdr1)).toBe(
      canonicalizeTransactionXdr(xdr2),
    );
  });

  it("produces the same cache key for equivalent transactions", () => {
    const tx = makeTx();
    const signed = makeTx();
    signed.sign(kp);

    const key1 = buildCacheKey({ xdr: tx.toXDR(), network: "testnet" });
    const key2 = buildCacheKey({ xdr: signed.toXDR(), network: "testnet" });
    expect(key1).toBe(key2);
  });

  it("falls back gracefully for malformed XDR without throwing", () => {
    expect(() => canonicalizeTransactionXdr("not-valid-xdr!!!")).not.toThrow();
    expect(canonicalizeTransactionXdr("not-valid-xdr!!!")).toBe(
      "not-valid-xdr!!!",
    );
  });

  it("produces a cache key for malformed XDR without throwing", () => {
    expect(() =>
      buildCacheKey({ xdr: "bad-xdr", network: "testnet" }),
    ).not.toThrow();
    expect(buildCacheKey({ xdr: "bad-xdr", network: "testnet" })).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});
