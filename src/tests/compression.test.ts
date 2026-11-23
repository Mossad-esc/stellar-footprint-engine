/**
 * #428 — Gzip compression tests
 *
 * Verifies that:
 * 1. Responses larger than COMPRESSION_THRESHOLD are gzip-compressed.
 * 2. Responses smaller than the threshold are NOT compressed.
 * 3. The COMPRESSION_THRESHOLD env var is respected.
 */

// Must be set before importing app so index.ts picks it up
const THRESHOLD = 512;
process.env.COMPRESSION_THRESHOLD = String(THRESHOLD);

// Mock simulator so we control response size
jest.mock("@services/simulator");

// Minimal metrics mock
jest.mock("@middleware/metrics", () => ({
  __esModule: true,
  metricsMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  metrics: {
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

import { simulateTransaction } from "@services/simulator";
import request from "supertest";

import app from "../index";

const mockSimulate = simulateTransaction as jest.MockedFunction<
  typeof simulateTransaction
>;

const VALID_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

/** Build a simulate result whose JSON serialisation exceeds `minBytes`. */
function makeLargeResult(minBytes: number) {
  const padding = "x".repeat(minBytes);
  return {
    success: true,
    footprint: {
      readOnly: [padding],
      readWrite: [],
    },
    contracts: [],
    contractType: "unknown" as const,
    ttl: {},
    optimized: false,
    rawFootprint: { readOnly: [padding], readWrite: [] },
    cost: { cpuInsns: "0", memBytes: "0" },
  };
}

/** Build a simulate result whose JSON serialisation is well under `maxBytes`. */
function makeSmallResult() {
  return {
    success: true,
    footprint: { readOnly: [], readWrite: [] },
    contracts: [],
    contractType: "unknown" as const,
    ttl: {},
    optimized: false,
    rawFootprint: { readOnly: [], readWrite: [] },
    cost: { cpuInsns: "0", memBytes: "0" },
  };
}

beforeEach(() => jest.clearAllMocks());

describe("gzip compression (#428)", () => {
  it("compresses large responses (Content-Encoding: gzip)", async () => {
    // Response body will be >> THRESHOLD bytes
    mockSimulate.mockResolvedValueOnce(makeLargeResult(THRESHOLD * 4));

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "gzip")
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("does NOT compress small responses below the threshold", async () => {
    mockSimulate.mockResolvedValueOnce(makeSmallResult());

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "gzip")
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    // content-encoding should be absent or not 'gzip'
    expect(res.headers["content-encoding"] ?? "").not.toBe("gzip");
  });

  it("respects COMPRESSION_THRESHOLD env var — payload just above threshold is compressed", async () => {
    // Payload slightly above the configured threshold
    mockSimulate.mockResolvedValueOnce(makeLargeResult(THRESHOLD + 100));

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "gzip")
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("gzip");
  });

  it("does not compress when client does not send Accept-Encoding: gzip", async () => {
    mockSimulate.mockResolvedValueOnce(makeLargeResult(THRESHOLD * 4));

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "identity") // explicitly opt out of compression
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"] ?? "").not.toBe("gzip");
  });
});

describe("brotli compression (#38)", () => {
  it("compresses large responses with Content-Encoding: br when Accept-Encoding: br", async () => {
    mockSimulate.mockResolvedValueOnce(makeLargeResult(THRESHOLD * 4));

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "br")
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
  });

  it("does NOT brotli-compress health endpoints even with Accept-Encoding: br", async () => {
    const res = await request(app)
      .get("/api/v1/health")
      .set("Accept-Encoding", "br");

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"] ?? "").not.toBe("br");
  });

  it("does not brotli-compress small responses below the threshold", async () => {
    mockSimulate.mockResolvedValueOnce(makeSmallResult());

    const res = await request(app)
      .post("/api/v1/simulate")
      .set("Accept-Encoding", "br")
      .send({ xdr: VALID_XDR, network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"] ?? "").not.toBe("br");
  });
});
