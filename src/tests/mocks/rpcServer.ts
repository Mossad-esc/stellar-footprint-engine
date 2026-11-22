import * as http from "http";
import * as StellarSdk from "@stellar/stellar-sdk";

import {
  getFixtureByContractId,
  SimulateTransactionFixtureResult,
} from "../fixtures";

/**
 * Response type for mock RPC server
 */
export type MockResponseType = "success" | "error" | "restore";

/**
 * Configuration for mock RPC responses
 */
export interface MockRpcConfig {
  responseType?: MockResponseType;
  simulationError?: string;
  transactionData?: string;
  ledgerSequence?: number;
  useTokenFixtures?: boolean;
  contractFixtures?: Record<string, Partial<SimulateTransactionFixtureResult>>;
}

/**
 * Mock RPC Server instance
 */
export interface MockRpcServerInstance {
  port: number;
  url: string;
  server: http.Server;
  configure: (config: MockRpcConfig) => void;
  stop: () => Promise<void>;
}

/**
 * Default mock responses for different scenarios
 */
const DEFAULT_RESPONSES = {
  success: {
    transactionData: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    minResourceFee: "100000",
    cost: { cpuInsns: "100000", memBytes: "100000" },
    events: [],
    latestLedger: 1000,
  },
  error: {
    error: "Transaction simulation failed",
  },
  restore: {
    restorePreamble: Buffer.from("restore_preamble").toString("base64"),
    minResourceFee: "100000",
  },
};

/**
 * Create a lightweight mock Stellar RPC server for testing
 * Starts on a random port and returns configurable responses
 *
 * @returns Promise resolving to MockRpcServerInstance
 *
 * @example
 * ```typescript
 * const mockRpc = await startMockRpcServer();
 * mockRpc.configure({ responseType: "success" });
 * // Use mockRpc.url in your tests
 * await mockRpc.stop();
 * ```
 */
export async function startMockRpcServer(): Promise<MockRpcServerInstance> {
  let config: MockRpcConfig = { responseType: "success" };

  const requestHandler = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void => {
    // Only handle POST requests
    if (req.method !== "POST") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    // Collect request body
    let body = "";
    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", () => {
      try {
        const jsonBody = JSON.parse(body);
        const method = jsonBody.method || "";

        // Route to appropriate handler
        if (method === "simulateTransaction") {
          const txXdr =
            typeof jsonBody.params?.transaction === "string"
              ? jsonBody.params.transaction
              : Array.isArray(jsonBody.params) &&
                  typeof jsonBody.params[0] === "string"
                ? jsonBody.params[0]
                : undefined;
          handleSimulateTransaction(res, config, txXdr);
        } else if (method === "getLatestLedger") {
          handleGetLatestLedger(res, config);
        } else if (method === "getLedgerEntries") {
          handleGetLedgerEntries(res, config);
        } else {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: `Unknown method: ${method}` }));
        }
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  };

  const server = http.createServer(requestHandler);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to get server address"));
        return;
      }

      const port = address.port;
      const url = `http://127.0.0.1:${port}`;

      resolve({
        port,
        url,
        server,
        configure: (newConfig: MockRpcConfig) => {
          config = { ...config, ...newConfig };
        },
        stop: async () => {
          return new Promise((stopResolve, stopReject) => {
            server.close((err) => {
              if (err) stopReject(err);
              else stopResolve();
            });
          });
        },
      });
    });

    server.on("error", reject);
  });
}

/**
 * Extract the invoked contract ID and function name from a base64 transaction envelope XDR.
 */
function extractInvokedContract(
  txXdr?: string,
): { contractId: string; functionName?: string } | undefined {
  if (!txXdr) return undefined;

  try {
    const envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(
      txXdr,
      "base64",
    );
    let operations: StellarSdk.xdr.Operation[] = [];
    const envType = envelope.switch();

    if (envType === StellarSdk.xdr.EnvelopeType.envelopeTypeTx()) {
      operations = envelope.v1().tx().operations();
    } else if (envType === StellarSdk.xdr.EnvelopeType.envelopeTypeTxV0()) {
      operations = envelope.v0().tx().operations();
    } else if (
      envType === StellarSdk.xdr.EnvelopeType.envelopeTypeTxFeeBump()
    ) {
      operations = envelope.feeBump().tx().innerTx().v1().tx().operations();
    }

    for (const op of operations) {
      const body = op.body();
      if (
        body.switch() === StellarSdk.xdr.OperationType.invokeHostFunction()
      ) {
        const hostFn = body.invokeHostFunctionOp().hostFunction();
        if (
          hostFn.switch() ===
          StellarSdk.xdr.HostFunctionType.hostFunctionTypeInvokeContract()
        ) {
          const args = hostFn.invokeContract();
          return {
            contractId: StellarSdk.Address.fromScAddress(
              args.contractAddress(),
            ).toString(),
            functionName: args.functionName().toString("utf8"),
          };
        }
      }
    }
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * Handle simulateTransaction RPC method
 */
function handleSimulateTransaction(
  res: http.ServerResponse,
  config: MockRpcConfig,
  txXdr?: string,
): void {
  res.writeHead(200, { "Content-Type": "application/json" });

  const responseType = config.responseType || "success";

  if (responseType === "error") {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          error: config.simulationError || DEFAULT_RESPONSES.error.error,
        },
        id: 1,
      }),
    );
  } else if (responseType === "restore") {
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          restorePreamble: DEFAULT_RESPONSES.restore.restorePreamble,
          minResourceFee: DEFAULT_RESPONSES.restore.minResourceFee,
        },
        id: 1,
      }),
    );
  } else {
    const invoked = extractInvokedContract(txXdr);
    const customFixture =
      invoked && config.contractFixtures?.[invoked.contractId];
    const tokenFixture =
      invoked &&
      config.useTokenFixtures !== false &&
      !config.transactionData
        ? getFixtureByContractId(invoked.contractId, invoked.functionName)
            ?.simulateTransaction
        : undefined;
    const matched = customFixture || tokenFixture;

    // success response
    res.end(
      JSON.stringify({
        jsonrpc: "2.0",
        result: {
          transactionData:
            config.transactionData ||
            matched?.transactionData ||
            DEFAULT_RESPONSES.success.transactionData,
          minResourceFee:
            matched?.minResourceFee || DEFAULT_RESPONSES.success.minResourceFee,
          cost: matched?.cost || DEFAULT_RESPONSES.success.cost,
          events: matched?.events || DEFAULT_RESPONSES.success.events,
          latestLedger:
            config.ledgerSequence ||
            matched?.latestLedger ||
            DEFAULT_RESPONSES.success.latestLedger,
        },
        id: 1,
      }),
    );
  }
}

/**
 * Handle getLatestLedger RPC method
 */
function handleGetLatestLedger(
  res: http.ServerResponse,
  config: MockRpcConfig,
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      result: {
        sequence:
          config.ledgerSequence || DEFAULT_RESPONSES.success.latestLedger,
        protocolVersion: 21,
        sorobanLedgerSequence:
          config.ledgerSequence || DEFAULT_RESPONSES.success.latestLedger,
      },
      id: 1,
    }),
  );
}

/**
 * Handle getLedgerEntries RPC method
 */
function handleGetLedgerEntries(
  res: http.ServerResponse,
  config: MockRpcConfig,
): void {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      jsonrpc: "2.0",
      result: {
        entries: [],
        latestLedger:
          config.ledgerSequence || DEFAULT_RESPONSES.success.latestLedger,
      },
      id: 1,
    }),
  );
}
