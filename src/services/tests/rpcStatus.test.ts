/**
 * #40 — Tests for RPC pool stats tracking utilities in rpcClient.ts
 */
import {
  sanitizeRpcUrl,
  getRpcStats,
  recordRpcCall,
  setCircuitStatus,
} from "../rpcClient";

// Reset module state between tests by re-importing with jest module reset
// We rely on the in-module Map being reset via jest.resetModules() where needed.

describe("sanitizeRpcUrl (#40)", () => {
  it("masks api_key query parameter", () => {
    const url = "https://soroban-testnet.stellar.org?api_key=supersecret";
    expect(sanitizeRpcUrl(url)).toBe(
      "https://soroban-testnet.stellar.org/?api_key=***",
    );
  });

  it("masks secret query parameter", () => {
    const url = "https://rpc.example.com/v1?secret=abc123";
    expect(sanitizeRpcUrl(url)).toBe("https://rpc.example.com/v1?secret=***");
  });

  it("masks token query parameter", () => {
    const url = "https://rpc.example.com/?auth_token=xyz";
    expect(sanitizeRpcUrl(url)).toBe("https://rpc.example.com/?auth_token=***");
  });

  it("masks basic-auth credentials", () => {
    const url = "https://user:password@rpc.example.com/";
    const result = sanitizeRpcUrl(url);
    expect(result).toContain("***:***@rpc.example.com");
    expect(result).not.toContain("user");
    expect(result).not.toContain("password");
  });

  it("leaves clean URLs untouched", () => {
    const url = "https://soroban-testnet.stellar.org";
    expect(sanitizeRpcUrl(url)).toBe("https://soroban-testnet.stellar.org/");
  });

  it("leaves non-sensitive query params untouched", () => {
    const url = "https://rpc.example.com/?network=testnet&version=2";
    expect(sanitizeRpcUrl(url)).toBe(
      "https://rpc.example.com/?network=testnet&version=2",
    );
  });
});

describe("getRpcStats (#40)", () => {
  const originalTestnetUrl = process.env.TESTNET_RPC_URL;
  const originalMainnetUrl = process.env.MAINNET_RPC_URL;
  const originalFuturenetUrl = process.env.FUTURENET_RPC_URL;

  beforeEach(() => {
    // Set up test env URLs
    process.env.TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
    delete process.env.MAINNET_RPC_URL;
    delete process.env.FUTURENET_RPC_URL;
  });

  afterEach(() => {
    // Restore original env
    if (originalTestnetUrl !== undefined)
      process.env.TESTNET_RPC_URL = originalTestnetUrl;
    else delete process.env.TESTNET_RPC_URL;
    if (originalMainnetUrl !== undefined)
      process.env.MAINNET_RPC_URL = originalMainnetUrl;
    else delete process.env.MAINNET_RPC_URL;
    if (originalFuturenetUrl !== undefined)
      process.env.FUTURENET_RPC_URL = originalFuturenetUrl;
    else delete process.env.FUTURENET_RPC_URL;
  });

  it("returns zeroed-out stats for a configured network with no recorded calls", () => {
    const stats = getRpcStats();
    const testnetStats = stats.find((s) => s.network === "testnet");
    expect(testnetStats).toBeDefined();
    expect(testnetStats!.requests).toBe(0);
    expect(testnetStats!.errors).toBe(0);
    expect(testnetStats!.avgLatencyMs).toBe(0);
    expect(testnetStats!.failureRate).toBe(0);
    expect(testnetStats!.circuitStatus).toBe("CLOSED");
  });

  it("does not include networks without configured RPC URLs", () => {
    const stats = getRpcStats();
    expect(stats.find((s) => s.network === "mainnet")).toBeUndefined();
    expect(stats.find((s) => s.network === "futurenet")).toBeUndefined();
  });

  it("accumulates requests and errors after recordRpcCall", () => {
    recordRpcCall("testnet", "https://soroban-testnet.stellar.org", 120, false);
    recordRpcCall("testnet", "https://soroban-testnet.stellar.org", 80, false);
    recordRpcCall("testnet", "https://soroban-testnet.stellar.org", 200, true);

    const stats = getRpcStats();
    const testnetStats = stats.find((s) => s.network === "testnet");
    expect(testnetStats).toBeDefined();
    expect(testnetStats!.requests).toBeGreaterThanOrEqual(3);
    expect(testnetStats!.errors).toBeGreaterThanOrEqual(1);
    expect(testnetStats!.avgLatencyMs).toBeGreaterThan(0);
    expect(testnetStats!.failureRate).toBeGreaterThan(0);
    expect(testnetStats!.failureRate).toBeLessThanOrEqual(1);
  });
});

describe("setCircuitStatus (#40)", () => {
  const originalTestnetUrl = process.env.TESTNET_RPC_URL;

  beforeEach(() => {
    process.env.TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
  });

  afterEach(() => {
    if (originalTestnetUrl !== undefined)
      process.env.TESTNET_RPC_URL = originalTestnetUrl;
    else delete process.env.TESTNET_RPC_URL;
  });

  it("updates circuit status to OPEN", () => {
    setCircuitStatus("testnet", "OPEN");
    const stats = getRpcStats();
    const testnetStats = stats.find((s) => s.network === "testnet");
    expect(testnetStats!.circuitStatus).toBe("OPEN");
  });

  it("updates circuit status to HALF_OPEN", () => {
    setCircuitStatus("testnet", "HALF_OPEN");
    const stats = getRpcStats();
    const testnetStats = stats.find((s) => s.network === "testnet");
    expect(testnetStats!.circuitStatus).toBe("HALF_OPEN");
  });

  it("updates circuit status back to CLOSED", () => {
    setCircuitStatus("testnet", "OPEN");
    setCircuitStatus("testnet", "CLOSED");
    const stats = getRpcStats();
    const testnetStats = stats.find((s) => s.network === "testnet");
    expect(testnetStats!.circuitStatus).toBe("CLOSED");
  });
});
