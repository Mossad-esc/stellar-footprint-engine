import { Network, getNetworkConfig, getRpcServer } from "@config/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

import { calculateFootprintStats } from "./footprintExtractor";
import {
  parseFootprint,
  parseContractInvocation,
  hasContractCreationInstance,
  extractContracts,
  detectTokenContract,
  type FootprintEntry,
  type ContractType,
} from "./footprintParser";
import { optimizeFootprint } from "./optimizer";
// import { calculateResourceFee } from "./feeEstimator"; // unused
import {
  ErrorCode,
  TTL_WARNING_THRESHOLD_LEDGERS,
  TTL_EXTENSION_SAFETY_LEDGERS,
} from "../constants";
import metrics from "../middleware/metrics";
import { buildCacheKey, getCache } from "../services/cache";
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
} from "../types";
import { rpcCircuitBreaker } from "../utils/circuitBreaker";
import { withRetry } from "../utils/retry";
import { sanitizeRpcError } from "../utils/rpcErrorSanitizer";

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
  cacheHit?: boolean;
  type?: string;
  warnings?: string[];
}

/**
 * Common processing for a single simulation result
 */
async function _processSimulationResult(
  server: StellarSdk.rpc.Server,
  transactionData: StellarSdk.xdr.SorobanTransactionData,
  cost: { cpuInsns: string; memBytes: string } | undefined,
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  tx: StellarSdk.Transaction,
): Promise<Partial<SimulateResult>> {
  const footprintXdr = transactionData.resources.footprint;
  const rawFootprint = {
    readOnly: footprintXdr.readOnly.map((e) => e.toXDR("base64")),
    readWrite: footprintXdr.readWrite.map((e) => e.toXDR("base64")),
  };

  const parsed = parseFootprint(rawFootprint);
  const optimizationResult = optimizeFootprint(
    parsed.readOnly,
    parsed.readWrite,
  );

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

  const footprintStats = calculateFootprintStats(
    rawFootprint.readOnly,
    rawFootprint.readWrite,
  );

  return {
    success: true,
    footprint: {
      readOnly: optimizationResult.readOnly.map((entry) => ({
        ...entry,
        ttlInfo: ttl[entry.xdr],
      })),
      readWrite: optimizationResult.readWrite.map((entry) => ({
        ...entry,
        ttlInfo: ttl[entry.xdr],
      })),
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
    ...authorization,
    signerThresholdReports,
    invocation,
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
    response.transactionData.build(),
    responseCost,
    response,
    tx,
  );
  const ttl = processed.ttl ?? {};
  const ttlWarnings = buildTtlWarnings(ttl);
  const ledgerWarning = buildLedgerSequenceWarning(
    ledgerSequence,
    response.latestLedger,
  );
  const ttlExtension = recommendTtlExtension(ttl);
  const result: SimulateResult = {
    ...processed,
    success: true,
    cost: {
      cpuInsns: responseCost?.cpuInsns ?? "0",
      memBytes: responseCost?.memBytes ?? "0",
      ...(ttlExtension ? { ttlExtension } : {}),
    },
    ttlWarnings,
    warnings: [...ttlWarnings, ...(ledgerWarning ? [ledgerWarning] : [])],
    raw: response,
    upgradedFromV0: upgradedFromV0 || undefined,
    diagnosticEvents: (response.events ?? []).map((event) =>
      event.toXDR("base64"),
    ),
  };
  return result;
}

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
      return `0x${Buffer.from(value.bytes.toBytes()).toString("hex")}`;
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
  const types = args.args.map((arg) => arg.type);
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
    args: args.args.map(formatScVal),
    argTypes: types,
    interfaceEstimation: { name, basis: "function name and argument types" },
  };
}

    const op = tx.operations[0];
    const invocation =
      op?.type === "invokeHostFunction" && op.func
        ? parseContractInvocation(op.func, networkPassphrase)
        : undefined;
    if (
      invocation?.isContractCreation &&
      !hasContractCreationInstance(
        invocation,
        processed.rawFootprint?.readWrite ?? [],
      )
    ) {
      return {
        success: false,
        error:
          "Contract creation simulation is missing the writable contract instance key.",
        code: ErrorCode.SIMULATION_DATA_MISSING,
        invocation,
        raw: response,
      };
    }

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
      invocation,
      contractId: invocation?.isContractCreation
        ? invocation.contractId
        : undefined,
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
    // Credentials authorize the entire tree. Addresses in arguments are values,
    // not additional signers (a transfer recipient need not authorize it).
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
  // Prefer supplied signatures only when they authorize the same simulated tree.
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
    if (data.type === "account")
      accounts.set(
        StellarSdk.StrKey.encodeEd25519PublicKey(
          data.account.accountId.ed25519.toBytes(),
        ),
        data.account,
      );
  };
  for (const change of response.stateChanges ?? []) {
    // Threshold changes produced by simulation must not authorize that same call.
    if (change.before) put(change.before.data);
  }
  const keys = [...new Set(rawKeys)]
    .map((key) => StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"))
    .filter(
      (key) =>
        key.type === "account" &&
        !accounts.has(
          StellarSdk.StrKey.encodeEd25519PublicKey(
            key.account.accountId.ed25519.toBytes(),
          ),
        ),
    );
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

/** Standard account signatures are vec<map<public_key: bytes, signature: bytes>>. */
function suppliedSignatureKeys(signature: StellarSdk.xdr.ScVal): string[] {
  if (signature.type !== "scvVec") return [];
  const keys = new Set<string>();
  for (const value of signature.vec ?? []) {
    if (value.type !== "scvMap") continue;
    const fields = new Map(
      (value.map ?? []).flatMap((field) =>
        field.key.type === "scvSymbol"
          ? [[field.key.sym.toString(), field.val] as const]
          : [],
      ),
    );
    const key = fields.get("public_key");
    const sig = fields.get("signature");
    if (
      key?.type === "scvBytes" &&
      key.bytes.toBytes().length === 32 &&
      sig?.type === "scvBytes" &&
      sig.bytes.toBytes().length === 64
    )
      keys.add(StellarSdk.StrKey.encodeEd25519PublicKey(key.bytes.toBytes()));
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
      weights.set(accountId, account.thresholds.toBytes()[0]);
      for (const signer of account.signers) {
        if (signer.key.type === "signerKeyTypeEd25519")
          weights.set(
            StellarSdk.StrKey.encodeEd25519PublicKey(
              signer.key.ed25519.toBytes(),
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
              sig.signature.toBytes(),
            ),
          ),
        );
    const signers = keys.map((publicKey) => ({
      publicKey,
      weight: account ? (weights.get(publicKey) ?? 0) : null,
    }));
    const thresholdRequired = account
      ? account.thresholds.toBytes()[authorizationLevel === "admin" ? 3 : 2]
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
