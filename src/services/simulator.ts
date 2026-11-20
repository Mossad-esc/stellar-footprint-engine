import { Network, getNetworkConfig, getRpcServer } from "@config/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

import {
  ErrorCode,
  TTL_WARNING_THRESHOLD_LEDGERS,
  TTL_EXTENSION_SAFETY_LEDGERS,
} from "../constants";
import metrics from "../middleware/metrics";
import { buildCacheKey, getCache } from "../services/cache";
import { ContractType } from "../types";
import {
  FootprintStats,
  AuthEntry,
  ContractEvent,
  ContractInvocation,
  TtlInfo,
  TtlExtensionRecommendation,
  DryRunResult,
  AuthorizationInvocation,
  AuthorizationLevel,
  SignerThresholdReport,
  DiagnosticEvent,
} from "../types";
import { rpcCircuitBreaker } from "../utils/circuitBreaker";
import { withRetry } from "../utils/retry";
import { sanitizeRpcError } from "../utils/rpcErrorSanitizer";
import {
  parseFootprint,
  parseContractInvocation,
  hasContractCreationInstance,
  extractContracts,
  detectTokenContract,
  mergeFootprints,
  detectSacContracts,
  calculateFootprintStats,
  type FootprintEntry,
} from "./footprintParser";

// ---------------------------------------------------------------------------
// Soroban call stack depth — protocol ceiling is 10
// ---------------------------------------------------------------------------

const CALL_DEPTH_PROTOCOL_LIMIT = 10;
const CALL_DEPTH_WARNING_THRESHOLD = CALL_DEPTH_PROTOCOL_LIMIT - 2; // ≥ 8

/**
 * Measure the maximum nesting depth of contract_call events by walking the
 * invocation tree returned in the simulation result.  Falls back to scanning
 * the flat diagnostic event list when no structured tree is available.
 */
export function measureCallDepth(
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
): number {
  // Walk the structured invocation tree when it is available.
  if (response.result?.retval !== undefined) {
    const auth = response.result.auth ?? [];
    if (auth.length > 0) {
      const depthOfInvocation = (
        node: StellarSdk.xdr.SorobanAuthorizedInvocation,
        current: number,
      ): number => {
        if (node.subInvocations.length === 0) return current;
        return Math.max(
          ...node.subInvocations.map((child) =>
            depthOfInvocation(child, current + 1),
          ),
        );
      };
      const maxFromAuth = Math.max(
        1,
        ...auth.map((entry) => depthOfInvocation(entry.rootInvocation, 1)),
      );
      if (maxFromAuth > 1) return maxFromAuth;
    }
  }

  // Fallback: count call_stack / contract_call markers in diagnostic events.
  const events = response.events ?? [];
  if (events.length === 0) return 1;

  let currentDepth = 0;
  let maxDepth = 0;
  for (const rawEvent of events) {
    try {
      const ev = rawEvent as unknown as {
        inSuccessfulContractCall?: boolean;
      };
      if (ev.inSuccessfulContractCall) {
        currentDepth++;
        maxDepth = Math.max(maxDepth, currentDepth);
      } else {
        currentDepth = Math.max(0, currentDepth - 1);
      }
    } catch {
      /* skip undecodable events */
    }
  }

  return Math.max(1, maxDepth);
}

// ---------------------------------------------------------------------------
// Diagnostic events parser (issue #20)
// ---------------------------------------------------------------------------

/**
 * Parse raw XDR diagnostic events into structured DiagnosticEvent objects.
 * Handles both base64 XDR strings and pre-parsed SDK objects.
 */
export function parseDiagnosticEvents(rawEvents: unknown[]): DiagnosticEvent[] {
  return rawEvents.flatMap((raw) => {
    const xdrBase64 =
      typeof raw === "string"
        ? raw
        : (() => {
            try {
              return (raw as { toXDR: (enc: string) => string }).toXDR(
                "base64",
              );
            } catch {
              return null;
            }
          })();

    if (!xdrBase64) return [];

    try {
      const diagEvent = StellarSdk.xdr.DiagnosticEvent.fromXDR(
        xdrBase64,
        "base64",
      );
      const contractEvent = diagEvent.event;
      const topicVals = contractEvent.body.v0.topics;
      const dataVal = contractEvent.body.v0.data;

      // Determine topic name from the first topic symbol
      let topic = "unknown";
      if (topicVals.length > 0) {
        const first = topicVals[0];
        if (first.type === "scvSymbol") {
          topic = first.sym.toString();
        } else if (first.type === "scvString") {
          topic = first.str.toString();
        }
      }

      // Categorize log level
      let logLevel: DiagnosticEvent["logLevel"] = "debug";
      if (topic === "error" || topic.startsWith("HostError")) {
        logLevel = "error";
      } else if (topic === "warn" || topic === "warning") {
        logLevel = "warn";
      } else if (topic === "info" || topic === "log") {
        logLevel = "info";
      } else if (topic === "fn_call" || topic === "fn_return") {
        logLevel = "debug";
      }

      // Decode data payload
      let data: unknown = xdrBase64;
      try {
        data = StellarSdk.scValToNative(dataVal);
      } catch {
        try {
          data = dataVal.toXDR("base64");
        } catch {
          data = null;
        }
      }

      // Extract error code from HostError patterns in topics or data
      let errorCode: number | string | undefined;
      if (logLevel === "error") {
        for (const topicVal of topicVals) {
          try {
            const native = StellarSdk.scValToNative(topicVal);
            if (typeof native === "number" || typeof native === "bigint") {
              errorCode = Number(native);
              break;
            }
            if (typeof native === "string") {
              const match = native.match(/#(\d+)/);
              if (match) {
                errorCode = parseInt(match[1], 10);
                break;
              }
              if (native.includes("Error(")) {
                errorCode = native;
                break;
              }
            }
          } catch {
            /* ignore */
          }
        }
        // Also check data for numeric error codes
        if (errorCode === undefined) {
          if (typeof data === "number") errorCode = data;
          else if (typeof data === "bigint") errorCode = Number(data);
          else if (typeof data === "string") {
            const match = data.match(/#(\d+)/);
            if (match) errorCode = parseInt(match[1], 10);
          }
        }
      }

      return [
        {
          logLevel,
          topic,
          data,
          ...(errorCode !== undefined ? { errorCode } : {}),
          xdr: xdrBase64,
        },
      ];
    } catch {
      return [
        {
          logLevel: "debug" as const,
          topic: "unknown",
          data: null,
          xdr: xdrBase64,
        },
      ];
    }
  });
}

// ---------------------------------------------------------------------------
// TTL helpers
// ---------------------------------------------------------------------------

/** Match TTL records by ledger key hash, never by RPC response position. */
function isTtlKey(key: StellarSdk.xdr.LedgerKey): boolean {
  return (
    key.type === "contractCode" ||
    (key.type === "contractData" &&
      key.contractData.durability.name === "persistent")
  );
}

async function fetchTtlInfo(
  server: StellarSdk.rpc.Server,
  footprintEntries: string[],
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
): Promise<Record<string, TtlInfo>> {
  const keys = [...new Set(footprintEntries)].map((value) =>
    StellarSdk.xdr.LedgerKey.fromXDR(value, "base64"),
  );
  const touched = new Set(footprintEntries);
  const ttlMap: Record<string, TtlInfo> = {};
  const byHash = new Map(
    keys
      .filter(isTtlKey)
      .map((key) => [
        Buffer.from(StellarSdk.hash(key.toXDR())).toString("hex"),
        key.toXDR("base64"),
      ]),
  );
  const record = (key: string, liveUntilLedger: number) => {
    const expiresInLedgers = liveUntilLedger - response.latestLedger;
    ttlMap[key] = {
      liveUntilLedger,
      expiresInLedgers,
      requiresExtension: expiresInLedgers < TTL_EXTENSION_SAFETY_LEDGERS,
      requiresRestore: expiresInLedgers < 0,
    };
  };
  for (const change of response.stateChanges ?? []) {
    const data = (change.before ?? change.after)?.data;
    if (data?.type === "ttl") {
      const ttl = data.ttl;
      const key = byHash.get(ttl.keyHash.toString());
      if (key) record(key, ttl.liveUntilLedgerSeq);
    }
  }
  const missing = keys.filter(
    (key) => isTtlKey(key) && !ttlMap[key.toXDR("base64")],
  );
  try {
    for (let offset = 0; offset < missing.length; offset += 200) {
      const lookup = await rpcCircuitBreaker.call(() =>
        server.getLedgerEntries(...missing.slice(offset, offset + 200)),
      );
      for (const entry of lookup.entries) {
        const key = entry.key.toXDR("base64");
        if (touched.has(key) && entry.liveUntilLedgerSeq !== undefined)
          record(key, entry.liveUntilLedgerSeq);
      }
    }
  } catch {
    metrics.recordRpcError("unknown", "fetch_ttl_failure");
  }
  if (StellarSdk.rpc.Api.isSimulationRestore(response)) {
    const restored =
      response.restorePreamble.transactionData.build().resources.footprint;
    for (const key of [...restored.readOnly, ...restored.readWrite]) {
      const value = key.toXDR("base64");
      if (isTtlKey(key) && touched.has(value)) {
        ttlMap[value] = {
          ...(ttlMap[value] ?? {
            liveUntilLedger: null,
            expiresInLedgers: null,
          }),
          requiresRestore: true,
          requiresExtension: true,
        };
      }
    }
  }
  for (const key of keys.filter(isTtlKey)) {
    const encoded = key.toXDR("base64");
    ttlMap[encoded] ??= { liveUntilLedger: null, expiresInLedgers: null };
  }
  return ttlMap;
}

function buildTtlWarnings(ttl: Record<string, TtlInfo>): string[] {
  return Object.entries(ttl)
    .filter(
      ([, info]) =>
        info.requiresRestore ||
        (info.expiresInLedgers !== null &&
          info.expiresInLedgers < TTL_WARNING_THRESHOLD_LEDGERS),
    )
    .map(([key, info]) =>
      info.requiresRestore
        ? `Footprint entry ${key} is archived; restore it before extending its TTL.`
        : `Footprint entry ${key} expires in ${info.expiresInLedgers} ledgers; extend its TTL to at least ${TTL_WARNING_THRESHOLD_LEDGERS} ledgers.`,
    );
}

function recommendTtlExtension(
  ttl: Record<string, TtlInfo>,
): TtlExtensionRecommendation | undefined {
  const entries = Object.keys(ttl).filter(
    (key) =>
      ttl[key].requiresRestore ||
      (ttl[key].expiresInLedgers !== null &&
        ttl[key].expiresInLedgers < TTL_WARNING_THRESHOLD_LEDGERS),
  );
  if (!entries.length) return undefined;
  return {
    extendTo: Math.max(
      TTL_WARNING_THRESHOLD_LEDGERS,
      TTL_EXTENSION_SAFETY_LEDGERS,
    ),
    entries,
    restoreFirst: entries.some((key) => ttl[key].requiresRestore),
  };
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

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FootprintBreakdown {
  contractCode: {
    count: number;
    estimatedSizeBytes: number;
    readOnly: string[];
    readWrite: string[];
  };
  contractInstance: {
    count: number;
    estimatedSizeBytes: number;
    readOnly: string[];
    readWrite: string[];
  };
  persistentData: {
    count: number;
    estimatedSizeBytes: number;
    readOnly: string[];
    readWrite: string[];
  };
  temporaryData: {
    count: number;
    estimatedSizeBytes: number;
    readOnly: string[];
    readWrite: string[];
  };
}

export interface AssetInfo {
  code: string;
  issuer?: string;
}

export interface SacContract {
  contractId: string;
  isSAC: true;
  assetInfo?: AssetInfo;
}

export interface SimulateResult {
  success: boolean;
  simulatedAt?: string;
  upgradedFromV0?: boolean;
  footprint?: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
    breakdown?: FootprintBreakdown;
  };
  contracts?: string[];
  contractType?: ContractType;
  isSAC?: boolean;
  assetInfo?: AssetInfo;
  sacContracts?: SacContract[];
  ttl?: Record<string, TtlInfo>;
  ttlWarnings?: string[];
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
    ttlExtension?: TtlExtensionRecommendation;
  };
  resourceFee?: string;
  error?: string;
  code?: ErrorCode;
  contractId?: string;
  raw?: StellarSdk.rpc.Api.SimulateTransactionResponse;
  requiredSigners?: string[];
  threshold?: number;
  signerThresholdReports?: SignerThresholdReport[];
  operations?: SimulateResult[];
  feeBump?: boolean;
  diagnosticEvents?: string[];
  /** Structured parsed diagnostic events (issue #20). */
  parsedDiagnosticEvents?: DiagnosticEvent[];
  cacheHit?: boolean;
  type?: string;
  warnings?: string[];
  /** Maximum cross-contract call stack depth measured from the simulation (issue #19). */
  maxCallDepth?: number;
}

// ---------------------------------------------------------------------------
// Core simulation processing
// ---------------------------------------------------------------------------

async function _processSimulationResult(
  server: StellarSdk.rpc.Server,
  network: Network,
  transactionData: StellarSdk.xdr.SorobanTransactionData,
  cost: { cpuInsns: string; memBytes: string } | undefined,
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  tx: StellarSdk.Transaction,
): Promise<Partial<SimulateResult>> {
  const { networkPassphrase } = getNetworkConfig(network);
  const footprintXdr = transactionData.resources.footprint;
  const rawFootprint = {
    readOnly: footprintXdr.readOnly.map((e) => e.toXDR("base64")),
    readWrite: footprintXdr.readWrite.map((e) => e.toXDR("base64")),
  };

  const merged = mergeFootprints([rawFootprint]);
  const initial = parseFootprint(merged, networkPassphrase);
  const sacContracts = await detectSacContracts(
    [...initial.readOnly, ...initial.readWrite],
    server,
    networkPassphrase,
  );
  const parsed = parseFootprint(merged, networkPassphrase, sacContracts);
  const optimized =
    merged.readOnly.length + merged.readWrite.length <
    rawFootprint.readOnly.length + rawFootprint.readWrite.length;

  const allXdrEntries = [...rawFootprint.readOnly, ...rawFootprint.readWrite];
  const contracts = extractContracts(allXdrEntries);

  const [ttl, contractType, accounts] = await Promise.all([
    fetchTtlInfo(server, allXdrEntries, response),
    contracts.length > 0
      ? detectTokenContract(contracts[0], server)
      : Promise.resolve<ContractType>("unknown"),
    fetchTouchedAccounts(server, allXdrEntries, response),
  ]);

  const auth = simulationAuth(response, tx);
  const authorization = extractRequiredSigners(auth, invocationSource(tx));
  const signerThresholdReports = buildThresholdReports(auth, tx, accounts);
  const invocationOp = tx.operations.find(
    (op) => op.type === "invokeHostFunction",
  );
  const invocation =
    invocationOp?.type === "invokeHostFunction" &&
    invocationOp.func.type === "hostFunctionTypeInvokeContract"
      ? describeInvocation(invocationOp.func.invokeContract)
      : undefined;

  const footprintStats = calculateFootprintStats(merged, parsed);

  return {
    success: true,
    footprint: {
      readOnly: parsed.readOnly.map((entry) => ({
        ...entry,
        ttlInfo: ttl[entry.xdr],
      })),
      readWrite: parsed.readWrite.map((entry) => ({
        ...entry,
        ttlInfo: ttl[entry.xdr],
      })),
    },
    contracts,
    contractType,
    isSAC: parsed.isSAC,
    assetInfo: parsed.assetInfo,
    sacContracts: parsed.sacContracts,
    ttl,
    optimized,
    rawFootprint,
    footprintStats,
    cost: {
      cpuInsns: cost?.cpuInsns ?? "0",
      memBytes: cost?.memBytes ?? "0",
    },
    ...authorization,
    signerThresholdReports,
    invocation,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

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
    tx.toEnvelope().type === "envelopeTypeTxV0"
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

  let response: StellarSdk.rpc.Api.SimulateTransactionResponse;
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
    const rawDiagEvents = response.events ?? [];
    const parsedDiagnosticEvents = parseDiagnosticEvents(rawDiagEvents);
    return {
      success: false,
      type: "simulation_error" as const,
      error: sanitizeRpcError(response.error),
      code: ErrorCode.RPC_SIMULATION_ERROR,
      diagnosticEvents: rawDiagEvents.map((e) => {
        try {
          return (e as unknown as { toXDR: (enc: string) => string }).toXDR(
            "base64",
          );
        } catch {
          return String(e);
        }
      }),
      parsedDiagnosticEvents,
      raw: response,
    };
  }

  if (StellarSdk.rpc.Api.isSimulationRestore(response)) {
    const data = response.transactionData.build().resources.footprint;
    const restoreData =
      response.restorePreamble.transactionData.build().resources.footprint;
    const keys = [
      ...data.readOnly,
      ...data.readWrite,
      ...restoreData.readOnly,
      ...restoreData.readWrite,
    ];
    const ttl = await fetchTtlInfo(
      server,
      [...new Set(keys.map((key) => key.toXDR("base64")))],
      response,
    );
    const ttlWarnings = buildTtlWarnings(ttl);
    return {
      success: false,
      type: "restoration_required",
      error: "Transaction requires ledger entry restoration before simulation.",
      code: ErrorCode.SIMULATION_RESTORE_REQUIRED,
      ttl,
      ttlWarnings,
      warnings: ttlWarnings,
      cost: {
        cpuInsns: "0",
        memBytes: "0",
        ttlExtension: recommendTtlExtension(ttl),
      },
      raw: response,
    };
  }

  if (!response.transactionData) {
    return {
      success: false,
      error:
        "Simulation succeeded but transactionData is missing; cannot extract footprint.",
      code: ErrorCode.SIMULATION_DATA_MISSING,
      raw: response,
    };
  }

  const responseCost = (
    response as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse & {
      cost?: { cpuInsns: string; memBytes: string };
    }
  ).cost;

  const processed = await _processSimulationResult(
    server,
    network,
    response.transactionData.build(),
    responseCost,
    response,
    tx as StellarSdk.Transaction,
  );

  const ttl = processed.ttl ?? {};
  const ttlWarnings = buildTtlWarnings(ttl);
  const ledgerWarning = buildLedgerSequenceWarning(
    ledgerSequence,
    response.latestLedger,
  );
  const ttlExtension = recommendTtlExtension(ttl);

  // --- Issue #20: parse diagnostic events ---
  const rawDiagEvents = response.events ?? [];
  const parsedDiagnosticEvents = parseDiagnosticEvents(rawDiagEvents);

  // --- Issue #19: measure call stack depth ---
  const maxCallDepth = measureCallDepth(response);
  const callDepthWarning =
    maxCallDepth >= CALL_DEPTH_WARNING_THRESHOLD
      ? `Call stack depth ${maxCallDepth} is within ${CALL_DEPTH_PROTOCOL_LIMIT - maxCallDepth} of the protocol limit (${CALL_DEPTH_PROTOCOL_LIMIT}). This transaction may fail under slightly different state conditions.`
      : undefined;

  const warnings = [
    ...ttlWarnings,
    ...(ledgerWarning ? [ledgerWarning] : []),
    ...(callDepthWarning ? [callDepthWarning] : []),
  ];

  // --- Issue #21: check constructor simulation ---
  const op = (tx as StellarSdk.Transaction).operations[0];
  const { networkPassphrase: netPassphrase } = getNetworkConfig(network);
  const invocationCheck =
    op?.type === "invokeHostFunction" && op.func
      ? parseContractInvocation(op.func, netPassphrase)
      : undefined;
  if (
    invocationCheck?.isContractCreation &&
    !hasContractCreationInstance(
      invocationCheck,
      processed.rawFootprint?.readWrite ?? [],
    )
  ) {
    return {
      success: false,
      error:
        "Contract creation simulation is missing the writable contract instance key.",
      code: ErrorCode.SIMULATION_DATA_MISSING,
      invocation: invocationCheck,
      raw: response,
    };
  }

  const result: SimulateResult = {
    ...processed,
    success: true,
    cost: {
      cpuInsns: responseCost?.cpuInsns ?? "0",
      memBytes: responseCost?.memBytes ?? "0",
      ...(ttlExtension ? { ttlExtension } : {}),
    },
    ttlWarnings,
    warnings,
    raw: response,
    upgradedFromV0: upgradedFromV0 || undefined,
    diagnosticEvents: rawDiagEvents.map((e) => {
      try {
        return (e as unknown as { toXDR: (enc: string) => string }).toXDR(
          "base64",
        );
      } catch {
        return String(e);
      }
    }),
    parsedDiagnosticEvents,
    maxCallDepth,
  };

  await cache.set(cacheKey, result, 60_000);
  return result;
}

export function simulateDryRun(
  xdr: string,
  network: Network = "testnet",
): DryRunResult {
  const { networkPassphrase } = getNetworkConfig(network);
  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const inner =
    tx instanceof StellarSdk.FeeBumpTransaction ? tx.innerTransaction : tx;
  const operations = inner.operations.map((op) => {
    const invocation =
      op.type === "invokeHostFunction" && op.func
        ? parseContractInvocation(op.func, networkPassphrase)
        : undefined;
    const auth = op.type === "invokeHostFunction" ? (op.auth ?? []) : [];
    const { requiredSigners, authEntries } = extractRequiredSigners(
      auth,
      invocationSource(inner as StellarSdk.Transaction),
    );
    return {
      type: op.type,
      source: op.source ?? null,
      invocation,
      authEntries,
      requiredSigners,
    };
  });
  return {
    dryRun: true,
    network,
    sourceAccount: inner.source,
    sequence: inner.sequence,
    operationCount: operations.length,
    operations,
  };
}

// ---------------------------------------------------------------------------
// Invocation description helpers
// ---------------------------------------------------------------------------

/** ScVal maps retain their key types and wide integers never pass through Number. */
function formatScVal(value: StellarSdk.xdr.ScVal): string {
  switch (value.type) {
    case "scvVec":
      return `[${(value.vec ?? []).map(formatScVal).join(", ")}]`;
    case "scvMap":
      return `{${(value.map ?? []).map((entry) => `${formatScVal(entry.key)}: ${formatScVal(entry.val)}`).join(", ")}}`;
    case "scvAddress":
      return StellarSdk.Address.fromScAddress(value.address).toString();
    case "scvSymbol":
      return value.sym.toString();
    case "scvString":
      return JSON.stringify(value.str.toString());
    case "scvBytes":
      return `0x${Buffer.from(value.bytes as unknown as Uint8Array).toString("hex")}`;
    default: {
      try {
        const native: unknown = StellarSdk.scValToNative(value);
        return typeof native === "bigint"
          ? native.toString()
          : JSON.stringify(native);
      } catch {
        return value.toXDR("base64");
      }
    }
  }
}

function describeInvocation(
  args: StellarSdk.xdr.InvokeContractArgs,
): ContractInvocation {
  const functionName = args.functionName.toString();
  const types = args.args.map((arg: StellarSdk.xdr.ScVal) => arg.type);
  const tokenSignatures: Record<string, string[]> = {
    transfer: ["scvAddress", "scvAddress", "scvI128"],
    balance: ["scvAddress"],
    approve: ["scvAddress", "scvAddress", "scvI128", "scvU32"],
    transfer_from: ["scvAddress", "scvAddress", "scvAddress", "scvI128"],
    allowance: ["scvAddress", "scvAddress"],
    burn: ["scvAddress", "scvI128"],
    burn_from: ["scvAddress", "scvAddress", "scvI128"],
  };
  const oracleSignatures: Record<string, string[]> = {
    lastprice: ["scvVec"],
    price: ["scvVec", "scvU64"],
    prices: ["scvVec", "scvU32"],
    resolution: [],
    base: [],
    assets: [],
  };
  const matches = (signature: string[] | undefined) =>
    signature !== undefined &&
    signature.length === types.length &&
    signature.every((type, index) => types[index] === type);
  const name = matches(tokenSignatures[functionName])
    ? "SEP-41"
    : matches(oracleSignatures[functionName])
      ? "SEP-40"
      : ["propose", "vote", "execute", "cancel", "queue"].includes(functionName)
        ? "DAO governance"
        : "unknown";
  return {
    contractId: StellarSdk.Address.fromScAddress(
      args.contractAddress,
    ).toString(),
    functionName,
    args: args.args.map((arg: StellarSdk.xdr.ScVal) => formatScVal(arg)),
    argTypes: types,
    interfaceEstimation: { name, basis: "function name and argument types" },
  };
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const ADMIN_FUNCTIONS = new Set([
  "set_admin",
  "set_authority",
  "set_thresholds",
  "upgrade",
  "mint",
  "clawback",
]);

function describeAuthTree(
  node: StellarSdk.xdr.SorobanAuthorizedInvocation,
): AuthorizationInvocation {
  const fn = node.function;
  const invocation =
    fn.type === "sorobanAuthorizedFunctionTypeContractFn"
      ? describeInvocation(fn.contractFn)
      : undefined;
  const subInvocations = node.subInvocations.map(describeAuthTree);
  const authorizationLevel =
    !invocation ||
    ADMIN_FUNCTIONS.has(invocation.functionName) ||
    subInvocations.some((child) => child.authorizationLevel === "admin")
      ? "admin"
      : "payment";
  return { type: fn.type, invocation, authorizationLevel, subInvocations };
}

function addressCredentials(
  credentials: StellarSdk.xdr.SorobanCredentials,
): StellarSdk.xdr.SorobanAddressCredentials | undefined {
  switch (credentials.type) {
    case "sorobanCredentialsAddress":
      return credentials.address;
    case "sorobanCredentialsAddressV2":
      return credentials.addressV2;
    case "sorobanCredentialsAddressWithDelegates":
      return credentials.addressWithDelegates.addressCredentials;
    default:
      return undefined;
  }
}

function authorizer(
  entry: StellarSdk.xdr.SorobanAuthorizationEntry,
  source: string,
): string {
  const credentials = addressCredentials(entry.credentials);
  return credentials
    ? StellarSdk.Address.fromScAddress(credentials.address).toString()
    : source;
}

function extractRequiredSigners(
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[],
  source: string,
): {
  requiredSigners: string[];
  threshold: number;
  authEntries: AuthEntry[];
} {
  const requiredSigners = new Set<string>();
  const authEntries: AuthEntry[] = [];
  const seen = new Set<string>();
  for (const entry of auth) {
    const encoded = entry.toXDR("base64");
    if (seen.has(encoded)) continue;
    seen.add(encoded);
    const address = authorizer(entry, source);
    requiredSigners.add(address);
    const invocationTree = describeAuthTree(entry.rootInvocation);
    authEntries.push({
      contractId: invocationTree.invocation?.contractId ?? "",
      functionName: invocationTree.invocation?.functionName ?? "",
      xdr: encoded,
      authorizer: address,
      credentialsType: entry.credentials.type,
      invocationTree,
    });
    if (entry.credentials.type === "sorobanCredentialsAddressWithDelegates") {
      const visit = (delegates: StellarSdk.xdr.SorobanDelegateSignature[]) => {
        for (const delegate of delegates) {
          requiredSigners.add(
            StellarSdk.Address.fromScAddress(delegate.address).toString(),
          );
          visit(delegate.nestedDelegates);
        }
      };
      visit(entry.credentials.addressWithDelegates.delegates);
    }
  }
  return {
    requiredSigners: [...requiredSigners],
    threshold: requiredSigners.size,
    authEntries,
  };
}

function invocationSource(tx: StellarSdk.Transaction): string {
  return (
    tx.operations.find((op) => op.type === "invokeHostFunction")?.source ??
    tx.source
  );
}

function simulationAuth(
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  tx: StellarSdk.Transaction,
): StellarSdk.xdr.SorobanAuthorizationEntry[] {
  const existing = tx.operations.flatMap((op) =>
    op.type === "invokeHostFunction" ? (op.auth ?? []) : [],
  );
  const source = invocationSource(tx);
  const identity = (entry: StellarSdk.xdr.SorobanAuthorizationEntry) =>
    `${authorizer(entry, source)}:${entry.rootInvocation.toXDR("base64")}`;
  const fromEnvelope = new Map(
    existing.map((entry) => [identity(entry), entry]),
  );
  return (response.result?.auth ?? existing).map(
    (entry) => fromEnvelope.get(identity(entry)) ?? entry,
  );
}

async function fetchTouchedAccounts(
  server: StellarSdk.rpc.Server,
  rawKeys: string[],
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
): Promise<Map<string, StellarSdk.xdr.AccountEntry>> {
  const accounts = new Map<string, StellarSdk.xdr.AccountEntry>();
  const put = (data: StellarSdk.xdr.LedgerEntryData) => {
    if (data.type === "account") {
      const acct = data.account;
      const pk = acct.accountId;
      if (pk.type === "publicKeyTypeEd25519") {
        accounts.set(
          StellarSdk.StrKey.encodeEd25519PublicKey(
            pk.ed25519 as unknown as Uint8Array,
          ),
          acct,
        );
      }
    }
  };
  for (const change of response.stateChanges ?? []) {
    if (change.before) put(change.before.data);
  }
  const keys = [...new Set(rawKeys)]
    .map((key) => StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"))
    .filter((key) => {
      if (key.type !== "account") return false;
      const pk = key.account.accountId;
      if (pk.type !== "publicKeyTypeEd25519") return false;
      const encoded = StellarSdk.StrKey.encodeEd25519PublicKey(
        pk.ed25519 as unknown as Uint8Array,
      );
      return !accounts.has(encoded);
    });
  try {
    for (let i = 0; i < keys.length; i += 200) {
      const entries = await rpcCircuitBreaker.call(() =>
        server.getLedgerEntries(...keys.slice(i, i + 200)),
      );
      for (const entry of entries.entries) put(entry.val);
    }
  } catch {
    metrics.recordRpcError("unknown", "fetch_signer_weights_failure");
  }
  return accounts;
}

function suppliedSignatureKeys(signature: StellarSdk.xdr.ScVal): string[] {
  if (signature.type !== "scvVec") return [];
  const keys = new Set<string>();
  for (const value of signature.vec ?? []) {
    if (value.type !== "scvMap") continue;
    const fields = new Map(
      (value.map ?? []).flatMap((field: StellarSdk.xdr.ScMapEntry) =>
        field.key.type === "scvSymbol"
          ? [[field.key.sym.toString(), field.val] as const]
          : [],
      ),
    );
    const key = fields.get("public_key");
    const sig = fields.get("signature");
    if (
      key?.type === "scvBytes" &&
      (key.bytes as unknown as Uint8Array).length === 32 &&
      sig?.type === "scvBytes" &&
      (sig.bytes as unknown as Uint8Array).length === 64
    )
      keys.add(
        StellarSdk.StrKey.encodeEd25519PublicKey(
          key.bytes as unknown as Uint8Array,
        ),
      );
  }
  return [...keys];
}

function buildThresholdReports(
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[],
  tx: StellarSdk.Transaction,
  accounts: Map<string, StellarSdk.xdr.AccountEntry>,
): SignerThresholdReport[] {
  const source = invocationSource(tx);
  const reports: SignerThresholdReport[] = [];
  const seen = new Set<string>();
  const report = (
    accountId: string,
    authorizationLevel: AuthorizationLevel,
    signature: StellarSdk.xdr.ScVal | undefined,
    invocationXdr: string,
  ) => {
    const identity = `${accountId}:${invocationXdr}:${signature?.toXDR("base64") ?? "source"}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    const account = accounts.get(accountId);
    const weights = new Map<string, number>();
    if (account) {
      const threshBytes = Buffer.from(
        account.thresholds as unknown as Uint8Array,
      );
      weights.set(accountId, threshBytes[0]);
      for (const signer of account.signers) {
        if (signer.key.type === "signerKeyTypeEd25519")
          weights.set(
            StellarSdk.StrKey.encodeEd25519PublicKey(
              signer.key.ed25519 as unknown as Uint8Array,
            ),
            signer.weight,
          );
      }
    }
    const keys = signature
      ? suppliedSignatureKeys(signature)
      : [...weights.keys()].filter((key) =>
          tx.signatures.some((sig) =>
            StellarSdk.Keypair.fromPublicKey(key).verify(
              tx.hash(),
              sig.signature as unknown as Buffer,
            ),
          ),
        );
    const signers = keys.map((publicKey) => ({
      publicKey,
      weight: account ? (weights.get(publicKey) ?? 0) : null,
    }));
    const threshBytes = account
      ? Buffer.from(account.thresholds as unknown as Uint8Array)
      : null;
    const thresholdRequired = threshBytes
      ? threshBytes[authorizationLevel === "admin" ? 3 : 2]
      : null;
    const totalWeight = account
      ? Math.min(
          255,
          signers.reduce((sum, signer) => sum + (signer.weight ?? 0), 0),
        )
      : null;
    reports.push({
      accountId,
      authorizationLevel,
      signers,
      thresholdRequired,
      totalWeight,
      isSufficient:
        thresholdRequired !== null && totalWeight !== null
          ? totalWeight >= thresholdRequired
          : null,
      invocationXdr,
    });
  };
  for (const entry of auth) {
    const tree = describeAuthTree(entry.rootInvocation);
    const invocationXdr = entry.rootInvocation.toXDR("base64");
    report(
      authorizer(entry, source),
      tree.authorizationLevel,
      addressCredentials(entry.credentials)?.signature,
      invocationXdr,
    );
    if (entry.credentials.type === "sorobanCredentialsAddressWithDelegates") {
      const visit = (delegates: StellarSdk.xdr.SorobanDelegateSignature[]) => {
        for (const delegate of delegates) {
          report(
            StellarSdk.Address.fromScAddress(delegate.address).toString(),
            tree.authorizationLevel,
            delegate.signature,
            invocationXdr,
          );
          visit(delegate.nestedDelegates);
        }
      };
      visit(entry.credentials.addressWithDelegates.delegates);
    }
  }
  return reports;
}
