import { Network, getNetworkConfig, getRpcServer } from "@config/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

import {
  parseFootprint,
  extractContracts,
  detectTokenContract,
  type FootprintEntry,
  type ContractType,
} from "./footprintParser";
import { optimizeFootprint } from "./optimizer";
// import { calculateResourceFee } from "./feeEstimator"; // unused
import { CACHE_TTL, CACHE_TTL_MS, ErrorCode } from "../constants";
import metrics from "../middleware/metrics";
import { buildCacheKey, getCache } from "../services/cache";
import {
  FootprintStats,
  AuthEntry,
  ContractEvent,
  ContractInvocation,
  TtlInfo,
} from "../types";
import { rpcCircuitBreaker } from "../utils/circuitBreaker";
import { withRetry } from "../utils/retry";
import { sanitizeRpcError } from "../utils/rpcErrorSanitizer";

// Cache for contract existence checks (contractIdString -> { exists: boolean, timestamp: number })
const contractExistenceCache = new Map<
  string,
  { exists: boolean; timestamp: number }
>();

function extractRequiredSigners(
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[],
): { requiredSigners: string[]; threshold: number } {
  const signers = new Set<string>();
  for (const entry of auth) {
    try {
      const credentials = entry.credentials();
      if (credentials.switch().name === "sorobanCredentialsAddress") {
        const address = credentials.address();

        const credAddress = address as StellarSdk.xdr.SorobanAddressCredentials;
        const accountId = StellarSdk.StrKey.encodeEd25519PublicKey(
          credAddress.address().accountId().ed25519(),
        );
        signers.add(accountId);
      }
    } catch {
      // ignore invalid entries
    }
  }
  return { requiredSigners: Array.from(signers), threshold: signers.size };
}

/**
 * Check if a contract exists on the network by looking up its account ledger entry.
 */
async function _checkContractExists(
  server: StellarSdk.rpc.Server,
  contractIdString: string,
): Promise<boolean> {
  const now = Date.now();
  const cached = contractExistenceCache.get(contractIdString);
  if (cached && now - cached.timestamp < CACHE_TTL.CONTRACT_EXISTENCE_MS) {
    // Record cache hit
    metrics.recordCacheHit("contract_existence");
    return cached.exists;
  }

  // Record cache miss
  metrics.recordCacheMiss("contract_existence");

  try {
    const accountId =
      StellarSdk.StrKey.decodeEd25519PublicKey(contractIdString);
    const ledgerKey = StellarSdk.xdr.LedgerKey.account(
      new StellarSdk.xdr.LedgerKeyAccount({
        accountId: StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(accountId),
      }),
    );
    const response = await rpcCircuitBreaker.call(() =>
      server.getLedgerEntries(ledgerKey),
    );
    const exists = response.entries && response.entries.length > 0;
    contractExistenceCache.set(contractIdString, { exists, timestamp: now });
    return exists;
  } catch {
    // Record RPC error
    metrics.recordRpcError("unknown", "get_ledger_entries_failure");

    // If there's an error (e.g., network, invalid ID), assume contract does not exist
    contractExistenceCache.set(contractIdString, {
      exists: false,
      timestamp: now,
    });
    return false;
  }
}

/**
 * Fetch TTL information for footprint entries via RPC
 */
async function fetchTtlInfo(
  server: StellarSdk.rpc.Server,
  footprintEntries: string[],
  _network: Network,
): Promise<Record<string, TtlInfo>> {
  if (footprintEntries.length === 0) {
    return {};
  }

  try {
    const ledgerKeys = footprintEntries.map((xdr) => {
      return StellarSdk.xdr.LedgerKey.fromXDR(xdr, "base64");
    });

    const response = await rpcCircuitBreaker.call(() =>
      server.getLedgerEntries(...ledgerKeys),
    );

    const ttlMap: Record<string, TtlInfo> = {};
    const currentLedger = response.latestLedger ?? 0;

    if (response.entries) {
      for (let i = 0; i < response.entries.length; i++) {
        const entry = response.entries[i];
        const xdr = footprintEntries[i];

        if (entry.liveUntilLedgerSeq) {
          const liveUntilLedger = Number(entry.liveUntilLedgerSeq);
          const expiresInLedgers = liveUntilLedger - currentLedger;

          ttlMap[xdr] = {
            liveUntilLedger,
            expiresInLedgers,
          };
        }
      }
    }

    return ttlMap;
  } catch {
    // Record RPC error
    metrics.recordRpcError("unknown", "fetch_ttl_failure");
    // If TTL fetching fails, return empty map
    return {};
  }
}

/**
 * Build warnings for footprint entries expiring within 100 ledgers
 */
function buildTtlWarnings(ttl: Record<string, TtlInfo>): string[] {
  return Object.entries(ttl)
    .filter(([, info]) => info.expiresInLedgers < 100)
    .map(
      ([xdr, info]) =>
        `Footprint entry ${xdr.slice(0, 16)}… expires in ${info.expiresInLedgers} ledgers; restoration may be required soon.`,
    );
}

function buildLedgerSequenceWarning(
  ledgerSequence: number | undefined,
  latestLedger: number | undefined,
): string | undefined {
  if (
    ledgerSequence !== undefined &&
    latestLedger !== undefined &&
    latestLedger - ledgerSequence > 100
  ) {
    return `ledgerSequence ${ledgerSequence} is more than 100 ledgers behind latest ledger ${latestLedger}.`;
  }
  return undefined;
}

/**
 */
function base64ByteLength(b64: string): number {
  const len = b64.length;
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return (len * 3) / 4 - padding;
}

function calculateFootprintStats(
  readOnly: string[],
  readWrite: string[],
): FootprintStats {
  const readOnlySize = readOnly.reduce(
    (sum, xdr) => sum + base64ByteLength(xdr),
    0,
  );
  const readWriteSize = readWrite.reduce(
    (sum, xdr) => sum + base64ByteLength(xdr),
    0,
  );

  return {
    readOnlyCount: readOnly.length,
    readWriteCount: readWrite.length,
    totalEntries: readOnly.length + readWrite.length,
    estimatedSizeBytes: readOnlySize + readWriteSize,
  };
}

/**
 * Extract contract invocation details from transaction
 */
function _extractInvocation(
  tx: StellarSdk.Transaction<
    StellarSdk.Memo<StellarSdk.MemoType>,
    StellarSdk.Operation[]
  >,
): ContractInvocation | undefined {
  try {
    const op = tx.operations[0];
    if (!op || op.type !== "invokeHostFunction") {
      return undefined;
    }

    // Basic extraction - can be improved to parse xdr.HostFunction
    return {
      contractId: "",
      functionName: "",
      args: [],
    };
  } catch {
    return undefined;
  }
}

/**
 * Extract authorization entries from simulation response
 */
function _extractAuthEntries(
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[],
): AuthEntry[] {
  return auth.map((entry) => {
    return {
      contractId: "",
      functionName: "",
      xdr: entry.toXDR("base64"),
    };
  });
}

/**
 * Extract contract events from simulation response
 */
function _extractEvents(
  response: StellarSdk.rpc.Api.SimulateTransactionResponse,
): ContractEvent[] {
  const events =
    (response.events as unknown as StellarSdk.xdr.DiagnosticEvent[]) ?? [];

  return events.map((event: unknown) => {
    const e = event as {
      type?: () => { name?: string };
      contractId?: () => Buffer;
    };
    return {
      type: e.type?.()?.name || "unknown",
      contractId: e.contractId?.()?.toString("hex") || "",
      topics: [],
      data: "",
    };
  });
}

/**
 * Extract required signers from auth entries.
 */

/**
 * Result of a transaction simulation
 */
export interface SimulateResult {
  success: boolean;
  simulatedAt?: string;
  upgradedFromV0?: boolean;
  footprint?: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
  };
  contracts?: string[];
  contractType?: ContractType;
  ttl?: Record<string, TtlInfo>;
  optimized?: boolean;
  rawFootprint?: {
    readOnly: string[];
    readWrite: string[];
  };
  footprintStats?: FootprintStats;
  invocation?: ContractInvocation;
  authEntries?: AuthEntry[];
  events?: ContractEvent[];
  cost?: {
    cpuInsns: string;
    memBytes: string;
  };
  resourceFee?: string;
  error?: string;
  code?: ErrorCode;
  contractId?: string;
  raw?: StellarSdk.rpc.Api.SimulateTransactionResponse;
  requiredSigners?: string[];
  threshold?: number;
  operations?: SimulateResult[];
  feeBump?: boolean;
  diagnosticEvents?: string[];
  cacheHit?: boolean;
  type?: string;
  warnings?: string[];
}

/**
 * Common processing for a single simulation result
 */
async function _processSimulationResult(
  server: StellarSdk.rpc.Server,
  network: Network,
  transactionData: StellarSdk.xdr.SorobanTransactionData,
  cost?: { cpuInsns: string; memBytes: string },
): Promise<Partial<SimulateResult>> {
  const footprintXdr = transactionData.resources().footprint();
  const rawFootprint = {
    readOnly: footprintXdr.readOnly().map((e) => e.toXDR("base64")),
    readWrite: footprintXdr.readWrite().map((e) => e.toXDR("base64")),
  };

  const parsed = parseFootprint(rawFootprint);
  const optimizationResult = optimizeFootprint(
    parsed.readOnly,
    parsed.readWrite,
  );

  const allXdrEntries = [...rawFootprint.readOnly, ...rawFootprint.readWrite];
  const contracts = extractContracts(allXdrEntries);

  const [ttl, contractType] = await Promise.all([
    fetchTtlInfo(server, allXdrEntries, network),
    contracts.length > 0
      ? detectTokenContract(contracts[0], server)
      : Promise.resolve<ContractType>("unknown"),
  ]);

  // SorobanTransactionData.build() returns xdr.SorobanTransactionData which
  // exposes auth() at the XDR level; use unknown cast to avoid any.
  const builtData = transactionData as unknown as {
    auth?: () => StellarSdk.xdr.SorobanAuthorizationEntry[];
  };
  const auth = builtData.auth?.() ?? [];
  const { requiredSigners, threshold } = extractRequiredSigners(auth);

  const footprintStats = calculateFootprintStats(
    rawFootprint.readOnly,
    rawFootprint.readWrite,
  );

  return {
    success: true,
    footprint: {
      readOnly: optimizationResult.readOnly,
      readWrite: optimizationResult.readWrite,
    },
    contracts,
    contractType,
    ttl,
    optimized: optimizationResult.optimized,
    rawFootprint,
    footprintStats,
    cost: {
      cpuInsns: cost?.cpuInsns ?? "0",
      memBytes: cost?.memBytes ?? "0",
    },
    requiredSigners,
    threshold,
  };
}

/**
 * Simulate a Soroban transaction and extract its footprint
 */
export async function simulateTransaction(
  xdr: string,
  network: Network = "testnet",
  signal?: AbortSignal,
  ledgerSequence?: number,
): Promise<SimulateResult> {
  const cache = getCache();
  const cacheKey = buildCacheKey({ xdr, network, ledgerSequence });

  const cached = await cache.get<SimulateResult>(cacheKey);
  if (cached) {
    cached.cacheHit = true;
    metrics.recordCacheHit("simulation");
    return cached;
  }
  metrics.recordCacheMiss("simulation");

  // getNetworkConfig and getRpcServer are called inside the try block so that
  // synchronous throws (e.g. missing RPC URL) are caught by the caller's
  // error handler rather than propagating as unhandled rejections.
  let server: StellarSdk.rpc.Server;
  let networkPassphrase: string;
  let tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;

  let upgradedFromV0 = false;

  try {
    ({ networkPassphrase } = getNetworkConfig(network));
    server = getRpcServer(network);
    tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (err) {
    throw err;
  }

  // Upgrade v0 envelopes to v1 before simulation
  if (
    !(tx instanceof StellarSdk.FeeBumpTransaction) &&
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (tx as any).envelopeType?.().name === "envelopeTypeTxV0"
  ) {
    tx = StellarSdk.TransactionBuilder.cloneFrom(
      tx as StellarSdk.Transaction,
    ).build();
    upgradedFromV0 = true;
  }

  if (tx instanceof StellarSdk.FeeBumpTransaction) {
    const innerTx = tx.innerTransaction;
    const innerXdr = innerTx.toXDR();
    const result = await simulateTransaction(
      innerXdr,
      network,
      signal,
      ledgerSequence,
    );
    result.feeBump = true;
    return result;
  }

  // Reject classic (non-Soroban) transactions before hitting the RPC
  const hasSorobanOp = (tx as StellarSdk.Transaction).operations.some(
    (op) => op.type === "invokeHostFunction",
  );
  if (!hasSorobanOp) {
    return {
      success: false,
      type: "invalid_transaction" as const,
      error:
        "Transaction must contain a Soroban operation (invokeHostFunction).",
      code: ErrorCode.TRANSACTION_MISSING_SOROBAN_OPERATION,
    };
  }

  interface SimulateOptions {
    signal?: AbortSignal;
    includeEvents?: boolean;
    ledger?: number;
    cpuInstructions: number;
  }
  const simOptions: SimulateOptions = {
    signal,
    includeEvents: true,
    cpuInstructions: 0,
  };
  if (ledgerSequence !== undefined) {
    simOptions.ledger = ledgerSequence;
  }

  let response;
  try {
    response = await withRetry(
      () =>
        rpcCircuitBreaker.call(() =>
          server.simulateTransaction(
            tx as StellarSdk.Transaction,
            simOptions as Parameters<typeof server.simulateTransaction>[1],
          ),
        ),
      `simulateTransaction:${network}`,
    );
  } catch (err) {
    metrics.recordRpcError(network, "simulate_transaction_failure");
    throw err;
  }

  if (StellarSdk.rpc.Api.isSimulationError(response)) {
    return {
      success: false,
      type: "simulation_error" as const,
      error: sanitizeRpcError(response.error),
      code: ErrorCode.RPC_SIMULATION_ERROR,
      raw: response,
    };
  }

  if (StellarSdk.rpc.Api.isSimulationRestore(response)) {
    return {
      success: false,
      type: "restoration_required" as const,
      error: "Transaction requires ledger entry restoration before simulation.",
      code: ErrorCode.SIMULATION_RESTORE_REQUIRED,
      raw: response,
    };
  }

  const results = response.transactionData
    ? [{ transactionData: response.transactionData }]
    : [];

  if (results.length === 0) {
    return {
      success: false,
      error:
        "Simulation succeeded but transactionData is missing; cannot extract footprint.",
      code: ErrorCode.SIMULATION_DATA_MISSING,
      raw: response,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responseCost = (response as any).cost;
  const diagnosticEvents =
    response.events
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ?.filter((e) => (e as any).type?.()?.name === "diagnostic")
      .map((e) => e.toXDR("base64")) || [];

  let finalResult: SimulateResult;

  if (results.length === 1) {
    // Single operation — delegate to shared helper
    const result = results[0];
    if (!result.transactionData) {
      return {
        success: false,
        error:
          "Simulation succeeded but transactionData is missing; cannot extract footprint.",
        code: ErrorCode.SIMULATION_DATA_MISSING,
        raw: response,
      };
    }

    const processed = await _processSimulationResult(
      server,
      network,
      result.transactionData.build(),
      responseCost,
    );

    const ledgerWarning = buildLedgerSequenceWarning(
      ledgerSequence,
      response.latestLedger,
    );

    return {
      success: true,
      footprint: {
        readOnly: processed.footprint?.readOnly ?? [],
        readWrite: processed.footprint?.readWrite ?? [],
      },
      contracts: processed.contracts,
      contractType: processed.contractType,
      ttl: processed.ttl,
      optimized: processed.optimized,
      rawFootprint: processed.rawFootprint,
      footprintStats: processed.footprintStats,
      cost: {
        cpuInsns: responseCost?.cpuInsns ?? "0",
        memBytes: responseCost?.memBytes ?? "0",
      },
      warnings: [
        ...buildTtlWarnings(processed.ttl ?? {}),
        ...(ledgerWarning ? [ledgerWarning] : []),
      ],
      requiredSigners: processed.requiredSigners,
      threshold: processed.threshold,
      raw: response,
      upgradedFromV0: upgradedFromV0 || undefined,
      diagnosticEvents,
    };
  } else {
    // Multi operation — call helper per result and merge
    const operations: SimulateResult[] = [];
    let allReadOnly: FootprintEntry[] = [];
    let allReadWrite: FootprintEntry[] = [];
    let allContracts: string[] = [];
    const allTtl: Record<string, TtlInfo> = {};
    let contractType: ContractType = "unknown";
    let optimized = false;
    let allRawReadOnly: string[] = [];
    let allRawReadWrite: string[] = [];
    let totalCpuInsns = BigInt(0);
    let totalMemBytes = BigInt(0);

    for (const result of results) {
      if (!result.transactionData) {
        return {
          success: false,
          error:
            "Simulation succeeded but transactionData is missing for one operation; cannot extract footprint.",
          code: ErrorCode.SIMULATION_DATA_MISSING,
          raw: response,
        };
      }

      const processed = await _processSimulationResult(
        server,
        network,
        result.transactionData.build(),
      );

      const allXdrEntries = [
        ...(processed.rawFootprint?.readOnly ?? []),
        ...(processed.rawFootprint?.readWrite ?? []),
      ];

      const ttl = await fetchTtlInfo(server, allXdrEntries, network);

      const builtOpData = result.transactionData?.build() as unknown as {
        auth?: () => StellarSdk.xdr.SorobanAuthorizationEntry[];
      };
      const auth = builtOpData?.auth?.() ?? [];
      const { requiredSigners, threshold } = extractRequiredSigners(auth);

      const opContracts = processed.contracts ?? [];
      const opContractType =
        opContracts.length > 0
          ? await detectTokenContract(opContracts[0], server)
          : "unknown";

      if (contractType === "unknown") contractType = opContractType;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opCpuInsns = (result as any).cost?.cpuInsns ?? "0";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const opMemBytes = (result as any).cost?.memBytes ?? "0";
      totalCpuInsns += BigInt(opCpuInsns);
      totalMemBytes += BigInt(opMemBytes);

      const opResult: SimulateResult = {
        success: true,
        footprint: {
          readOnly: processed.footprint?.readOnly ?? [],
          readWrite: processed.footprint?.readWrite ?? [],
        },
        contracts: opContracts,
        contractType: opContractType,
        ttl,
        optimized: processed.optimized,
        rawFootprint: processed.rawFootprint,
        footprintStats: processed.footprintStats,
        cost: {
          cpuInsns: opCpuInsns,
          memBytes: opMemBytes,
        },
        warnings: buildTtlWarnings(ttl),
        requiredSigners,
        threshold,
      };

      operations.push(opResult);

      allReadOnly = [...allReadOnly, ...(processed.footprint?.readOnly ?? [])];
      allReadWrite = [
        ...allReadWrite,
        ...(processed.footprint?.readWrite ?? []),
      ];
      allContracts = [...allContracts, ...(processed.contracts ?? [])];
      Object.assign(allTtl, processed.ttl ?? {});
      if (processed.optimized) optimized = true;
      if (contractType === "unknown" && processed.contractType !== "unknown") {
        contractType = processed.contractType as ContractType;
      }
      allRawReadOnly = [
        ...allRawReadOnly,
        ...(processed.rawFootprint?.readOnly ?? []),
      ];
      allRawReadWrite = [
        ...allRawReadWrite,
        ...(processed.rawFootprint?.readWrite ?? []),
      ];
    }

    // Dedup
    const dedupReadOnly = allReadOnly.filter(
      (item, index, arr) => arr.findIndex((i) => i.xdr === item.xdr) === index,
    );
    const dedupReadWrite = allReadWrite.filter(
      (item, index, arr) => arr.findIndex((i) => i.xdr === item.xdr) === index,
    );
    const dedupRawReadOnly = allRawReadOnly.filter(
      (item, index, arr) => arr.indexOf(item) === index,
    );
    const dedupRawReadWrite = allRawReadWrite.filter(
      (item, index, arr) => arr.indexOf(item) === index,
    );

    const multiLedgerWarning = buildLedgerSequenceWarning(
      ledgerSequence,
      response.latestLedger,
    );

    finalResult = {
      success: true,
      footprint: { readOnly: dedupReadOnly, readWrite: dedupReadWrite },
      contracts: [...new Set(allContracts)],
      contractType,
      ttl: allTtl,
      optimized,
      rawFootprint: {
        readOnly: allRawReadOnly,
        readWrite: allRawReadWrite,
      },
      footprintStats: calculateFootprintStats(allRawReadOnly, allRawReadWrite),
      cost: {
        cpuInsns: totalCpuInsns.toString(),
        memBytes: totalMemBytes.toString(),
      },
      warnings: [
        ...buildTtlWarnings(allTtl),
        ...(multiLedgerWarning ? [multiLedgerWarning] : []),
      ],
      operations,
      raw: response,
      diagnosticEvents,
    };
  }

  if (finalResult.success) {
    await cache.set(cacheKey, finalResult, CACHE_TTL_MS);
  }

  return finalResult;
}
