import { simulateTransaction } from "@services/simulator";
import request from "supertest";

import app from "../index";

// Mock the entire simulator service so tests don't hit the network
jest.mock("@services/simulator", () => ({
  simulateTransaction: jest.fn(),
  simulationCache: { get: jest.fn(), set: jest.fn() },
}));

// Mock metrics to avoid prom-client side effects
jest.mock("@middleware/metrics", () => ({
  __esModule: true,
  default: {
    incrementActiveSimulations: jest.fn(),
    decrementActiveSimulations: jest.fn(),
    recordSimulation: jest.fn(),
    recordSimulationDuration: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRpcError: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(""),
  },
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  metrics: {
    getMetrics: jest.fn().mockResolvedValue(""),
  },
}));

const mockSimulate = simulateTransaction as jest.MockedFunction<
  typeof simulateTransaction
>;

const VALID_XDR = "AAAAAgAAAAC" + "A".repeat(40) + "==";

const SUCCESS_RESULT = {
  success: true,
  footprint: {
    readOnly: ["AAAABgAAAAHZ..."],
    readWrite: ["AAAABgAAAAHb..."],
  },
  cost: { cpuInsns: "1234567", memBytes: "8192" },
  cacheHit: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.NODE_ENV = "test";
});

describe("POST /api/v1/simulate", () => {
  describe("Success", () => {
    it("returns 200 with footprint and cost for valid XDR", async () => {
      mockSimulate.mockResolvedValueOnce(SUCCESS_RESULT as never);

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR, network: "testnet" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.footprint).toBeDefined();
      expect(res.body.footprint.readOnly).toBeInstanceOf(Array);
      expect(res.body.footprint.readWrite).toBeInstanceOf(Array);
      expect(res.body.cost).toBeDefined();
      expect(res.body.cost.cpuInsns).toBeDefined();
      expect(res.body.cost.memBytes).toBeDefined();
    });

    it("defaults to testnet when network is omitted", async () => {
      mockSimulate.mockResolvedValueOnce(SUCCESS_RESULT as never);

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR });

      expect(res.status).toBe(200);
      expect(mockSimulate).toHaveBeenCalledWith(
        VALID_XDR,
        "testnet",
        expect.anything(),
        undefined,
      );
    });

    it("accepts mainnet as network parameter", async () => {
      mockSimulate.mockResolvedValueOnce(SUCCESS_RESULT as never);

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR, network: "mainnet" });

      expect(res.status).toBe(200);
      expect(mockSimulate).toHaveBeenCalledWith(
        VALID_XDR,
        "mainnet",
        expect.anything(),
        undefined,
      );
    });
  });

  describe("Validation errors (400)", () => {
    it("returns 400 when xdr is missing", async () => {
      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ network: "testnet" });

      expect(res.status).toBe(400);
      expect(res.body.error ?? res.body.message).toBeTruthy();
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("returns 400 for empty body", async () => {
      const res = await request(app).post("/api/v1/simulate").send({});

      expect(res.status).toBe(400);
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("returns 400 for invalid network value", async () => {
      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR, network: "invalid-net" });

      expect(res.status).toBe(400);
      expect(mockSimulate).not.toHaveBeenCalled();
    });

    it("returns 400 for non-base64 XDR", async () => {
      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: "not-valid-base64!!!" });

      expect(res.status).toBe(400);
      expect(mockSimulate).not.toHaveBeenCalled();
    });
  });

  describe("Simulation failures (422)", () => {
    it("returns 422 when simulation returns success:false", async () => {
      mockSimulate.mockResolvedValueOnce({
        success: false,
        error: "contract panic: assertion failed",
      } as never);

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeTruthy();
    });

    it("returns 422 when restoration is required", async () => {
      mockSimulate.mockResolvedValueOnce({
        success: false,
        error:
          "Transaction requires ledger entry restoration before simulation.",
      } as never);

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe("Server errors (500)", () => {
    it("returns 500 when simulateTransaction throws", async () => {
      mockSimulate.mockRejectedValueOnce(new Error("RPC connection refused"));

      const res = await request(app)
        .post("/api/v1/simulate")
        .send({ xdr: VALID_XDR });

      expect(res.status).toBe(500);
    });
  });
});

describe("GET /api/v1/health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});

describe("X-Cache header integration", () => {
  it("returns X-Cache: HIT on second identical request when cache is populated", async () => {
    const xdr = VALID_XDR;

    mockSimulate.mockResolvedValueOnce({
      success: true,
      footprint: { readOnly: ["entry1"], readWrite: [] },
      cost: { cpuInsns: "1000", memBytes: "500" },
      cacheHit: false,
    } as never);

    const res1 = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr, network: "testnet" });

    expect(res1.status).toBe(200);
    expect(res1.headers["x-cache"]).toBe("MISS");

    mockSimulate.mockResolvedValueOnce({
      success: true,
      footprint: { readOnly: ["entry1"], readWrite: [] },
      cost: { cpuInsns: "1000", memBytes: "500" },
      cacheHit: true,
    } as never);

    const res2 = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr, network: "testnet" });

    expect(res2.status).toBe(200);
    expect(res2.headers["x-cache"]).toBe("HIT");
  });
});
