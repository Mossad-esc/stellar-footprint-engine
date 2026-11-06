import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer } from "../../config/stellar";
import * as cacheModule from "../../services/cache";
import {
  SOROBAN_INVOKE_XDR,
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  INVALID_BASE64_XDR,
  INVALID_XDR_BYTES,
} from "../../tests/fixtures/xdr";
import { simulateTransaction } from "../simulator";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@config/stellar", () => ({
  getNetworkConfig: jest.fn().mockReturnValue({
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrl: "https://soroban-testnet.stellar.org",
    secretKey: "",
  }),
  getRpcServer: jest.fn(),
}));

const mockFootprint = {
  readOnly: jest.fn().mockReturnValue([]),
  readWrite: jest.fn().mockReturnValue([]),
};
const mockResources = jest
  .fn()
  .mockReturnValue({ footprint: () => mockFootprint });
const mockBuild = jest.fn().mockReturnValue({
  resources: mockResources,
  auth: jest.fn().mockReturnValue([]),
});
const mockTransactionData = { build: mockBuild };

jest.mock("@stellar/stellar-sdk", () => {
  const isSimulationError = jest.fn();
  const isSimulationRestore = jest.fn();

  class FeeBumpTransaction {}

  return {
    TransactionBuilder: {
      fromXDR: jest.fn().mockReturnValue({
        operations: [{ type: "invokeHostFunction" }],
      }),
    },
    FeeBumpTransaction,
    StrKey: {
      encodeEd25519PublicKey: jest.fn().mockReturnValue("GABC"),
    },
    rpc: {
      Server: jest.fn(),
      Api: { isSimulationError, isSimulationRestore },
    },
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
      FUTURENET: "Test SDF Future Network ; October 2022",
    },
    xdr: {
      LedgerKey: {
        fromXDR: jest.fn().mockReturnValue({}),
        account: jest.fn().mockReturnValue({}),
        contractCode: jest.fn().mockReturnValue({}),
      },
      AccountId: { fromString: jest.fn().mockReturnValue({}) },
    },
  };
});

const isSimulationError = StellarSdk.rpc.Api
  .isSimulationError as unknown as jest.Mock;
const isSimulationRestore = StellarSdk.rpc.Api
  .isSimulationRestore as unknown as jest.Mock;

// ── Helpers ──────────────────────────────────────────────────────────────────

const DUMMY_XDR = INVALID_XDR_BYTES;

const mockSimulateTransaction = jest.fn();
const mockGetLedgerEntries = jest.fn();
const mockServer = {
  simulateTransaction: mockSimulateTransaction,
  getLedgerEntries: mockGetLedgerEntries,
};

const mockCacheStore = new Map<string, unknown>();
const mockCache = {
  backend: "memory" as const,
  get: jest
    .fn()
    .mockImplementation(async (key: string) => mockCacheStore.get(key) ?? null),
  set: jest.fn().mockImplementation(async (key: string, value: unknown) => {
    mockCacheStore.set(key, value);
  }),
  delete: jest.fn().mockImplementation(async (key: string) => {
    mockCacheStore.delete(key);
  }),
  flush: jest.fn().mockImplementation(async () => {
    mockCacheStore.clear();
  }),
};

jest.mock("../../services/cache", () => ({
  buildCacheKey: jest.fn((data: Record<string, unknown>) => {
    const { createHash } = require("crypto");
    const canonical = JSON.stringify(
      Object.keys(data)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = data[k];
          return acc;
        }, {}),
    );
    return createHash("sha256").update(canonical).digest("hex");
  }),
  getCache: jest.fn(() => mockCache),
  setCache: jest.fn(),
}));

function makeSuccessResponse() {
  return {
    transactionData: mockTransactionData,
    cost: { cpuInsns: "1000", memBytes: "2000" },
    error: undefined,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockCacheStore.clear();
  (getRpcServer as jest.Mock).mockReturnValue(mockServer);
  isSimulationError.mockReturnValue(false);
  isSimulationRestore.mockReturnValue(false);
  mockGetLedgerEntries.mockResolvedValue({ entries: [], latestLedger: 100 });
});

describe("simulateTransaction", () => {
  it("returns success with footprint on a valid simulation", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result.cost).toEqual({ cpuInsns: "1000", memBytes: "2000" });
    expect(result.footprint).toBeDefined();
    expect(result.rawFootprint).toBeDefined();
  });

  it("returns failure with error message on simulation error", async () => {
    const errorResponse = { error: "contract panic", raw: {} };
    isSimulationError.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue(errorResponse);

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(false);
    expect(result.error).toBe("contract panic");
    expect(result.code).toBe("RPC_SIMULATION_ERROR");
    expect(result.raw).toBeDefined();
  });

  it("returns failure on restore response", async () => {
    isSimulationRestore.mockReturnValue(true);
    mockSimulateTransaction.mockResolvedValue({ raw: {} });

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/restoration/i);
    expect(result.code).toBe("SIMULATION_RESTORE_REQUIRED");
  });

  it("returns failure when transactionData is missing", async () => {
    mockSimulateTransaction.mockResolvedValue({
      transactionData: undefined,
      cost: { cpuInsns: "0", memBytes: "0" },
    });

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/transactionData is missing/i);
    expect(result.code).toBe("SIMULATION_DATA_MISSING");
  });

  it("propagates SDK throw as unhandled rejection", async () => {
    mockSimulateTransaction.mockRejectedValue(new Error("network timeout"));

    await expect(simulateTransaction(DUMMY_XDR, "testnet")).rejects.toThrow(
      "network timeout",
    );
  });

  it("returns empty contracts array when footprint is empty", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result.contracts).toEqual([]);
  });

  it("passes ledgerSequence to simulateTransaction options when provided", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    await simulateTransaction(DUMMY_XDR, "testnet", undefined, 999);

    const callArgs = mockSimulateTransaction.mock.calls[0];
    expect(callArgs[1]).toMatchObject({ ledger: 999 });
  });

  it("does not include ledger option when ledgerSequence is undefined", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    await simulateTransaction(DUMMY_XDR, "testnet");

    const callArgs = mockSimulateTransaction.mock.calls[0];
    expect(callArgs[1]).not.toHaveProperty("ledger");
  });

  it("uses mainnet network config when network is mainnet", async () => {
    const { getRpcServer: mockGetRpcServer } =
      jest.requireMock("@config/stellar");
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    await simulateTransaction(DUMMY_XDR, "mainnet");

    expect(mockGetRpcServer).toHaveBeenCalledWith("mainnet");
  });

  // ── Fixture-based tests ───────────────────────────────────────────────────

  it("accepts SOROBAN_INVOKE_XDR fixture and returns success", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(SOROBAN_INVOKE_XDR, "testnet");

    expect(result.success).toBe(true);
  });

  it("accepts CLASSIC_PAYMENT_XDR fixture without throwing", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(CLASSIC_PAYMENT_XDR, "testnet");

    expect(result.success).toBe(true);
  });

  it("accepts FEE_BUMP_XDR fixture without throwing", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(FEE_BUMP_XDR, "testnet");

    expect(result.success).toBe(true);
  });

  it("propagates error when INVALID_BASE64_XDR is passed to the SDK", async () => {
    const { TransactionBuilder } = jest.requireMock("@stellar/stellar-sdk");
    TransactionBuilder.fromXDR.mockImplementationOnce(() => {
      throw new Error("invalid base64");
    });

    await expect(
      simulateTransaction(INVALID_BASE64_XDR, "testnet"),
    ).rejects.toThrow("invalid base64");
  });

  // ── #429: TTL expiry warnings ─────────────────────────────────────────────

  it("returns warnings for footprint entries expiring in < 100 ledgers", async () => {
    // Set up a non-empty footprint so TTL lookup is triggered
    const mockEntry = { toXDR: jest.fn().mockReturnValue("AAAA") };
    mockFootprint.readOnly.mockReturnValueOnce([mockEntry]);
    mockFootprint.readWrite.mockReturnValueOnce([]);
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());
    // Entry expires in 49 ledgers (liveUntil=150, current=101)
    mockGetLedgerEntries.mockResolvedValueOnce({
      entries: [{ liveUntilLedgerSeq: 150 }],
      latestLedger: 101,
    });

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings!.length).toBeGreaterThan(0);
    expect(result.warnings![0]).toMatch(/expires in 49 ledgers/i);
  });

  it("returns empty warnings when all entries have >= 100 ledgers remaining", async () => {
    const mockEntry = { toXDR: jest.fn().mockReturnValue("AAAA") };
    mockFootprint.readOnly.mockReturnValueOnce([mockEntry]);
    mockFootprint.readWrite.mockReturnValueOnce([]);
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());
    mockGetLedgerEntries.mockResolvedValueOnce({
      entries: [{ liveUntilLedgerSeq: 300 }],
      latestLedger: 100,
    });

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("returns empty warnings when TTL fetch returns no entries", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());
    mockGetLedgerEntries.mockResolvedValueOnce({
      entries: [],
      latestLedger: 100,
    });

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.warnings).toEqual([]);
  });

  // ── #359: parallelised TTL fetch and contract type detection ─────────────

  it("returns both ttl and contractType fields in a successful response", async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result).toHaveProperty("ttl");
    expect(result).toHaveProperty("contractType");
  });

  it("resolves ttl and contractType even when getLedgerEntries returns no entries", async () => {
    mockGetLedgerEntries.mockResolvedValue({ entries: [], latestLedger: 50 });
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());

    const result = await simulateTransaction(DUMMY_XDR, "testnet");

    expect(result.success).toBe(true);
    expect(result.ttl).toBeDefined();
    expect(result.contractType).toBeDefined();
  });
});
