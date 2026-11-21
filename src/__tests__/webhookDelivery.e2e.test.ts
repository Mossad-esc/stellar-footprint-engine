import { createHmac, timingSafeEqual } from "crypto";
import http from "http";
import type { AddressInfo } from "net";

import { simulateTransaction } from "@services/simulator";
import request from "supertest";

import app from "../index";

jest.mock("@services/simulator", () => ({
  simulateTransaction: jest.fn(),
  simulationCache: { get: jest.fn(), set: jest.fn() },
}));

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
    recordXdrBytes: jest.fn(),
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
const WEBHOOK_SECRET = "e2e-test-webhook-secret";

const MOCK_SIMULATION_RESULT = {
  success: true,
  footprint: {
    readOnly: ["AAAABgAAAAHZ..."],
    readWrite: ["AAAABgAAAAHb..."],
  },
  contracts: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM"],
  contractType: "soroban" as const,
  ttl: {},
  optimized: false,
  rawFootprint: {
    readOnly: ["AAAABgAAAAHZ..."],
    readWrite: ["AAAABgAAAAHb..."],
  },
  cost: { cpuInsns: "1234567", memBytes: "8192" },
  cacheHit: false,
};

interface CapturedWebhookRequest {
  headers: http.IncomingHttpHeaders;
  rawBody: string;
}

describe("Async Webhook Simulation Delivery E2E", () => {
  let server: http.Server;
  let webhookUrl: string;
  let waitForWebhook: Promise<CapturedWebhookRequest>;
  let resolveWebhook: (req: CapturedWebhookRequest) => void;

  beforeEach((done) => {
    jest.clearAllMocks();
    process.env.NODE_ENV = "test";
    process.env.WEBHOOK_SECRET = WEBHOOK_SECRET;

    waitForWebhook = new Promise<CapturedWebhookRequest>((resolve) => {
      resolveWebhook = resolve;
    });

    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const rawBody = Buffer.concat(chunks).toString("utf8");
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ received: true }));
        resolveWebhook({ headers: req.headers, rawBody });
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      webhookUrl = `http://127.0.0.1:${port}/webhook`;
      done();
    });
  });

  afterEach((done) => {
    delete process.env.WEBHOOK_SECRET;
    server.close(() => done());
  });

  it("delivers signed simulation result to webhook receiver and marks job delivered", async () => {
    mockSimulate.mockResolvedValueOnce(MOCK_SIMULATION_RESULT as never);

    const submitRes = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: VALID_XDR, network: "testnet", webhookUrl });

    expect(submitRes.status).toBe(202);
    expect(submitRes.body.accepted).toBe(true);
    expect(typeof submitRes.body.jobId).toBe("string");
    expect(submitRes.body.status).toBe("pending");

    const jobId = submitRes.body.jobId as string;

    const received = await waitForWebhook;

    // Verify HMAC-SHA256 signature
    const signatureHeader = received.headers["x-webhook-signature"];
    expect(typeof signatureHeader).toBe("string");
    const expectedDigest = createHmac("sha256", WEBHOOK_SECRET)
      .update(received.rawBody)
      .digest("hex");
    const expectedHeader = `sha256=${expectedDigest}`;

    const actualBuf = Buffer.from(signatureHeader as string, "utf8");
    const expectedBuf = Buffer.from(expectedHeader, "utf8");
    expect(actualBuf.length).toBe(expectedBuf.length);
    expect(timingSafeEqual(actualBuf, expectedBuf)).toBe(true);

    // Verify delivered payload
    const parsedPayload = JSON.parse(received.rawBody) as Record<
      string,
      unknown
    >;
    expect(parsedPayload.jobId).toBe(jobId);
    expect(parsedPayload.success).toBe(true);
    expect(parsedPayload.footprint).toEqual(MOCK_SIMULATION_RESULT.footprint);
    expect(parsedPayload.cost).toEqual(MOCK_SIMULATION_RESULT.cost);

    // Poll job status until delivered (deliverWebhook sets status right after res.ok)
    let jobRes = await request(app).get(`/api/v1/simulate/jobs/${jobId}`);
    for (
      let attempt = 0;
      attempt < 10 && jobRes.body?.data?.status !== "delivered";
      attempt++
    ) {
      await new Promise((r) => setTimeout(r, 20));
      jobRes = await request(app).get(`/api/v1/simulate/jobs/${jobId}`);
    }

    expect(jobRes.status).toBe(200);
    expect(jobRes.body.success).toBe(true);
    expect(jobRes.body.data).toMatchObject({
      jobId,
      webhookUrl,
      status: "delivered",
      attempts: 1,
    });
    expect(jobRes.body.data.completedAt).toBeDefined();
  });
});
