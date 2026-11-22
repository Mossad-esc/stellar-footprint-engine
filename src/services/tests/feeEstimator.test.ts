import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer } from "../../config/stellar";
import { estimateFee, estimateFeeDetailed } from "../feeEstimator";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@config/stellar", () => ({
  getRpcServer: jest.fn(),
  getNetworkConfig: jest.fn().mockReturnValue({
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
}));

const mockGetFeeStats = jest.fn();
const mockServer = {
  getFeeStats: mockGetFeeStats,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockFeeStats(p50: string) {
  mockGetFeeStats.mockResolvedValue({
    sorobanInclusionFee: { p50 },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  (getRpcServer as jest.Mock).mockReturnValue(mockServer);
  // Default: 100 stroops inclusion fee
  mockFeeStats("100");
});

describe("estimateFee", () => {
  // ── Basic fee calculation ──────────────────────────────────────────────────

  it("calculates fee with known CPU and memory values", async () => {
    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
    // CPU: ceil(10000/10000) * 25 = 25
    // Memory write: 1000 * 1000 = 1,000,000
    // Memory read: 1000 * 250 = 250,000
    // Overhead: 300 * (100 + 100) = 60,000
    // Total resource: 25 + 1,000,000 + 250,000 + 60,000 = 1,310,025
    expect(result.resourceFee).toBe("1310025");
    expect(result.totalFee).toBe("1310125");
    expect(result.feeInXLM).toBe("0.1310125");
  });

  it("calculates fee with zero CPU instructions", async () => {
    const result = await estimateFee("0", "500", "testnet");

    expect(result.baseFee).toBe("100");
    // CPU: 0
    // Memory write: 500 * 1000 = 500,000
    // Memory read: 500 * 250 = 125,000
    // Overhead: 300 * 200 = 60,000
    // Total resource: 685,000
    expect(result.resourceFee).toBe("685000");
    expect(result.totalFee).toBe("685100");
    expect(result.feeInXLM).toBe("0.0685100");
  });

  it("calculates fee with zero memory bytes", async () => {
    const result = await estimateFee("50000", "0", "testnet");

    expect(result.baseFee).toBe("100");
    // CPU: ceil(50000/10000) * 25 = 5 * 25 = 125
    // Memory write: 0
    // Memory read: 0
    // Overhead: 60,000
    // Total resource: 60,125
    expect(result.resourceFee).toBe("60125");
    expect(result.totalFee).toBe("60225");
    expect(result.feeInXLM).toBe("0.0060225");
  });

  it("calculates fee with both CPU and memory at zero", async () => {
    const result = await estimateFee("0", "0", "testnet");

    expect(result.baseFee).toBe("100");
    // Only overhead: 60,000
    expect(result.resourceFee).toBe("60000");
    expect(result.totalFee).toBe("60100");
    expect(result.feeInXLM).toBe("0.0060100");
  });

  // ── Boundary values ────────────────────────────────────────────────────────

  it("handles very large CPU instruction count", async () => {
    const result = await estimateFee("100000000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
    // CPU: ceil(100000000/10000) * 25 = 10000 * 25 = 250,000
    // Memory write: 1,000,000
    // Memory read: 250,000
    // Overhead: 60,000
    // Total resource: 1,560,000
    expect(result.resourceFee).toBe("1560000");
    expect(result.totalFee).toBe("1560100");
  });

  it("handles very large memory byte count", async () => {
    const result = await estimateFee("10000", "1000000", "testnet");

    expect(result.baseFee).toBe("100");
    // CPU: 25
    // Memory write: 1,000,000 * 1000 = 1,000,000,000
    // Memory read: 1,000,000 * 250 = 250,000,000
    // Overhead: 60,000
    // Total resource: 1,250,060,025
    expect(result.resourceFee).toBe("1250060025");
    expect(result.totalFee).toBe("1250060125");
  });

  it("handles maximum safe integer values", async () => {
    const maxSafe = "9007199254740991"; // Number.MAX_SAFE_INTEGER
    const result = await estimateFee(maxSafe, maxSafe, "testnet");

    expect(result.baseFee).toBe("100");
    expect(result.resourceFee).toBeDefined();
    expect(result.totalFee).toBeDefined();
    expect(result.feeInXLM).toBeDefined();
  });

  // ── CPU instruction rounding ───────────────────────────────────────────────

  it("rounds up CPU instructions to next increment (9999 -> 10000)", async () => {
    const result = await estimateFee("9999", "0", "testnet");

    // CPU: ceil(9999/10000) * 25 = 1 * 25 = 25
    expect(result.resourceFee).toBe("60025");
  });

  it("rounds up CPU instructions to next increment (10001 -> 20000)", async () => {
    const result = await estimateFee("10001", "0", "testnet");

    // CPU: ceil(10001/10000) * 25 = 2 * 25 = 50
    expect(result.resourceFee).toBe("60050");
  });

  it("does not round when CPU is exact multiple of increment", async () => {
    const result = await estimateFee("20000", "0", "testnet");

    // CPU: ceil(20000/10000) * 25 = 2 * 25 = 50
    expect(result.resourceFee).toBe("60050");
  });

  // ── Network-specific inclusion fees ────────────────────────────────────────

  it("uses testnet inclusion fee from RPC", async () => {
    mockFeeStats("150");

    const result = await estimateFee("10000", "1000", "testnet");

    expect(getRpcServer).toHaveBeenCalledWith("testnet");
    expect(result.baseFee).toBe("150");
    expect(result.totalFee).toBe("1310175");
  });

  it("uses mainnet inclusion fee from RPC", async () => {
    mockFeeStats("200");

    const result = await estimateFee("10000", "1000", "mainnet");

    expect(getRpcServer).toHaveBeenCalledWith("mainnet");
    expect(result.baseFee).toBe("200");
    expect(result.totalFee).toBe("1310225");
  });

  it("uses futurenet inclusion fee from RPC", async () => {
    mockFeeStats("75");

    const result = await estimateFee("10000", "1000", "futurenet");

    expect(getRpcServer).toHaveBeenCalledWith("futurenet");
    expect(result.baseFee).toBe("75");
    expect(result.totalFee).toBe("1310100");
  });

  it("defaults to testnet when network is not specified", async () => {
    mockFeeStats("100");

    const result = await estimateFee("10000", "1000");

    expect(getRpcServer).toHaveBeenCalledWith("testnet");
    expect(result.baseFee).toBe("100");
  });

  // ── RPC failure handling ───────────────────────────────────────────────────

  it("falls back to 100 stroops when RPC getFeeStats fails", async () => {
    mockGetFeeStats.mockRejectedValue(new Error("RPC timeout"));

    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
    expect(result.totalFee).toBe("1310125");
  });

  it("falls back to 100 stroops when p50 is missing", async () => {
    mockGetFeeStats.mockResolvedValue({
      sorobanInclusionFee: {},
    });

    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
  });

  it("falls back to 100 stroops when p50 is zero", async () => {
    mockFeeStats("0");

    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
  });

  it("falls back to 100 stroops when p50 is negative", async () => {
    mockFeeStats("-50");

    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
  });

  // ── XLM conversion ─────────────────────────────────────────────────────────

  it("converts stroops to XLM with correct decimal places", async () => {
    mockFeeStats("1000000"); // 0.1 XLM

    const result = await estimateFee("10000", "1000", "testnet");

    expect(result.feeInXLM).toMatch(/^\d+\.\d{7}$/);
    expect(result.feeInXLM).toBe("0.2310025");
  });

  it("pads XLM fractional part with leading zeros", async () => {
    mockFeeStats("100");

    const result = await estimateFee("0", "0", "testnet");

    // Total: 60,100 stroops = 0.0060100 XLM
    expect(result.feeInXLM).toBe("0.0060100");
  });

  it("formats XLM correctly for fees >= 1 XLM", async () => {
    mockFeeStats("10000000"); // 1 XLM

    const result = await estimateFee("100000000", "10000", "testnet");

    // Should be > 1 XLM
    expect(result.feeInXLM).toMatch(/^\d+\.\d{7}$/);
    const xlmValue = parseFloat(result.feeInXLM);
    expect(xlmValue).toBeGreaterThan(1);
  });

  // ── String input handling ──────────────────────────────────────────────────

  it("accepts CPU and memory as string numbers", async () => {
    const result = await estimateFee("12345", "6789", "testnet");

    expect(result.baseFee).toBeDefined();
    expect(result.resourceFee).toBeDefined();
    expect(result.totalFee).toBeDefined();
  });

  it("handles string numbers with leading zeros", async () => {
    const result = await estimateFee("00010000", "00001000", "testnet");

    expect(result.resourceFee).toBe("1310025");
  });
});

describe("estimateFeeDetailed", () => {
  // ── Detailed breakdown ─────────────────────────────────────────────────────

  it("returns detailed fee breakdown with all components", async () => {
    const result = await estimateFeeDetailed("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
    expect(result.resourceFee).toBe("1310025");
    expect(result.inclusionFee).toBe("100");
    expect(result.totalStroops).toBe("1310125");
    expect(result.totalXlm).toBe("0.1310125");

    expect(result.breakdown.cpuFee).toBe("25");
    expect(result.breakdown.memoryFee).toBe("1000000");
    expect(result.breakdown.readFee).toBe("250000");
    expect(result.breakdown.overheadFee).toBe("60000");
  });

  it("breaks down CPU fee correctly", async () => {
    const result = await estimateFeeDetailed("50000", "0", "testnet");

    // CPU: ceil(50000/10000) * 25 = 5 * 25 = 125
    expect(result.breakdown.cpuFee).toBe("125");
  });

  it("breaks down memory write fee correctly", async () => {
    const result = await estimateFeeDetailed("0", "2000", "testnet");

    // Memory write: 2000 * 1000 = 2,000,000
    expect(result.breakdown.memoryFee).toBe("2000000");
  });

  it("breaks down read fee correctly", async () => {
    const result = await estimateFeeDetailed("0", "4000", "testnet");

    // Read: 4000 * 250 = 1,000,000
    expect(result.breakdown.readFee).toBe("1000000");
  });

  it("includes overhead fee in breakdown", async () => {
    const result = await estimateFeeDetailed("0", "0", "testnet");

    // Overhead: 300 * (100 + 100) = 60,000
    expect(result.breakdown.overheadFee).toBe("60000");
  });

  it("sums breakdown components to match resourceFee", async () => {
    const result = await estimateFeeDetailed("25000", "3000", "testnet");

    const cpuFee = BigInt(result.breakdown.cpuFee);
    const memoryFee = BigInt(result.breakdown.memoryFee);
    const readFee = BigInt(result.breakdown.readFee);
    const overheadFee = BigInt(result.breakdown.overheadFee);

    const sum = cpuFee + memoryFee + readFee + overheadFee;
    expect(sum.toString()).toBe(result.resourceFee);
  });

  // ── Boundary values ────────────────────────────────────────────────────────

  it("handles zero values in detailed breakdown", async () => {
    const result = await estimateFeeDetailed("0", "0", "testnet");

    expect(result.breakdown.cpuFee).toBe("0");
    expect(result.breakdown.memoryFee).toBe("0");
    expect(result.breakdown.readFee).toBe("0");
    expect(result.breakdown.overheadFee).toBe("60000");
  });

  it("handles very large values in detailed breakdown", async () => {
    const result = await estimateFeeDetailed(
      "1000000000",
      "5000000",
      "testnet",
    );

    expect(result.breakdown.cpuFee).toBeDefined();
    expect(result.breakdown.memoryFee).toBeDefined();
    expect(result.breakdown.readFee).toBeDefined();
    expect(result.breakdown.overheadFee).toBe("60000");

    // Verify all are numeric strings
    expect(BigInt(result.breakdown.cpuFee)).toBeGreaterThan(0n);
    expect(BigInt(result.breakdown.memoryFee)).toBeGreaterThan(0n);
    expect(BigInt(result.breakdown.readFee)).toBeGreaterThan(0n);
  });

  // ── Network-specific fees ──────────────────────────────────────────────────

  it("uses correct inclusion fee for mainnet", async () => {
    mockFeeStats("250");

    const result = await estimateFeeDetailed("10000", "1000", "mainnet");

    expect(result.baseFee).toBe("250");
    expect(result.inclusionFee).toBe("250");
    expect(getRpcServer).toHaveBeenCalledWith("mainnet");
  });

  it("uses correct inclusion fee for futurenet", async () => {
    mockFeeStats("50");

    const result = await estimateFeeDetailed("10000", "1000", "futurenet");

    expect(result.baseFee).toBe("50");
    expect(result.inclusionFee).toBe("50");
    expect(getRpcServer).toHaveBeenCalledWith("futurenet");
  });

  // ── Consistency with estimateFee ───────────────────────────────────────────

  it("returns same totalStroops as estimateFee totalFee", async () => {
    const simple = await estimateFee("15000", "2500", "testnet");
    const detailed = await estimateFeeDetailed("15000", "2500", "testnet");

    expect(detailed.totalStroops).toBe(simple.totalFee);
  });

  it("returns same totalXlm as estimateFee feeInXLM", async () => {
    const simple = await estimateFee("20000", "3000", "mainnet");
    const detailed = await estimateFeeDetailed("20000", "3000", "mainnet");

    expect(detailed.totalXlm).toBe(simple.feeInXLM);
  });

  it("returns same baseFee as estimateFee", async () => {
    mockFeeStats("175");

    const simple = await estimateFee("10000", "1000", "testnet");
    const detailed = await estimateFeeDetailed("10000", "1000", "testnet");

    expect(detailed.baseFee).toBe(simple.baseFee);
  });

  it("returns same resourceFee as estimateFee", async () => {
    const simple = await estimateFee("30000", "4000", "testnet");
    const detailed = await estimateFeeDetailed("30000", "4000", "testnet");

    expect(detailed.resourceFee).toBe(simple.resourceFee);
  });

  // ── RPC failure handling ───────────────────────────────────────────────────

  it("falls back to 100 stroops inclusion fee on RPC error", async () => {
    mockGetFeeStats.mockRejectedValue(new Error("Network error"));

    const result = await estimateFeeDetailed("10000", "1000", "testnet");

    expect(result.baseFee).toBe("100");
    expect(result.inclusionFee).toBe("100");
  });
});

describe("footprint bandwidth fees", () => {
  it("charges the exact serialized size consistently in both estimators", async () => {
    const footprint = {
      readOnly: ["AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC"],
      readWrite: [],
    };
    const simple = await estimateFee("0", "0", "testnet", { footprint });
    const detailed = await estimateFeeDetailed("0", "0", "testnet", {
      footprint,
    });
    // 36-byte code key plus two four-byte vector prefixes.
    expect(detailed.breakdown.overheadFee).toBe(String((300 + 44) * 200));
    expect(simple.totalFee).toBe(detailed.totalStroops);
  });
});

describe("maintenance operation fees", () => {
  const code = "AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";
  const instance =
    "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
  const settings = [
    {
      name: "configSettingContractComputeV0",
      contractCompute: () => ({ feeRatePerInstructionsIncrement: () => "25" }),
    },
    {
      name: "configSettingContractLedgerCostV0",
      contractLedgerCost: () => ({
        feeWriteLedgerEntry: () => "20",
        feeDiskReadLedgerEntry: () => "10",
        feeDiskRead1Kb: () => "50",
      }),
    },
    {
      name: "configSettingContractLedgerCostExtV0",
      contractLedgerCostExt: () => ({ feeWrite1Kb: () => "100" }),
    },
    {
      name: "configSettingContractHistoricalDataV0",
      contractHistoricalData: () => ({ feeHistorical1Kb: () => "5" }),
    },
    {
      name: "configSettingContractBandwidthV0",
      contractBandwidth: () => ({ feeTxSize1Kb: () => "10" }),
    },
  ];
  const mockSimulate = jest.fn();
  const mockEntries = jest.fn();
  beforeEach(() => {
    (getRpcServer as jest.Mock).mockReturnValue({
      getFeeStats: mockGetFeeStats,
      simulateTransaction: mockSimulate,
      getLedgerEntries: mockEntries,
    });
    mockEntries.mockResolvedValue({
      entries: settings.map((setting) => ({
        val: {
          configSetting: () => ({
            ...setting,
            switch: () => ({ name: setting.name }),
          }),
        },
      })),
    });
  });
  function simulation(bytes: number, fee: string, restoring = true) {
    const keys = [instance, code].map((k) =>
      StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
    );
    const data = new StellarSdk.SorobanDataBuilder()
      .setFootprint(restoring ? [] : keys, restoring ? keys : [])
      .setResources(0, restoring ? bytes : 0, restoring ? bytes : 0)
      .setResourceFee(fee);
    mockSimulate.mockResolvedValue({
      transactionData: data,
      minResourceFee: fee,
      latestLedger: 12345,
    });
  }
  it.each([1024, 8192])(
    "prices restoring %i bytes using current network write rates and RPC rent",
    async (bytes) => {
      simulation(bytes, String(bytes * 10));
      const result = await estimateFee("99999", "0", "testnet", {
        operationType: "restore",
        footprint: { readOnly: [], readWrite: [instance, code] },
      });
      expect(result.operationType).toBe("restore");
      expect(result.breakdown?.writeFee).toBe(
        String(40 + (bytes / 1024) * 100),
      );
      expect(result.resourceFee).toBe(String(bytes * 10));
      expect(result.totalFee).toBe(String(100 + bytes * 10));
      const parts = result.breakdown;
      expect(
        BigInt(parts?.writeFee ?? "0") +
          BigInt(parts?.refundableFee ?? "0") +
          BigInt(parts?.otherResourceFee ?? "0"),
      ).toBe(BigInt(result.resourceFee));
      expect(BigInt(parts?.refundableFee ?? "0")).toBeGreaterThan(0n);
      const tx = mockSimulate.mock.calls[0][0] as StellarSdk.Transaction;
      expect(tx.operations[0].type).toBe("restoreFootprint");
      expect(
        tx
          .toEnvelope()
          .v1()
          .tx()
          .ext()
          .sorobanData()
          .resources()
          .footprint()
          .readWrite()
          .map((k) => k.toXDR("base64")),
      ).toEqual([instance, code]);
    },
  );
  it("supports extension without charging writes of the contract entries", async () => {
    simulation(0, "5000", false);
    const result = await estimateFee("0", "0", "testnet", {
      operationType: "extend",
      footprint: { readOnly: [instance, code], readWrite: [] },
      extendTo: 4096,
    });
    expect(result.breakdown?.writeFee).toBe("0");
    expect(result.totalFee).toBe("5100");
    const tx = mockSimulate.mock.calls.at(-1)?.[0] as StellarSdk.Transaction;
    expect(tx.operations[0]).toMatchObject({
      type: "extendFootprintTtl",
      extendTo: 4096,
    });
  });
  it("accepts ready to sign restore XDR and clamps the inclusion fee to the minimum", async () => {
    simulation(1024, "10000");
    mockFeeStats("50");
    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(StellarSdk.Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();
    const result = await estimateFee("0", "0", "testnet", {
      operationType: "restore",
      xdr: tx.toXDR(),
    });
    expect(result.baseFee).toBe("100");
    expect(result.resourceFee).toBe("10000");
  });
  it("rejects missing ledger keys, extension duration and mismatched operations", async () => {
    await expect(
      estimateFee("0", "0", "testnet", { operationType: "restore" }),
    ).rejects.toThrow(/xdr or footprint/);
    await expect(
      estimateFee("0", "0", "testnet", {
        operationType: "extend",
        footprint: { readOnly: [], readWrite: [] },
      }),
    ).rejects.toThrow(/extendTo/);
    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(StellarSdk.Keypair.random().publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(StellarSdk.Operation.restoreFootprint({}))
      .setTimeout(30)
      .build();
    await expect(
      estimateFee("0", "0", "testnet", {
        operationType: "extend",
        xdr: tx.toXDR(),
      }),
    ).rejects.toThrow(/extendFootprintTtl/);
  });
  it("propagates RPC failures and missing network fee settings", async () => {
    const options = {
      operationType: "restore" as const,
      footprint: { readOnly: [], readWrite: [code] },
    };
    mockSimulate.mockResolvedValue({ error: "Restoration simulation failed" });
    await expect(estimateFee("0", "0", "testnet", options)).rejects.toThrow(
      /simulation failed/,
    );
    simulation(1024, "10000");
    mockEntries.mockResolvedValue({ entries: [] });
    await expect(estimateFee("0", "0", "testnet", options)).rejects.toThrow(
      /setting unavailable/,
    );
  });
});

describe("edge cases and Stellar Core fee formula verification", () => {
  const code = "AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";
  const instance =
    "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
  const settings = [
    {
      name: "configSettingContractComputeV0",
      contractCompute: () => ({ feeRatePerInstructionsIncrement: () => "25" }),
    },
    {
      name: "configSettingContractLedgerCostV0",
      contractLedgerCost: () => ({
        feeWriteLedgerEntry: () => "20",
        feeDiskReadLedgerEntry: () => "10",
        feeDiskRead1Kb: () => "50",
      }),
    },
    {
      name: "configSettingContractLedgerCostExtV0",
      contractLedgerCostExt: () => ({ feeWrite1Kb: () => "100" }),
    },
    {
      name: "configSettingContractHistoricalDataV0",
      contractHistoricalData: () => ({ feeHistorical1Kb: () => "5" }),
    },
    {
      name: "configSettingContractBandwidthV0",
      contractBandwidth: () => ({ feeTxSize1Kb: () => "10" }),
    },
  ];
  const mockSimulate = jest.fn();
  const mockEntries = jest.fn();

  beforeEach(() => {
    (getRpcServer as jest.Mock).mockReturnValue({
      getFeeStats: mockGetFeeStats,
      simulateTransaction: mockSimulate,
      getLedgerEntries: mockEntries,
    });
    mockEntries.mockResolvedValue({
      entries: settings.map((setting) => ({
        val: {
          configSetting: () => ({
            ...setting,
            switch: () => ({ name: setting.name }),
          }),
        },
      })),
    });
  });

  function mockMaintenanceSimulation(
    bytes: number,
    fee: string,
    restoring = true,
  ) {
    const keys = [instance, code].map((k) =>
      StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
    );
    const data = new StellarSdk.SorobanDataBuilder()
      .setFootprint(restoring ? [] : keys, restoring ? keys : [])
      .setResources(0, restoring ? bytes : 0, restoring ? bytes : 0)
      .setResourceFee(fee);
    mockSimulate.mockResolvedValue({
      transactionData: data,
      minResourceFee: fee,
      latestLedger: 12345,
    });
  }

  describe("zero instructions and zero memory bytes", () => {
    it("computes only overhead fee when CPU and memory are zero in detailed breakdown", async () => {
      mockFeeStats("100");
      const detailed = await estimateFeeDetailed("0", "0", "testnet");

      expect(detailed.breakdown.cpuFee).toBe("0");
      expect(detailed.breakdown.memoryFee).toBe("0");
      expect(detailed.breakdown.readFee).toBe("0");
      expect(detailed.breakdown.overheadFee).toBe("60000");
      expect(detailed.resourceFee).toBe("60000");
      expect(detailed.totalStroops).toBe("60100");
    });

    it("falls back to minimum base fee when RPC returns 0 inclusion fee with zero resources", async () => {
      mockFeeStats("0");
      const result = await estimateFee("0", "0", "testnet");

      expect(result.baseFee).toBe("100");
      expect(result.resourceFee).toBe("60000");
      expect(result.totalFee).toBe("60100");
    });
  });

  describe("maximum contract CPU instructions boundary (100M)", () => {
    it.each([
      { cpu: "99999999", expectedCpuFee: "250000" },
      { cpu: "100000000", expectedCpuFee: "250000" },
      { cpu: "100000001", expectedCpuFee: "250025" },
    ])(
      "prices $cpu CPU instructions accurately at the 100M boundary",
      async ({ cpu, expectedCpuFee }) => {
        const detailed = await estimateFeeDetailed(cpu, "0", "testnet");
        const simple = await estimateFee(cpu, "0", "testnet");

        expect(detailed.breakdown.cpuFee).toBe(expectedCpuFee);
        expect(detailed.resourceFee).toBe(
          String(BigInt(expectedCpuFee) + 60000n),
        );
        expect(simple.resourceFee).toBe(detailed.resourceFee);
        expect(simple.totalFee).toBe(detailed.totalStroops);
      },
    );
  });

  describe("fee-bump transaction envelopes", () => {
    function buildFeeBumpXdr(op: StellarSdk.xdr.Operation): string {
      const innerSource = StellarSdk.Keypair.random();
      const feeSource = StellarSdk.Keypair.random();
      const innerTx = new StellarSdk.TransactionBuilder(
        new StellarSdk.Account(innerSource.publicKey(), "1"),
        { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
      )
        .addOperation(op)
        .setTimeout(30)
        .build();
      innerTx.sign(innerSource);

      const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
        feeSource.publicKey(),
        "1000",
        innerTx,
        StellarSdk.Networks.TESTNET,
      );
      feeBumpTx.sign(feeSource);
      return feeBumpTx.toXDR();
    }

    it("unwraps inner restoreFootprint transaction from a fee-bump envelope", async () => {
      mockMaintenanceSimulation(1024, "10000", true);
      const xdr = buildFeeBumpXdr(StellarSdk.Operation.restoreFootprint({}));

      const result = await estimateFee("0", "0", "testnet", {
        operationType: "restore",
        xdr,
      });

      expect(result.operationType).toBe("restore");
      expect(result.resourceFee).toBe("10000");
      expect(result.baseFee).toBe("100");
      expect(result.totalFee).toBe("10100");
      const simulatedTx = mockSimulate.mock
        .calls[0][0] as StellarSdk.Transaction;
      expect(simulatedTx.operations[0].type).toBe("restoreFootprint");
    });

    it("unwraps inner extendFootprintTtl transaction from a fee-bump envelope", async () => {
      mockMaintenanceSimulation(0, "5000", false);
      const xdr = buildFeeBumpXdr(
        StellarSdk.Operation.extendFootprintTtl({ extendTo: 2048 }),
      );

      const result = await estimateFee("0", "0", "testnet", {
        operationType: "extend",
        xdr,
      });

      expect(result.operationType).toBe("extend");
      expect(result.breakdown?.writeFee).toBe("0");
      expect(result.totalFee).toBe("5100");
    });

    it("rejects fee-bump envelope whose inner operation does not match operationType", async () => {
      const xdr = buildFeeBumpXdr(StellarSdk.Operation.restoreFootprint({}));

      await expect(
        estimateFee("0", "0", "testnet", {
          operationType: "extend",
          xdr,
        }),
      ).rejects.toThrow(/extendFootprintTtl/);
    });
  });

  describe("refundable vs non-refundable fee portions", () => {
    it("partitions resource fee into writeFee, otherResourceFee, and refundableFee", async () => {
      mockMaintenanceSimulation(2048, "15000", true);

      const result = await estimateFee("0", "0", "testnet", {
        operationType: "restore",
        footprint: { readOnly: [], readWrite: [instance, code] },
      });

      const writeFee = BigInt(result.breakdown?.writeFee ?? "0");
      const otherResourceFee = BigInt(
        result.breakdown?.otherResourceFee ?? "0",
      );
      const refundableFee = BigInt(result.breakdown?.refundableFee ?? "0");

      // 2 entries * 20 + ceil(2048 / 1024) * 100 = 40 + 200 = 240
      expect(writeFee).toBe(240n);
      expect(otherResourceFee).toBeGreaterThan(0n);
      expect(refundableFee).toBe(15000n - writeFee - otherResourceFee);
      expect(writeFee + otherResourceFee + refundableFee).toBe(
        BigInt(result.resourceFee),
      );
    });

    it("handles zero refundable fee when minResourceFee equals non-refundable fee", async () => {
      // First call with generous fee to discover exact non-refundable cost
      mockMaintenanceSimulation(1024, "100000", true);
      const probe = await estimateFee("0", "0", "testnet", {
        operationType: "restore",
        footprint: { readOnly: [], readWrite: [instance, code] },
      });
      const nonRefundable =
        BigInt(probe.breakdown?.writeFee ?? "0") +
        BigInt(probe.breakdown?.otherResourceFee ?? "0");

      mockMaintenanceSimulation(1024, nonRefundable.toString(), true);
      const exact = await estimateFee("0", "0", "testnet", {
        operationType: "restore",
        footprint: { readOnly: [], readWrite: [instance, code] },
      });

      expect(exact.breakdown?.refundableFee).toBe("0");
      expect(exact.resourceFee).toBe(nonRefundable.toString());
    });

    it("throws when RPC minResourceFee is below non-refundable network fee", async () => {
      mockMaintenanceSimulation(1024, "1", true);

      await expect(
        estimateFee("0", "0", "testnet", {
          operationType: "restore",
          footprint: { readOnly: [], readWrite: [instance, code] },
        }),
      ).rejects.toThrow(/inconsistent with current network fee settings/);
    });

    it("rounds write and read fees up using 1024-byte increments", async () => {
      mockMaintenanceSimulation(1025, "50000", true);

      const result = await estimateFee("0", "0", "testnet", {
        operationType: "restore",
        footprint: { readOnly: [], readWrite: [instance, code] },
      });

      // ceil(1025 * 100 / 1024) = 101, plus 2 * 20 = 141
      expect(result.breakdown?.writeFee).toBe("141");
    });
  });

  describe("CAP-0046 Stellar Core fee formula verification", () => {
    it.each([
      { cpu: 1n, mem: 1n, p50: 100n },
      { cpu: 10_000n, mem: 512n, p50: 250n },
      { cpu: 10_001n, mem: 1_024n, p50: 500n },
      { cpu: 50_000_000n, mem: 65_536n, p50: 1_200n },
    ])(
      "matches CAP-0046 resource fee formula for cpu=$cpu mem=$mem",
      async ({ cpu, mem, p50 }) => {
        mockFeeStats(p50.toString());
        const expectedCpuFee = ((cpu + 9_999n) / 10_000n) * 25n;
        const expectedMemFee = mem * 1_000n;
        const expectedReadFee = mem * 250n;
        const expectedOverhead = 300n * (100n + 100n);
        const expectedResource =
          expectedCpuFee + expectedMemFee + expectedReadFee + expectedOverhead;

        const detailed = await estimateFeeDetailed(
          cpu.toString(),
          mem.toString(),
          "testnet",
        );

        expect(detailed.breakdown.cpuFee).toBe(expectedCpuFee.toString());
        expect(detailed.breakdown.memoryFee).toBe(expectedMemFee.toString());
        expect(detailed.breakdown.readFee).toBe(expectedReadFee.toString());
        expect(detailed.breakdown.overheadFee).toBe(expectedOverhead.toString());
        expect(detailed.resourceFee).toBe(expectedResource.toString());
        expect(detailed.totalStroops).toBe((p50 + expectedResource).toString());
      },
    );
  });
});
