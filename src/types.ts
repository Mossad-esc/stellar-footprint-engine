import { ErrorCode } from "./constants";

export interface ResponseEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: ErrorCode;
}

export interface FootprintStats {
  readOnlyCount: number;
  readWriteCount: number;
  totalEntries: number;
  /** Serialized read-only array size, including its four-byte length prefix. */
  readOnlySizeBytes: number;
  /** Serialized read-write array size, including its four-byte length prefix. */
  readWriteSizeBytes: number;
  /** Exact serialized LedgerFootprint size; retained name for API compatibility. */
  estimatedSizeBytes: number;
  isSAC: boolean;
  assetInfo?: AssetInfo;
  breakdown: FootprintBreakdown;
  /** Count of temporary-durability contract data entries in the footprint. */
  temporaryEntryCount: number;
  /** Total byte size of temporary-durability keys. */
  temporaryEntrySizeBytes: number;
  /** Count of persistent-durability contract data entries in the footprint. */
  persistentEntryCount: number;
  /** Total byte size of persistent-durability keys. */
  persistentEntrySizeBytes: number;
  /** Optimization hint: set when any persistent entry could be temporary. */
  persistentStorageOptimizationHint?: string;
}

export type StorageCategory =
  "contractCode" | "contractInstance" | "persistentData" | "temporaryData";

export interface StorageStats {
  count: number;
  /** Size of serialized ledger keys, excluding values unavailable in a footprint. */
  estimatedSizeBytes: number;
  readOnly: string[];
  readWrite: string[];
}

export type FootprintBreakdown = Record<StorageCategory, StorageStats>;

export interface AssetInfo {
  code: string;
  issuer?: string;
}

export type ContractType = "token" | "sac" | "unknown";

export interface SacContract {
  contractId: string;
  isSAC: true;
  assetInfo?: AssetInfo;
}

export interface AuthEntry {
  contractId: string;
  functionName: string;
  xdr: string;
  authorizer?: string;
  credentialsType?: string;
  invocationTree?: AuthorizationInvocation;
}

export interface ContractEvent {
  type: string;
  contractId: string;
  topics: string[];
  data: string;
}

/** Structured representation of a Soroban diagnostic event. */
export interface DiagnosticEvent {
  /** Categorized log level derived from event topic. */
  logLevel: "debug" | "info" | "warn" | "error";
  /** Human-readable topic name (e.g. "fn_call", "log", "error"). */
  topic: string;
  /** Decoded data payload as a JSON-serializable value. */
  data: unknown;
  /** Contract error code extracted from HostError panics, when present. */
  errorCode?: number | string;
  /** Raw base64 XDR of the original diagnostic event. */
  xdr: string;
}

export interface ContractInvocation {
  /** Contract address; predicted from the network and preimage for deployments. */
  contractId: string;
  isContractCreation?: boolean;
  functionName: string;
  args: string[];
  argTypes?: string[];
  interfaceEstimation?: {
    name: "SEP-41" | "SEP-40" | "DAO governance" | "unknown";
    basis: "function name and argument types";
  };
}

export type AuthorizationLevel = "payment" | "admin";

export interface AuthorizationInvocation {
  type: string;
  invocation?: ContractInvocation;
  authorizationLevel: AuthorizationLevel;
  subInvocations: AuthorizationInvocation[];
}

export interface SignerThresholdReport {
  /** Reports are per tree, so signatures for different payloads cannot be combined. */
  invocationXdr: string;
  accountId: string;
  authorizationLevel: AuthorizationLevel;
  /** Each supplied signer appears once. Missing account data means unknown weight. */
  signers: { publicKey: string; weight: number | null }[];
  thresholdRequired: number | null;
  totalWeight: number | null;
  /** Weight comparison only; custom contract authorization cannot be checked locally. */
  isSufficient: boolean | null;
}

export interface DryRunResult {
  dryRun: true;
  network: string;
  sourceAccount: string;
  sequence: string;
  operationCount: number;
  operations: {
    type: string;
    source: string | null;
    invocation?: ContractInvocation;
    authEntries?: AuthEntry[];
    requiredSigners?: string[];
  }[];
}

export interface TtlInfo {
  /** Unknown for archived entries when the RPC omits their original TTL. */
  liveUntilLedger: number | null;
  expiresInLedgers: number | null;
  requiresExtension?: boolean;
  requiresRestore?: boolean;
}

export interface TtlExtensionRecommendation {
  /** Relative ledger count accepted by ExtendFootprintTTLOp, not an absolute sequence. */
  extendTo: number;
  entries: string[];
  restoreFirst: boolean;
}
