import http from "http";

import { simulateTransaction } from "@services/simulator";
import request from "supertest";

import { BATCH_MAX_SIZE } from "../constants";
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
    recordCacheLatency: jest.fn(),
    getMetrics: jest.fn().mockResolvedValue(""),
  },
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  metrics: { getMetrics: jest.fn().mockResolvedValue("") },
}));

const mockSimulate = simulateTransaction as jest.MockedFunction<
  typeof simulateTransaction
>;

const VALID_XDR = "AAAAAgAAAAC" + "A".repeat(40) + "==";

const makeResult = (cacheHit = false) => ({
  success: true,
  footprint: { readOnly: [], readWrite: [] },
  contracts: [],
  contractType: "unknown" as const,
  ttl: {},
  optimized: false,
  rawFootprint: { readOnly: [], readWrite: [] },
  cost: { cpuInsns: "100", memBytes: "200" },
  cacheHit,
});

beforeEach(() => jest.clearAllMocks());

describe("POST /api/v1/simulate/batch — validation", () => {
  it("returns 400 when transactions array is empty", async () => {
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions: [], network: "testnet" });

    expect(res.status).toBe(400);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("returns 400 when transactions field is missing", async () => {
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ network: "testnet" });

    expect(res.status).toBe(400);
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it(`returns 400 when batch exceeds max size of ${BATCH_MAX_SIZE}`, async () => {
    const transactions = Array.from({ length: BATCH_MAX_SIZE + 1 }, () => ({
      xdr: VALID_XDR,
    }));

    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions, network: "testnet" });

    expect(res.status).toBe(400);
    expect(mockSimulate).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/simulate/batch — mixed success/failure results", () => {
  it("returns success and failure entries without aborting the batch", async () => {
    mockSimulate
      .mockResolvedValueOnce(makeResult() as never)
      .mockRejectedValueOnce(new Error("RPC timeout"))
      .mockResolvedValueOnce(makeResult() as never);

    const transactions = Array.from({ length: 3 }, () => ({ xdr: VALID_XDR }));
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(3);
    expect(res.body.results[0]).toMatchObject({ success: true });
    expect(res.body.results[1]).toMatchObject({
      success: false,
      error: "RPC timeout",
    });
    expect(res.body.results[2]).toMatchObject({ success: true });
  });
});

describe("POST /api/v1/simulate/batch — X-Cache header", () => {
  it("sets X-Cache: MISS when no results are cache hits", async () => {
    mockSimulate.mockResolvedValue(makeResult(false) as never);

    const transactions = [{ xdr: VALID_XDR }, { xdr: VALID_XDR }];
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
  });

  it("sets X-Cache: PARTIAL when some results are cache hits", async () => {
    mockSimulate
      .mockResolvedValueOnce(makeResult(true) as never)
      .mockResolvedValueOnce(makeResult(false) as never);

    const transactions = [{ xdr: VALID_XDR }, { xdr: VALID_XDR }];
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("PARTIAL");
  });

  it("sets X-Cache: HIT when all results are cache hits", async () => {
    mockSimulate.mockResolvedValue(makeResult(true) as never);

    const transactions = [{ xdr: VALID_XDR }, { xdr: VALID_XDR }];
    const res = await request(app)
      .post("/api/v1/simulate/batch")
      .send({ transactions, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("HIT");
  });
});

// ---------------------------------------------------------------------------
// Issue #24 — SSE endpoint: GET /api/v1/simulate/batch/stream
// ---------------------------------------------------------------------------

/**
 * Collect all SSE events from an HTTP response stream and return them as
 * parsed objects.  The helper reads until the connection closes or a
 * "complete" event is received.
 */
function collectSseEvents(
  server: http.Server,
  path: string,
): Promise<{ event: string; data: unknown }[]> {
  return new Promise((resolve, reject) => {
    const events: { event: string; data: unknown }[] = [];
    const address = server.address() as { port: number };
    const req = http.request(
      {
        host: "127.0.0.1",
        port: address.port,
        path,
        headers: { Accept: "text/event-stream" },
      },
      (res) => {
        let buffer = "";
        let currentEvent = "message";

        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          buffer += chunk;
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event:")) {
              currentEvent = line.slice("event:".length).trim();
            } else if (line.startsWith("data:")) {
              try {
                const parsed = JSON.parse(
                  line.slice("data:".length).trim(),
                ) as unknown;
                events.push({ event: currentEvent, data: parsed });
              } catch {
                // ignore malformed data lines
              }
              currentEvent = "message";
            }
          }
        });

        res.on("end", () => resolve(events));
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("GET /api/v1/simulate/batch/stream — SSE endpoint", () => {
  let server: http.Server;

  beforeAll((done) => {
    server = app.listen(0, done);
  });

  afterAll((done) => {
    server.close(done);
  });

  it("returns text/event-stream content-type", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const address = server.address() as { port: number };

    await new Promise<void>((resolve, reject) => {
      http
        .get(
          {
            host: "127.0.0.1",
            port: address.port,
            path: `/api/v1/simulate/batch/stream?xdrs=${encodeURIComponent(VALID_XDR)}&network=testnet`,
            headers: { Accept: "text/event-stream" },
          },
          (res) => {
            expect(res.headers["content-type"]).toMatch(/text\/event-stream/);
            res.resume();
            res.on("end", resolve);
            res.on("error", reject);
          },
        )
        .on("error", reject);
    });
  });

  it("emits a progress event followed by a result event for each XDR", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const path = `/api/v1/simulate/batch/stream?xdrs=${encodeURIComponent(VALID_XDR)}&network=testnet`;
    const events = await collectSseEvents(server, path);

    const progressEvents = events.filter((e) => e.event === "progress");
    const resultEvents = events.filter((e) => e.event === "result");
    const completeEvents = events.filter((e) => e.event === "complete");

    expect(progressEvents.length).toBeGreaterThanOrEqual(1);
    expect(resultEvents.length).toBeGreaterThanOrEqual(1);
    expect(completeEvents).toHaveLength(1);
  });

  it("progress event contains index, total and status=simulating", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const path = `/api/v1/simulate/batch/stream?xdrs=${encodeURIComponent(VALID_XDR)}&network=testnet`;
    const events = await collectSseEvents(server, path);

    const progress = events.find((e) => e.event === "progress");
    expect(progress).toBeDefined();
    expect((progress!.data as Record<string, unknown>).status).toBe(
      "simulating",
    );
    expect(typeof (progress!.data as Record<string, unknown>).index).toBe(
      "number",
    );
    expect(typeof (progress!.data as Record<string, unknown>).total).toBe(
      "number",
    );
  });

  it("result event contains success, footprint and cost fields", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const path = `/api/v1/simulate/batch/stream?xdrs=${encodeURIComponent(VALID_XDR)}&network=testnet`;
    const events = await collectSseEvents(server, path);

    const result = events.find((e) => e.event === "result");
    expect(result).toBeDefined();
    const data = result!.data as Record<string, unknown>;
    expect(data).toHaveProperty("success");
    expect(data).toHaveProperty("index");
  });

  it("sends a complete event at the end of the stream", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const path = `/api/v1/simulate/batch/stream?xdrs=${encodeURIComponent(VALID_XDR)}&network=testnet`;
    const events = await collectSseEvents(server, path);

    const last = events[events.length - 1];
    expect(last.event).toBe("complete");
    expect((last.data as Record<string, unknown>).total).toBe(1);
  });

  it("emits a complete event immediately when no XDRs are provided", async () => {
    const path = `/api/v1/simulate/batch/stream`;
    const events = await collectSseEvents(server, path);

    expect(events).toHaveLength(1);
    expect(events[0].event).toBe("complete");
    expect(mockSimulate).not.toHaveBeenCalled();
  });

  it("handles multiple XDRs and emits one progress+result per XDR", async () => {
    mockSimulate.mockResolvedValue(makeResult() as never);
    const twoXdrs = encodeURIComponent([VALID_XDR, VALID_XDR].join(","));
    const path = `/api/v1/simulate/batch/stream?xdrs=${twoXdrs}&network=testnet`;
    const events = await collectSseEvents(server, path);

    const progressEvents = events.filter((e) => e.event === "progress");
    const resultEvents = events.filter((e) => e.event === "result");

    expect(progressEvents).toHaveLength(2);
    expect(resultEvents).toHaveLength(2);
  });
});
