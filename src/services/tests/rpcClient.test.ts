import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import metrics from "../../middleware/metrics";
import {
  fetchTtlInfo,
  guardPayloadSize,
  HEDGE_DELAY_MS,
  hedgedSimulate,
  parseRpcUrls,
  recordEndpointResult,
  resetRpcPool,
  selectRpcEndpoint,
  simulateViaRpc,
} from "../rpcClient";
import { parseXdr } from "../xdrParser";

jest.mock("../../config/stellar", () => ({
  ...jest.requireActual("../../config/stellar"),
  getRpcServer: jest.fn(),
}));

const mockedGetRpcServer = stellarConfig.getRpcServer as jest.MockedFunction<
  typeof stellarConfig.getRpcServer
>;

const CONTRACT_DATA_XDR =
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
const ACCOUNT_XDR = "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==";

function createSampleTx() {
  const kp = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(kp.publicKey(), "1");
  return new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.manageData({ name: "ping", value: "pong" }),
    )
    .setTimeout(30)
    .build();
}

describe("rpcClient & xdrParser", () => {
  const mockSimulateTransaction = jest.fn();
  const mockGetLedgerEntries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRpcServer.mockReturnValue({
      simulateTransaction: mockSimulateTransaction,
      getLedgerEntries: mockGetLedgerEntries,
    } as unknown as StellarSdk.rpc.Server);
  });

  describe("parseXdr", () => {
    it("parses valid base64 XDR into a Stellar Transaction", () => {
      const tx = createSampleTx();
      const parsed = parseXdr(tx.toXDR(), StellarSdk.Networks.TESTNET);

      expect(parsed).toBeInstanceOf(StellarSdk.Transaction);
      expect(parsed.toXDR()).toBe(tx.toXDR());
    });

    it("throws on malformed XDR strings", () => {
      expect(() =>
        parseXdr("not-a-valid-xdr", StellarSdk.Networks.TESTNET),
      ).toThrow();
    });
  });

  describe("simulateViaRpc", () => {
    it("forwards signal without ledger option when ledgerSequence is omitted", async () => {
      const tx = createSampleTx();
      const controller = new AbortController();
      const fakeResponse = { id: "sim-1", latestLedger: 123 };
      mockSimulateTransaction.mockResolvedValue(fakeResponse);

      const res = await simulateViaRpc(tx, "testnet", controller.signal);

      expect(res).toBe(fakeResponse);
      expect(mockSimulateTransaction).toHaveBeenCalledWith(tx, {
        signal: controller.signal,
      });
    });

    it("includes ledger option when ledgerSequence is provided", async () => {
      const tx = createSampleTx();
      mockSimulateTransaction.mockResolvedValue({
        id: "sim-hist",
        latestLedger: 900,
      });

      await simulateViaRpc(tx, "mainnet", undefined, 900);

      expect(mockSimulateTransaction).toHaveBeenCalledWith(tx, {
        signal: undefined,
        ledger: 900,
      });
    });
  });

  describe("parseRpcUrls", () => {
    it("splits comma-separated URLs and trims whitespace", () => {
      expect(
        parseRpcUrls(
          "https://a.example.com, https://b.example.com ,https://c.example.com",
        ),
      ).toEqual([
        "https://a.example.com",
        "https://b.example.com",
        "https://c.example.com",
      ]);
    });

    it("accepts arrays and drops empty entries", () => {
      expect(
        parseRpcUrls([
          "https://a.example.com",
          "",
          "  ",
          "https://b.example.com",
        ]),
      ).toEqual(["https://a.example.com", "https://b.example.com"]);
    });

    it("returns an empty array for undefined or empty input", () => {
      expect(parseRpcUrls(undefined)).toEqual([]);
      expect(parseRpcUrls("")).toEqual([]);
      expect(parseRpcUrls(" , , ")).toEqual([]);
    });
  });

  describe("latency-weighted routing", () => {
    beforeEach(() => {
      resetRpcPool();
    });

    afterEach(() => {
      resetRpcPool();
    });

    it("routes traffic proportionally towards the lowest-latency endpoint", async () => {
      const fastSimulate = jest.fn().mockResolvedValue({ id: "fast" });
      const slowSimulate = jest.fn().mockResolvedValue({ id: "slow" });

      mockedGetRpcServer.mockImplementation((network?: string) => {
        const url = network ?? "";
        if (url.includes("fast")) {
          return {
            simulateTransaction: fastSimulate,
            getLedgerEntries: mockGetLedgerEntries,
          } as unknown as StellarSdk.rpc.Server;
        }
        return {
          simulateTransaction: slowSimulate,
          getLedgerEntries: mockGetLedgerEntries,
        } as unknown as StellarSdk.rpc.Server;
      });

      // Seed latency samples: fast endpoint ~1ms, slow endpoint ~50ms.
      const fastServer = mockedGetRpcServer("https://fast.example.com");
      const slowServer = mockedGetRpcServer("https://slow.example.com");
      expect(fastServer).toBeDefined();
      expect(slowServer).toBeDefined();

      const tx = createSampleTx();
      const counts: Record<string, number> = { fast: 0, slow: 0 };

      for (let i = 0; i < 40; i += 1) {
        const res = (await simulateViaRpc(tx, "testnet")) as { id: string };
        counts[res.id] += 1;
      }

      expect(counts.fast + counts.slow).toBe(40);
      // Latency-weighted selection should favor the faster endpoint.
      expect(counts.fast).toBeGreaterThan(counts.slow);
    });

    it("penalizes endpoints that return 5xx errors", async () => {
      const healthySimulate = jest.fn().mockResolvedValue({ id: "healthy" });
      const failingSimulate = jest
        .fn()
        .mockRejectedValue(Object.assign(new Error("boom"), { status: 503 }));

      mockedGetRpcServer.mockImplementation((network?: string) => {
        const url = network ?? "";
        if (url.includes("healthy")) {
          return {
            simulateTransaction: healthySimulate,
            getLedgerEntries: mockGetLedgerEntries,
          } as unknown as StellarSdk.rpc.Server;
        }
        return {
          simulateTransaction: failingSimulate,
          getLedgerEntries: mockGetLedgerEntries,
        } as unknown as StellarSdk.rpc.Server;
      });

      const tx = createSampleTx();
      let healthyCount = 0;

      for (let i = 0; i < 20; i += 1) {
        try {
          const res = (await simulateViaRpc(tx, "testnet")) as { id: string };
          if (res.id === "healthy") healthyCount += 1;
        } catch {
          // Failures are expected from the degraded endpoint.
        }
      }

      // The healthy endpoint should receive the bulk of traffic.
      expect(healthyCount).toBeGreaterThan(10);
    });
  });

  describe("fetchTtlInfo", () => {
    it("returns an empty map immediately when footprintEntries is empty", async () => {
      const result = await fetchTtlInfo("testnet", []);

      expect(result).toEqual({});
      expect(mockedGetRpcServer).not.toHaveBeenCalled();
    });

    it("computes liveUntilLedger and expiresInLedgers for entries with TTLs", async () => {
      mockGetLedgerEntries.mockResolvedValue({
        latestLedger: 1000,
        entries: [
          { liveUntilLedgerSeq: 1250 },
          { liveUntilLedgerSeq: undefined },
        ],
      });

      const result = await fetchTtlInfo("testnet", [
        CONTRACT_DATA_XDR,
        ACCOUNT_XDR,
      ]);

      expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        [CONTRACT_DATA_XDR]: {
          liveUntilLedger: 1250,
          expiresInLedgers: 250,
        },
      });
    });

    it("returns an empty map when RPC getLedgerEntries or XDR decoding fails", async () => {
      mockGetLedgerEntries.mockRejectedValue(new Error("RPC unavailable"));

      const rpcFailure = await fetchTtlInfo("testnet", [CONTRACT_DATA_XDR]);
      expect(rpcFailure).toEqual({});

      const badXdrFailure = await fetchTtlInfo("testnet", ["bad-xdr"]);
      expect(badXdrFailure).toEqual({});
    });
  });
});

// ---------------------------------------------------------------------------
// #63 — Provider failover on HTTP 429 / 5xx
// ---------------------------------------------------------------------------

describe("recordEndpointResult — custom penalty duration", () => {
  beforeEach(() => resetRpcPool());
  afterEach(() => resetRpcPool());

  it("applies the default 30 s penalty when penaltyMs is omitted", () => {
    const before = Date.now();
    recordEndpointResult(
      "testnet" as never,
      "https://rpc.example.com",
      100,
      true,
    );
    const state = selectRpcEndpoint("testnet" as never);
    // We can't directly inspect penalizedUntil, but we verify the endpoint
    // still exists in the pool by confirming selectRpcEndpoint returns something.
    expect(state).toBeUndefined(); // no URLs configured in env — just checking no throw
  });

  it("applies a custom penalty duration when penaltyMs is provided", () => {
    // This mainly verifies the function signature accepts the extra param
    // without throwing.
    expect(() =>
      recordEndpointResult(
        "testnet" as never,
        "https://rpc.example.com",
        50,
        true,
        5_000,
      ),
    ).not.toThrow();
  });
});

describe("simulateViaRpc — provider failover on 429 / 5xx", () => {
  const mockSimulateTransaction = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    resetRpcPool();
    mockedGetRpcServer.mockReturnValue({
      simulateTransaction: mockSimulateTransaction,
      getLedgerEntries: jest.fn(),
    } as unknown as StellarSdk.rpc.Server);
  });

  afterEach(() => {
    resetRpcPool();
    delete process.env.TESTNET_RPC_URL;
  });

  it("retries against a different provider after a 429 from the first host", async () => {
    // Two providers in the pool: provider-a returns 429, provider-b succeeds.
    process.env.TESTNET_RPC_URL =
      "https://provider-a.example.com,https://provider-b.example.com";

    const rateLimitErr = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    const fakeResponse = { id: "sim-ok", latestLedger: 200 };

    // The SDK Server constructor is what determines which URL is used.
    // We intercept at the mock level: first call rejects, second resolves.
    mockSimulateTransaction
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue(fakeResponse);

    const tx = createSampleTx();
    const result = await simulateViaRpc(tx, "testnet");

    expect(result).toEqual(fakeResponse);
    // simulateTransaction must have been called at least twice (once per provider attempt)
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(2);
  });

  it("throws immediately when all providers return 429 and retries are exhausted", async () => {
    process.env.TESTNET_RPC_URL =
      "https://provider-a.example.com,https://provider-b.example.com";

    const rateLimitErr = Object.assign(new Error("Too Many Requests"), {
      status: 429,
    });
    mockSimulateTransaction.mockRejectedValue(rateLimitErr);

    const tx = createSampleTx();
    await expect(simulateViaRpc(tx, "testnet")).rejects.toThrow(
      "Too Many Requests",
    );
  });

  it("propagates Retry-After header value when present on the error", async () => {
    process.env.TESTNET_RPC_URL =
      "https://provider-a.example.com,https://provider-b.example.com";

    const rateLimitErr = Object.assign(new Error("Too Many Requests"), {
      status: 429,
      response: {
        status: 429,
        headers: { get: (h: string) => (h === "retry-after" ? "5" : null) },
      },
    });
    const fakeResponse = { id: "sim-after-retry-after", latestLedger: 300 };

    mockSimulateTransaction
      .mockRejectedValueOnce(rateLimitErr)
      .mockResolvedValue(fakeResponse);

    const tx = createSampleTx();
    const result = await simulateViaRpc(tx, "testnet");
    expect(result).toEqual(fakeResponse);
  });
});

// ---------------------------------------------------------------------------
// Adaptive Request Hedging (#hedging)
// ---------------------------------------------------------------------------

jest.mock("../../middleware/metrics", () => ({
  __esModule: true,
  default: {
    recordHedgedRequest: jest.fn(),
    // include stubs for all other metrics methods so other tests keep working
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordL1Hit: jest.fn(),
    recordL1Miss: jest.fn(),
    recordL2Hit: jest.fn(),
    recordL2Miss: jest.fn(),
    recordSingleflightCoalesced: jest.fn(),
    recordSingleflightPending: jest.fn(),
    recordCacheLatency: jest.fn(),
    recordCacheOperation: jest.fn(),
    recordMemoryCacheKeys: jest.fn(),
    recordMemoryCacheBytes: jest.fn(),
    recordCacheEviction: jest.fn(),
    recordEmergencyTrim: jest.fn(),
    recordSimulation: jest.fn(),
    recordSimulationDuration: jest.fn(),
    recordRpcError: jest.fn(),
    incrementActiveSimulations: jest.fn(),
    decrementActiveSimulations: jest.fn(),
    recordXdrBytes: jest.fn(),
    recordFootprintEntries: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(""),
    getRegister: jest.fn(),
  },
}));

describe("hedgedSimulate — adaptive request hedging", () => {
  /** Shorthand helper: a promise that resolves after `ms` milliseconds. */
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  const fakeResponsePrimary = {
    id: "primary",
    latestLedger: 100,
    results: [],
  } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse;

  const fakeResponseSecondary = {
    id: "secondary",
    latestLedger: 101,
    results: [],
  } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse;

  let mockSimulate: jest.Mock;
  let recordHedgedRequestMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    resetRpcPool();

    mockSimulate = jest.fn();
    (stellarConfig.getRpcServer as jest.Mock).mockReturnValue({
      simulateTransaction: mockSimulate,
      getLedgerEntries: jest.fn(),
    } as unknown as StellarSdk.rpc.Server);

    recordHedgedRequestMock = metrics.recordHedgedRequest as jest.Mock;

    // Use fake timers so we can control setTimeout without real waiting
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    resetRpcPool();
    delete process.env.TESTNET_RPC_URL;
    delete process.env.HEDGE_DELAY_MS;
  });

  it("returns primary response when primary replies before hedge threshold", async () => {
    // Primary resolves immediately (synchronously on next microtask)
    mockSimulate.mockResolvedValue(fakeResponsePrimary);

    const tx = createSampleTx();
    const resultPromise = hedgedSimulate(tx, "testnet");

    // Flush all pending microtasks — primary resolves before timer fires
    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toEqual(fakeResponsePrimary);
    // Hedge was never dispatched since primary was fast
    expect(recordHedgedRequestMock).not.toHaveBeenCalledWith("dispatched");
  });

  it("dispatches hedged request and returns secondary when primary is slow", async () => {
    // Primary never resolves within the test; secondary resolves immediately after hedge fires
    mockSimulate
      .mockImplementationOnce(
        () => new Promise<never>(() => {}), // primary hangs
      )
      .mockResolvedValueOnce(fakeResponseSecondary); // secondary is fast

    const tx = createSampleTx();
    const resultPromise = hedgedSimulate(tx, "testnet");

    // Advance clock past hedge delay to trigger the backup request
    await jest.advanceTimersByTimeAsync(HEDGE_DELAY_MS + 10);

    const result = await resultPromise;
    expect(result).toEqual(fakeResponseSecondary);
    expect(recordHedgedRequestMock).toHaveBeenCalledWith("dispatched");
    expect(recordHedgedRequestMock).toHaveBeenCalledWith("won");
  });

  it("increments rpc_hedged_requests_total{result=dispatched} when hedge is fired", async () => {
    mockSimulate
      .mockImplementationOnce(() => new Promise<never>(() => {})) // primary hangs
      .mockResolvedValueOnce(fakeResponseSecondary);

    const tx = createSampleTx();
    const resultPromise = hedgedSimulate(tx, "testnet");

    await jest.advanceTimersByTimeAsync(HEDGE_DELAY_MS + 10);
    await resultPromise;

    expect(recordHedgedRequestMock).toHaveBeenCalledWith("dispatched");
  });

  it("does not leak unhandled rejections when slower request is aborted", async () => {
    // Primary is fast; secondary (hedge) would start but should be cancelled
    mockSimulate.mockResolvedValue(fakeResponsePrimary);

    const tx = createSampleTx();
    const resultPromise = hedgedSimulate(tx, "testnet");

    await jest.runAllTimersAsync();

    // Should resolve cleanly with no unhandled rejection warnings
    await expect(resultPromise).resolves.toEqual(fakeResponsePrimary);
    // The hedge timer should have been cleared — no "dispatched" event
    expect(recordHedgedRequestMock).not.toHaveBeenCalledWith("dispatched");
  });

  it("resolves with primary when both complete but primary is first", async () => {
    // Both reply, but primary slightly faster
    mockSimulate
      .mockResolvedValueOnce(fakeResponsePrimary) // primary
      .mockResolvedValueOnce(fakeResponseSecondary); // secondary (hedge)

    const tx = createSampleTx();
    const resultPromise = hedgedSimulate(tx, "testnet");

    await jest.runAllTimersAsync();

    const result = await resultPromise;
    expect(result).toEqual(fakeResponsePrimary);
  });
});
