jest.mock("@services/simulator", () => ({
  simulateTransaction: jest.fn(),
  simulationCache: { get: jest.fn(), set: jest.fn() },
}));

jest.mock("@services/networkStatus", () => ({
  getNetworkStatus: jest.fn(),
}));

jest.mock("@services/decoder", () => ({
  decodeXdr: jest.fn(),
}));

jest.mock("@services/feeEstimator", () => ({
  estimateFee: jest.fn(),
  estimateFeeDetailed: jest.fn(),
}));

jest.mock("@services/restorer", () => ({
  buildRestoreTransaction: jest.fn(),
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
}));

import fs from "fs";
import path from "path";

import { decodeXdr } from "@services/decoder";
import { estimateFee } from "@services/feeEstimator";
import { getNetworkStatus } from "@services/networkStatus";
import { buildRestoreTransaction } from "@services/restorer";
import { simulateTransaction } from "@services/simulator";
import request from "supertest";
import YAML from "yaml";

import app from "../index";
import { SOROBAN_INVOKE_XDR } from "../tests/fixtures/xdr";

const mockSimulateTransaction = simulateTransaction as jest.MockedFunction<
  typeof simulateTransaction
>;
const mockGetNetworkStatus = getNetworkStatus as jest.MockedFunction<
  typeof getNetworkStatus
>;
const mockDecodeXdr = decodeXdr as jest.MockedFunction<typeof decodeXdr>;
const mockEstimateFee = estimateFee as jest.MockedFunction<typeof estimateFee>;
const mockBuildRestoreTransaction =
  buildRestoreTransaction as jest.MockedFunction<
    typeof buildRestoreTransaction
  >;

const MOCK_SIMULATION_SUCCESS = {
  success: true,
  footprint: {
    readOnly: ["AAAABgAAAAAAA"],
    readWrite: ["AAAABgAAAAAAB"],
  },
  contracts: ["CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
  contractType: "token" as const,
  ttl: { liveUntilLedgerSeq: 12345 },
  optimized: true,
  rawFootprint: {
    readOnly: ["AAAABgAAAAAAA"],
    readWrite: ["AAAABgAAAAAAB"],
  },
  cost: {
    cpuInsns: "123456",
    memBytes: "4096",
  },
  cacheHit: false,
};

const MOCK_SIMULATION_ERROR = {
  success: false,
  error: "contract panic: assertion failed",
};

const MOCK_RESTORATION_REQUIRED = {
  success: false,
  type: "restoration_required" as const,
  error: "Transaction requires ledger entry restoration before simulation.",
  code: "SIMULATION_RESTORE_REQUIRED",
  ttl: [
    {
      key: "AAAABgAAAAAAA",
      liveUntilLedgerSeq: 1000,
      status: "expired",
    },
  ],
  ttlWarnings: [
    {
      key: "AAAABgAAAAAAA",
      message: "Ledger entry expired and requires restoration",
    },
  ],
  warnings: [
    {
      key: "AAAABgAAAAAAA",
      message: "Ledger entry expired and requires restoration",
    },
  ],
  cost: {
    cpuInsns: "0",
    memBytes: "0",
    ttlExtension: {
      recommendedExtendTo: 50000,
    },
  },
};

const MOCK_RESTORE_RESPONSE = {
  needsRestore: true,
  restoreXdr: "AAAAAgAAArestore==",
  fee: "100",
};

const MOCK_DECODE_RESULT = {
  success: true,
  type: "transaction" as const,
  decoded: {
    sourceAccount: "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
    operations: [
      {
        type: "invokeHostFunction",
        function: "hello",
      },
    ],
  },
};

const MOCK_FEE_ESTIMATE = {
  baseFee: "100",
  resourceFee: "250",
  totalFee: "350",
  feeInXLM: "0.0000350",
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
  jest.spyOn(process, "uptime").mockReturnValue(123.456);

  mockSimulateTransaction.mockResolvedValue(MOCK_SIMULATION_SUCCESS as never);
  mockGetNetworkStatus.mockResolvedValue({
    ledger: 123456,
    baseFee: "100",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcLatencyMs: 17,
  } as never);
  mockDecodeXdr.mockReturnValue(MOCK_DECODE_RESULT as never);
  mockEstimateFee.mockResolvedValue(MOCK_FEE_ESTIMATE as never);
  mockBuildRestoreTransaction.mockResolvedValue(MOCK_RESTORE_RESPONSE as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("endpoint response shape snapshots", () => {
  it("captures /health response shape", async () => {
    const response = await request(app).get("/api/v1/health");

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "status": "ok",
        "timestamp": "2026-01-02T03:04:05.000Z",
        "uptime": 123.456,
        "version": "1.0.0",
      }
    `);
  });

  it("captures successful /simulate response shape", async () => {
    const response = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: SOROBAN_INVOKE_XDR, network: "testnet" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "cacheHit": false,
        "contractType": "token",
        "contracts": [
          "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ],
        "cost": {
          "cpuInsns": "123456",
          "memBytes": "4096",
        },
        "footprint": {
          "readOnly": [
            "AAAABgAAAAAAA",
          ],
          "readWrite": [
            "AAAABgAAAAAAB",
          ],
        },
        "optimized": true,
        "rawFootprint": {
          "readOnly": [
            "AAAABgAAAAAAA",
          ],
          "readWrite": [
            "AAAABgAAAAAAB",
          ],
        },
        "success": true,
        "ttl": {
          "liveUntilLedgerSeq": 12345,
        },
      }
    `);
  });

  it("captures failed /simulate response shape", async () => {
    mockSimulateTransaction.mockResolvedValueOnce(
      MOCK_SIMULATION_ERROR as never,
    );

    const response = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: SOROBAN_INVOKE_XDR, network: "testnet" });

    expect(response.status).toBe(422);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "UNPROCESSABLE_ENTITY",
        "error": "contract panic: assertion failed",
        "success": false,
      }
    `);
  });

  it("captures /network/status response shape", async () => {
    const response = await request(app).get("/api/v1/network/status");

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "data": {
          "baseFee": "100",
          "ledger": 123456,
          "networkPassphrase": "Test SDF Network ; September 2015",
          "rpcLatencyMs": 17,
        },
        "success": true,
      }
    `);
  });

  it("captures /decode response shape", async () => {
    const response = await request(app)
      .get("/api/v1/decode")
      .query({ xdr: SOROBAN_INVOKE_XDR, type: "transaction" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "decoded": {
          "operations": [
            {
              "function": "hello",
              "type": "invokeHostFunction",
            },
          ],
          "sourceAccount": "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567",
        },
        "success": true,
        "type": "transaction",
      }
    `);
  });

  it("captures /estimate-fee response shape", async () => {
    const response = await request(app).post("/api/v1/estimate-fee").send({
      cpuInsns: "100000",
      memBytes: "2048",
      network: "testnet",
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "baseFee": "100",
        "feeInXLM": "0.0000350",
        "resourceFee": "250",
        "totalFee": "350",
      }
    `);
  });

  it("captures /simulate validation error response envelope (400)", async () => {
    const response = await request(app)
      .post("/api/v1/simulate")
      .send({ network: "testnet" });

    expect(response.status).toBe(400);
    expect(response.body).toMatchInlineSnapshot(
      {
        requestId: expect.any(String),
      },
      `
      {
        "code": "INVALID_XDR",
        "error": "Missing required field: xdr",
        "requestId": Any<String>,
        "success": false,
      }
    `,
    );
  });

  it("captures restoration_required /simulate response shape", async () => {
    mockSimulateTransaction.mockResolvedValueOnce(
      MOCK_RESTORATION_REQUIRED as never,
    );

    const response = await request(app)
      .post("/api/v1/simulate")
      .send({ xdr: SOROBAN_INVOKE_XDR, network: "testnet" });

    expect(response.status).toBe(422);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "code": "SIMULATION_RESTORE_REQUIRED",
        "cost": {
          "cpuInsns": "0",
          "memBytes": "0",
          "ttlExtension": {
            "recommendedExtendTo": 50000,
          },
        },
        "error": "Transaction requires ledger entry restoration before simulation.",
        "success": false,
        "ttl": [
          {
            "key": "AAAABgAAAAAAA",
            "liveUntilLedgerSeq": 1000,
            "status": "expired",
          },
        ],
        "ttlWarnings": [
          {
            "key": "AAAABgAAAAAAA",
            "message": "Ledger entry expired and requires restoration",
          },
        ],
        "type": "restoration_required",
        "warnings": [
          {
            "key": "AAAABgAAAAAAA",
            "message": "Ledger entry expired and requires restoration",
          },
        ],
      }
    `);
  });

  it("captures /restore response envelope", async () => {
    const response = await request(app)
      .post("/api/v1/restore")
      .send({ xdr: SOROBAN_INVOKE_XDR, network: "testnet" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "data": {
          "fee": "100",
          "needsRestore": true,
          "restoreXdr": "AAAAAgAAArestore==",
        },
        "success": true,
      }
    `);
  });

  it("captures /simulate/batch response envelope", async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce(MOCK_SIMULATION_SUCCESS as never)
      .mockResolvedValueOnce(MOCK_SIMULATION_ERROR as never);

    const response = await request(app)
      .post("/api/v1/simulate/batch")
      .send({
        transactions: [{ xdr: SOROBAN_INVOKE_XDR }, { xdr: SOROBAN_INVOKE_XDR }],
        network: "testnet",
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "results": [
          {
            "cacheHit": false,
            "contractType": "token",
            "contracts": [
              "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            ],
            "cost": {
              "cpuInsns": "123456",
              "memBytes": "4096",
            },
            "footprint": {
              "readOnly": [
                "AAAABgAAAAAAA",
              ],
              "readWrite": [
                "AAAABgAAAAAAB",
              ],
            },
            "index": 0,
            "optimized": true,
            "rawFootprint": {
              "readOnly": [
                "AAAABgAAAAAAA",
              ],
              "readWrite": [
                "AAAABgAAAAAAB",
              ],
            },
            "success": true,
            "ttl": {
              "liveUntilLedgerSeq": 12345,
            },
          },
          {
            "error": "contract panic: assertion failed",
            "index": 1,
            "success": false,
          },
        ],
      }
    `);
  });

  it("captures /footprint/diff response envelope", async () => {
    const response = await request(app)
      .post("/api/v1/footprint/diff")
      .send({
        before: {
          readOnly: ["AAAABgAAAAAAA"],
          readWrite: ["AAAABgAAAAAAB"],
        },
        after: {
          readOnly: ["AAAABgAAAAAAA", "AAAABgAAAAAAC"],
          readWrite: [],
        },
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchInlineSnapshot(`
      {
        "data": {
          "added": {
            "readOnly": [
              "AAAABgAAAAAAC",
            ],
            "readWrite": [],
          },
          "removed": {
            "readOnly": [],
            "readWrite": [
              "AAAABgAAAAAAB",
            ],
          },
          "unchanged": {
            "readOnly": [
              "AAAABgAAAAAAA",
            ],
            "readWrite": [],
          },
        },
        "success": true,
      }
    `);
  });

  it("matches parsed openapi.yaml schema snapshot", () => {
    const specPath = path.resolve(__dirname, "../../openapi.yaml");
    const rawSpec = fs.readFileSync(specPath, "utf8");
    const parsedSpec = YAML.parse(rawSpec) as Record<string, unknown>;

    expect(parsedSpec).toMatchSnapshot();
  });
});
