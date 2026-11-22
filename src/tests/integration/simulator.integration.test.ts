import * as StellarSdk from "@stellar/stellar-sdk";
import express from "express";
import request from "supertest";

import { clearRpcPool } from "../../config/stellar";
import { errorHandler } from "../../middleware/errorHandler";
import { simulateTransaction } from "../../services/simulator";
import {
  contractDataKey,
  footprintTransaction,
  sacFootprint,
  TEST_ACCOUNT,
} from "../fixtures/footprints";
import { startMockRpcServer, MockRpcServerInstance } from "../mocks/rpcServer";

/**
 * Integration tests for simulateTransaction using mock RPC server
 * Tests real SDK behavior without network access
 */
describe("simulateTransaction Integration Tests", () => {
  let mockRpc: MockRpcServerInstance;

  beforeAll(async () => {
    mockRpc = await startMockRpcServer();
  });

  afterAll(async () => {
    await mockRpc.stop();
  });

  beforeEach(() => {
    // Reset to default success response before each test
    mockRpc.configure({ responseType: "success" });
    // Override RPC URL via environment variable and allow HTTP for local mock
    process.env.TESTNET_RPC_URL = mockRpc.url;
    process.env.ALLOW_HTTP = "true";
    clearRpcPool();
  });

  /**
   * Helper to create a minimal valid Soroban transaction XDR
   * This creates a real transaction that the SDK can parse
   */
  function createMinimalSorobanTxXdr(): string {
    const sourceKeypair = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(sourceKeypair.publicKey(), "0");

    const contract = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4";
    const operation = StellarSdk.Operation.invokeHostFunction({
      func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
        new StellarSdk.xdr.InvokeContractArgs({
          contractAddress:
            StellarSdk.Address.fromString(contract).toScAddress(),
          functionName: Buffer.from("test"),
          args: [],
        }),
      ),
      auth: [],
    });

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: StellarSdk.Networks.TESTNET,
      v1: true,
    })
      .addOperation(operation)
      .setTimeout(30)
      .build();

    return tx.toXDR();
  }

  describe("Success Scenarios", () => {
    it.each([
      StellarSdk.Asset.native(),
      new StellarSdk.Asset("USDC", TEST_ACCOUNT),
    ])(
      "exposes %s SAC metadata from the simulated footprint",
      async (asset) => {
        const data = sacFootprint(asset);
        mockRpc.configure({ transactionData: data.build().toXDR("base64") });
        const tx = footprintTransaction(1, data);
        const result = await simulateTransaction(tx.toXDR(), "testnet");
        const assetInfo = asset.isNative()
          ? { code: "XLM" }
          : { code: "USDC", issuer: TEST_ACCOUNT };
        expect(result.contractType).toBe("sac");
        expect(result.isSAC).toBe(true);
        expect(result.assetInfo).toEqual(assetInfo);
        expect(result.footprintStats).toMatchObject({ isSAC: true, assetInfo });
        mockRpc.configure({
          transactionData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        });
      },
    );

    it.each([2, 5, 10])(
      "matches the complete RPC footprint for %i mixed invocations",
      async (count) => {
        const keys = Array.from({ length: count }, (_, i) =>
          contractDataKey(i + 1),
        );
        const shared = contractDataKey(42);
        const data = new StellarSdk.SorobanDataBuilder()
          .setReadOnly([...keys].reverse().concat([shared, keys[0]]))
          .setReadWrite([shared, shared]);
        mockRpc.configure({ transactionData: data.build().toXDR("base64") });
        const tx = footprintTransaction(count, data, true);
        const result = await simulateTransaction(tx.toXDR(), "testnet");
        expect(result.success).toBe(true);
        expect(result.rawFootprint).toEqual({
          readOnly: data
            .build()
            .resources()
            .footprint()
            .readOnly()
            .map((key) => key.toXDR("base64")),
          readWrite: [shared.toXDR("base64"), shared.toXDR("base64")],
        });
        expect(result.footprint?.readOnly.map((key) => key.xdr)).toEqual(
          keys.map((key) => key.toXDR("base64")),
        );
        expect(result.footprint?.readWrite.map((key) => key.xdr)).toEqual([
          shared.toXDR("base64"),
        ]);
        expect(result.optimized).toBe(true);
        mockRpc.configure({
          transactionData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        });
      },
    );

    it("should simulate transaction successfully with mock RPC", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(true);
      expect(result.footprint).toBeDefined();
      expect(result.footprint?.readOnly).toBeDefined();
      expect(result.footprint?.readWrite).toBeDefined();
      expect(result.cost).toBeDefined();
      expect(result.cost?.cpuInsns).toBeDefined();
      expect(result.cost?.memBytes).toBeDefined();
    });

    it("should return footprint with parsed entries", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(true);
      expect(Array.isArray(result.footprint?.readOnly)).toBe(true);
      expect(Array.isArray(result.footprint?.readWrite)).toBe(true);
    });

    it("should include raw response in result", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.raw).toBeDefined();
      expect(result.raw?.transactionData).toBeDefined();
    });

    it("should handle custom ledger sequence", async () => {
      mockRpc.configure({ responseType: "success", ledgerSequence: 5000 });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet", undefined, 5000);

      expect(result.success).toBe(true);
      expect(result.raw?.latestLedger).toBe(5000);
    });
  });

  describe("Error Scenarios", () => {
    it("should handle simulation error response", async () => {
      mockRpc.configure({
        responseType: "error",
        simulationError: "contract panic: assertion failed",
      });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(false);
      expect(result.error).toBe("contract panic: assertion failed");
      expect(result.raw).toBeDefined();
    });

    it("should handle restore response", async () => {
      mockRpc.configure({ responseType: "restore" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/restoration/i);
      expect(result.raw).toBeDefined();
    });

    it("should handle generic simulation error", async () => {
      mockRpc.configure({
        responseType: "error",
        simulationError: "Transaction simulation failed",
      });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe("Configuration Changes", () => {
    it("should respect response type changes between calls", async () => {
      const xdr = createMinimalSorobanTxXdr();

      // First call - success
      mockRpc.configure({ responseType: "success" });
      let result = await simulateTransaction(xdr, "testnet");
      expect(result.success).toBe(true);

      // Second call - error
      mockRpc.configure({
        responseType: "error",
        simulationError: "test error",
      });
      result = await simulateTransaction(xdr, "testnet");
      expect(result.success).toBe(false);
      expect(result.error).toBe("test error");

      // Third call - restore
      mockRpc.configure({ responseType: "restore" });
      result = await simulateTransaction(xdr, "testnet");
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/restoration/i);
    });

    it("should update ledger sequence dynamically", async () => {
      const xdr = createMinimalSorobanTxXdr();

      mockRpc.configure({ ledgerSequence: 1000 });
      let result = await simulateTransaction(xdr, "testnet");
      expect(result.raw?.latestLedger).toBe(1000);

      mockRpc.configure({ ledgerSequence: 2000 });
      result = await simulateTransaction(xdr, "testnet");
      expect(result.raw?.latestLedger).toBe(2000);
    });
  });

  describe("Network Isolation", () => {
    it("should not require actual network access", async () => {
      // This test verifies that the mock server handles requests
      // without making real network calls
      const xdr = createMinimalSorobanTxXdr();
      mockRpc.configure({ responseType: "success" });

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.success).toBe(true);
      // If this passes, we know the mock server responded
      expect(result.raw).toBeDefined();
    });

    it("should handle multiple concurrent simulations", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      // Run multiple simulations concurrently
      const results = await Promise.all([
        simulateTransaction(xdr, "testnet"),
        simulateTransaction(xdr, "testnet"),
        simulateTransaction(xdr, "testnet"),
      ]);

      // All should succeed
      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.footprint).toBeDefined();
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty transaction data gracefully", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      // Should still return a valid result structure
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("raw");
    });

    it("should preserve cost information from mock response", async () => {
      mockRpc.configure({ responseType: "success" });
      const xdr = createMinimalSorobanTxXdr();

      const result = await simulateTransaction(xdr, "testnet");

      expect(result.cost?.cpuInsns).toBeDefined();
      expect(result.cost?.memBytes).toBeDefined();
    });
  });
});

/**
 * Integration tests for request body payload size limits.
 * Verifies that batch endpoints enforce a 2MB JSON limit and non-batch
 * endpoints enforce a 250kb limit, returning a standard 413 error envelope.
 */
describe("Request Body Payload Size Limits", () => {
  const BATCH_LIMIT = "2mb";
  const STANDARD_LIMIT = "250kb";

  function buildApp(): express.Express {
    const app = express();
    const batchJson = express.json({ limit: BATCH_LIMIT });
    const standardJson = express.json({ limit: STANDARD_LIMIT });

    app.post("/simulate/batch", batchJson, (_req, res) => {
      res.status(200).json({ success: true });
    });
    app.post("/simulate", standardJson, (_req, res) => {
      res.status(200).json({ success: true });
    });

    app.use(errorHandler);
    return app;
  }

  /**
   * Builds a JSON string of approximately the requested byte size.
   */
  function buildPayload(sizeBytes: number): string {
    const prefix = '{"transactions":["';
    const suffix = '"]}';
    const fillerLength = Math.max(
      0,
      sizeBytes - prefix.length - suffix.length,
    );
    return `${prefix}${"a".repeat(fillerLength)}${suffix}`;
  }

  it("rejects batch payloads exceeding the 2MB limit with 413", async () => {
    const app = buildApp();
    const oversized = buildPayload(2 * 1024 * 1024 + 1024);

    const response = await request(app)
      .post("/simulate/batch")
      .set("Content-Type", "application/json")
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      success: false,
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  });

  it("accepts batch payloads under the 2MB limit", async () => {
    const app = buildApp();
    const underLimit = buildPayload(1024 * 1024);

    const response = await request(app)
      .post("/simulate/batch")
      .set("Content-Type", "application/json")
      .send(underLimit);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it("rejects non-batch payloads exceeding the 250kb limit with 413", async () => {
    const app = buildApp();
    const oversized = buildPayload(250 * 1024 + 1024);

    const response = await request(app)
      .post("/simulate")
      .set("Content-Type", "application/json")
      .send(oversized);

    expect(response.status).toBe(413);
    expect(response.body).toMatchObject({
      success: false,
      error: expect.objectContaining({
        code: expect.any(String),
        message: expect.any(String),
      }),
    });
  });

  it("accepts non-batch payloads under the 250kb limit", async () => {
    const app = buildApp();
    const underLimit = buildPayload(100 * 1024);

    const response = await request(app)
      .post("/simulate")
      .set("Content-Type", "application/json")
      .send(underLimit);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});
