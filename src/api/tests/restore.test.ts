/* eslint-disable import-x/order */
import request from "supertest";

import app from "../../index";

jest.mock("@services/restorer");
jest.mock("@middleware/metrics", () => ({
  __esModule: true,
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  default: {
    incrementActiveSimulations: jest.fn(),
    decrementActiveSimulations: jest.fn(),
    recordSimulation: jest.fn(),
    recordSimulationDuration: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRpcError: jest.fn(),
    recordXdrBytes: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(""),
    getRegister: jest.fn(),
  },
}));

import { buildRestoreTransaction } from "@services/restorer";

const mockBuildRestore = buildRestoreTransaction as jest.MockedFunction<
  typeof buildRestoreTransaction
>;

const VALID_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

const BASE = "/api/v1/restore";

describe("POST /api/v1/restore", () => {
  beforeEach(() => jest.clearAllMocks());

  it("returns 400 when xdr is missing", async () => {
    const res = await request(app).post(BASE).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/xdr/i);
    expect(mockBuildRestore).not.toHaveBeenCalled();
  });

  it("returns 400 when xdr is an empty string", async () => {
    const res = await request(app).post(BASE).send({ xdr: "" });
    expect(res.status).toBe(400);
    expect(mockBuildRestore).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid (non-parseable) XDR", async () => {
    mockBuildRestore.mockRejectedValue(new Error("Failed to parse XDR"));
    const res = await request(app)
      .post(BASE)
      .send({ xdr: "not-valid-base64!!!" });
    expect(res.status).toBe(400);
    expect(mockBuildRestore).not.toHaveBeenCalled();
  });

  it("returns 200 with a restoration object when restore is needed", async () => {
    mockBuildRestore.mockResolvedValue({
      needsRestore: true,
      restoreXdr: "AAAA...",
      fee: "100",
    });

    const res = await request(app)
      .post(BASE)
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: {
        needsRestore: true,
        restoreXdr: expect.any(String),
        fee: expect.any(String),
      },
    });
  });

  it("returns 200 with needsRestore: false when no restoration is required", async () => {
    mockBuildRestore.mockResolvedValue({ needsRestore: false });

    const res = await request(app).post(BASE).send({ xdr: VALID_XDR });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { needsRestore: false },
    });
  });

  it("returns 500 when the restorer throws an unexpected error", async () => {
    mockBuildRestore.mockRejectedValue(new Error("RPC connection failed"));

    const res = await request(app).post(BASE).send({ xdr: VALID_XDR });

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/RPC connection failed/);
  });

  it("accepts optional wasmHash and wasmSizeBytes for expired contract code restoration", async () => {
    const wasmHash = "ab".repeat(32);
    mockBuildRestore.mockResolvedValue({
      needsRestore: true,
      restoreXdr: "AAAA...",
      fee: "100",
      estimatedRestoreFee: "385000",
      wasmSizeBytes: 16384,
      ledgerSequence: 500000,
      restoredKeys: {
        contractCode: [wasmHash],
        contractInstance: [
          "CADQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQOBYHA4DQP5KR",
        ],
      },
    });

    const res = await request(app).post(BASE).send({
      xdr: VALID_XDR,
      network: "testnet",
      wasmHash,
      wasmSizeBytes: 16384,
    });

    expect(res.status).toBe(200);
    expect(mockBuildRestore).toHaveBeenCalledWith(VALID_XDR, "testnet", {
      wasmHash,
      contractId: undefined,
      wasmSizeBytes: 16384,
    });
    expect(res.body.data.wasmSizeBytes).toBe(16384);
    expect(res.body.data.restoredKeys.contractCode).toContain(wasmHash);
  });

  it("returns 400 when wasmHash is not a 64-character hex string", async () => {
    const res = await request(app)
      .post(BASE)
      .send({ xdr: VALID_XDR, wasmHash: "not-hex" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wasmHash/i);
    expect(mockBuildRestore).not.toHaveBeenCalled();
  });
});
