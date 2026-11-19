import request from "supertest";

import app from "../../index";

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

// Prevent real RPC calls — estimateFee falls back to 100 stroops on error
jest.mock("@services/feeEstimator", () => {
  const actual = jest.requireActual<typeof import("@services/feeEstimator")>(
    "@services/feeEstimator",
  );
  return {
    ...actual,
    estimateFee: jest.fn().mockResolvedValue({
      baseFee: "100",
      resourceFee: "1234500",
      totalFee: "1234600",
      feeInXLM: "0.1234600",
    }),
  };
});

const BASE = "/api/v1/estimate-fee";

describe("POST /api/v1/estimate-fee", () => {
  describe("missing fields → 400", () => {
    it("returns 400 when cpuInsns is missing", async () => {
      const res = await request(app).post(BASE).send({ memBytes: "8192" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/cpuInsns/);
    });

    it("returns 400 when memBytes is missing", async () => {
      const res = await request(app).post(BASE).send({ cpuInsns: "1000000" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/memBytes/);
    });

    it("returns 400 when both fields are missing", async () => {
      const res = await request(app).post(BASE).send({});
      expect(res.status).toBe(400);
    });
  });

  describe("non-numeric values → 400", () => {
    it("returns 400 when cpuInsns is not a number string", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "abc", memBytes: "8192" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-negative integer/);
    });

    it("returns 400 when memBytes is not a number string", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "1000000", memBytes: "not-a-number" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/non-negative integer/);
    });

    it("returns 400 when cpuInsns is a float string", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "1.5", memBytes: "8192" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when cpuInsns is negative", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "-100", memBytes: "8192" });
      expect(res.status).toBe(400);
    });
  });

  describe("invalid network → 400", () => {
    it("returns 400 for an unrecognised network value", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "1000000", memBytes: "8192", network: "devnet" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/Invalid network/);
    });
  });

  describe("valid inputs → 200 fee breakdown", () => {
    it("returns a fee breakdown object for testnet", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "1000000", memBytes: "8192", network: "testnet" });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        baseFee: expect.any(String),
        resourceFee: expect.any(String),
        totalFee: expect.any(String),
        feeInXLM: expect.any(String),
      });
    });

    it("returns a fee breakdown object when network is omitted (defaults to testnet)", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "500000", memBytes: "4096" });
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("totalFee");
    });

    it("accepts mainnet as a valid network", async () => {
      const res = await request(app)
        .post(BASE)
        .send({ cpuInsns: "1000000", memBytes: "8192", network: "mainnet" });
      expect(res.status).toBe(200);
    });
  });
});

describe("operation selection", () => {
  const code = "AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";
  it.each(["restore", "extend"])(
    "accepts %s footprints without invocation CPU or memory",
    async (operationType) => {
      const res = await request(app)
        .post(BASE)
        .send({
          operationType,
          footprint: {
            readOnly: operationType === "extend" ? [code] : [],
            readWrite: operationType === "restore" ? [code] : [],
          },
          extendTo: 4096,
        });
      expect(res.status).toBe(200);
    },
  );
  it.each([
    { operationType: "payment" },
    { operationType: "restore" },
    {
      operationType: "restore",
      footprint: { readOnly: [code], readWrite: [] },
    },
    {
      operationType: "restore",
      footprint: { readOnly: [], readWrite: ["invalid"] },
    },
    { operationType: "extend", footprint: { readOnly: [code], readWrite: [] } },
    {
      operationType: "extend",
      footprint: { readOnly: [code], readWrite: [] },
      extendTo: -1,
    },
    { operationType: "restore", xdr: "invalid" },
  ])("rejects invalid operation input %j", async (body) => {
    const res = await request(app)
      .post(BASE)
      .send({ ...body, cpuInsns: "0", memBytes: "0" });
    expect(res.status).toBe(400);
  });
  it("accepts the explicit invoke selector with a serialized footprint", async () => {
    const res = await request(app)
      .post(BASE)
      .send({
        operationType: "invoke",
        cpuInsns: "0",
        memBytes: "0",
        footprint: { readOnly: [code], readWrite: [] },
      });
    expect(res.status).toBe(200);
  });
});
