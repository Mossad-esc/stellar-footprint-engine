import { getRpcServer } from "../../config/stellar";
import { estimateFee, estimateFeeDetailed } from "../feeEstimator";

// ── Mocks ────────────────────────────────────────────────────────────────────

jest.mock("@config/stellar", () => ({
  getRpcServer: jest.fn(),
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

  // ── Footprint byte size fee inclusion ─────────────────────────────────────

  it("includes serialized footprint byte size in estimateFee and estimateFeeDetailed", async () => {
    const baseline = await estimateFee("10000", "1000", "testnet");
    const withNumericFootprint = await estimateFee(
      "10000",
      "1000",
      "testnet",
      120,
    );
    // 120 bytes * (100 historical + 100 metadata) = 24,000 stroops
    expect(
      BigInt(withNumericFootprint.resourceFee) - BigInt(baseline.resourceFee),
    ).toBe(24000n);

    const footprintInput = {
      readOnlyBytes: 40,
      readWriteBytes: 48,
      estimatedSizeBytes: 96,
    };
    const simpleWithStruct = await estimateFee(
      "10000",
      "1000",
      "testnet",
      footprintInput,
    );
    const detailedWithStruct = await estimateFeeDetailed(
      "10000",
      "1000",
      "testnet",
      footprintInput,
    );

    // readOnly: 40 * 250 = 10,000; readWrite: 48 * 1000 = 48,000; serialized: 96 * 200 = 19,200 -> 77,200
    expect(detailedWithStruct.breakdown.footprintFee).toBe("77200");
    expect(detailedWithStruct.totalStroops).toBe(simpleWithStruct.totalFee);
    expect(
      BigInt(simpleWithStruct.resourceFee) - BigInt(baseline.resourceFee),
    ).toBe(77200n);
  });
});
