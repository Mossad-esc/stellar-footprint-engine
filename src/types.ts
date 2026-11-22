import { ErrorCode } from "./constants";

/**
 * A single configured API key together with the scopes it grants.
 * Used by the RBAC-aware API key auth middleware.
 */
export interface ScopedApiKey {
  /** The raw API key value presented by the client. */
  key: string;
  /** Granular permissions granted to this key (e.g. "simulate:read", "admin:cache"). */
  scopes: string[];
}

/**
 * Scopes that can be granted to an API key.
 */
export type ApiKeyScope =
  | "simulate:read"
  | "simulate:batch"
  | "admin:cache"
  | "admin:metrics";

export interface ResponseEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: ErrorCode;
}

/**
 * RFC 7807 Problem Details for HTTP APIs
 * @see https://www.rfc-editor.org/rfc/rfc7807
 */
export interface ProblemDetails {
  /** URI reference identifying the problem type (links to documentation). */
  type: string;
  /** Short human-readable summary of the problem type. */
  title: string;
  /** HTTP status code. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail: string;
  /** URI reference identifying the specific occurrence (request path). */
  instance: string;
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

export interface SignerWeight {
  /** Ed25519 public key (G...) of a supplied signer. */
  publicKey: string;
  /** Weight from the account entry; null when account data is unavailable. */
  weight: number | null;
}

export interface SignerThresholdReport {
  /** Reports are per tree, so signatures for different payloads cannot be combined. */
  invocationXdr: string;
  accountId: string;
  authorizationLevel: AuthorizationLevel;
  /** Each supplied signer appears once. Missing account data means unknown weight. */
  signers: SignerWeight[];
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

export type Network = "mainnet" | "testnet" | "futurenet";

export type XdrType = "transaction" | "operation" | "ledger_key" | "auth_entry";

export type FeeOperationType = "invoke" | "restore" | "extend";

export interface FootprintInput {
  readOnly: string[];
  readWrite: string[];
}

export interface FootprintDiffResult {
  added: FootprintInput;
  removed: FootprintInput;
  unchanged: FootprintInput;
}

export interface FeeEstimate {
  baseFee: string;
  resourceFee: string;
  totalFee: string;
  feeInXLM: string;
  operationType?: FeeOperationType;
  breakdown?: {
    baseFee: string;
    writeFee: string;
    refundableFee: string;
    otherResourceFee: string;
  };
}

export interface DecodeResult {
  success: boolean;
  type: XdrType;
  decoded?: unknown;
  error?: string;
}

export interface SimulationCost {
  cpuInsns: string;
  memBytes: string;
  ttlExtension?: TtlExtensionRecommendation;
}

export interface SimulationEnvelope {
  success: boolean;
  simulatedAt?: string;
  upgradedFromV0?: boolean;
  footprint?: {
    readOnly: unknown[];
    readWrite: unknown[];
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
  rawFootprint?: FootprintInput;
  footprintStats?: FootprintStats;
  invocation?: ContractInvocation;
  authEntries?: AuthEntry[];
  events?: ContractEvent[];
  cost?: SimulationCost;
  resourceFee?: string;
  error?: string;
  code?: ErrorCode;
  contractId?: string;
  requiredSigners?: string[];
  threshold?: number;
  signerThresholdReports?: SignerThresholdReport[];
  operations?: SimulationEnvelope[];
  feeBump?: boolean;
  diagnosticEvents?: string[];
  cacheHit?: boolean;
  type?: string;
  warnings?: string[];
}

export interface BatchSimulationItem extends SimulationEnvelope {
  index: number;
}

export interface BatchSimulationResponse {
  results: BatchSimulationItem[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Scopes granted to the authenticated API key, attached by apiKeyAuth. */
      apiKeyScopes?: string[];
    }
  }
}
