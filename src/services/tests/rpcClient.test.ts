import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import {
  fetchTtlInfo,
  guardPayloadSize,
  parseRpcUrls,
  resetRpcPool,
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
// #65 — guardPayloadSize unit tests
// ---------------------------------------------------------------------------

describe("guardPayloadSize", () => {
  // Minimal simulate response shape accepted by the guard
  function makeResponse(
    overrides: Record<string, unknown> = {},
  ): StellarSdk.rpc.Api.SimulateTransactionResponse {
    return {
      latestLedger: 100,
      minResourceFee: "1000",
      transactionData: "",
      events: [],
      ...overrides,
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse;
  }

  it("returns the response unchanged when it is below the warn threshold", () => {
    const response = makeResponse();
    expect(guardPayloadSize(response)).toBe(response);
  });

  it("throws with RPC_PAYLOAD_TOO_LARGE when payload exceeds the max limit", () => {
    // Build a response whose JSON exceeds RPC_MAX_PAYLOAD_BYTES (10 MB)
    const bigEvents = Array.from({ length: 200_000 }, (_, i) => ({
      id: `event-${i}`,
      data: "x".repeat(60),
    }));
    const response = makeResponse({ events: bigEvents });

    expect(() => guardPayloadSize(response)).toThrow(/payload too large/i);
    try {
      guardPayloadSize(response);
    } catch (err) {
      expect((err as { code?: string }).code).toBe("RPC_PAYLOAD_TOO_LARGE");
    }
  });

  it("truncates events and returns a new response object when payload exceeds the warn threshold but is under the hard limit", () => {
    // Build a response whose JSON is > 2 MB but < 10 MB
    // 60 events × 40 KB each ≈ 2.4 MB
    const bigEvents = Array.from({ length: 60 }, (_, i) => ({
      id: `event-${i}`,
      data: "x".repeat(40_000),
    }));
    const response = makeResponse({ events: bigEvents });
    const result = guardPayloadSize(response);

    // Should have been truncated to RPC_DIAGNOSTIC_EVENT_TRUNCATION_LIMIT (50)
    expect(
      (result as unknown as { events: unknown[] }).events.length,
    ).toBeLessThanOrEqual(50);
    // Essential footprint fields must be preserved
    expect(result.latestLedger).toBe(100);
    expect(result.minResourceFee).toBe("1000");
  });

  it("does not truncate events when count is already within the limit", () => {
    // 10 events × 40 KB each ≈ 400 KB (above 2 MB threshold only if padded)
    // We simulate a payload just above warn threshold with few events
    const bigEvents = Array.from({ length: 10 }, (_, i) => ({
      id: `event-${i}`,
      data: "x".repeat(220_000), // ~2.2 MB total
    }));
    const response = makeResponse({ events: bigEvents });
    const result = guardPayloadSize(response);

    // 10 events is under the truncation limit of 50 so the array stays intact
    expect((result as unknown as { events: unknown[] }).events.length).toBe(10);
  });
});
