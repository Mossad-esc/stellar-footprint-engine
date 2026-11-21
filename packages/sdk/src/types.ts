export type Network = "mainnet" | "testnet" | "futurenet";

export type XdrType = "transaction" | "operation" | "ledger_key" | "auth_entry";

export type FeeOperationType = "invoke" | "restore" | "extend";

export type StorageCategory =
  | "contractCode"
  | "contractInstance"
  | "persistentData"
  | "temporaryData";

export type ContractType = "token" | "sac" | "unknown";

export type AuthorizationLevel = "payment" | "admin";

export interface ResponseEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface StellarFootprintClientConfig {
  /** Base URL of the Stellar Footprint Engine API (default: "http://localhost:3000/api/v1"). */
  baseURL?: string;
  /** Request timeout in milliseconds (default: 30000). */
  timeout?: number;
  /** Number of automatic retries for transient failures (default: 2). */
  retries?: number;
  /** Base delay in milliseconds for exponential backoff between retries (default: 250). */
  retryDelayMs?: number;
  /** Optional API key sent in the X-API-Key header. */
  apiKey?: string;
  /** Additional default headers to include with every request. */
  headers?: Record<string, string>;
  /** Custom fetch implementation (defaults to globalThis.fetch). */
  fetch?: typeof globalThis.fetch;
}

export interface AssetInfo {
  code: string;
  issuer?: string;
}

export interface StorageStats {
  count: number;
  estimatedSizeBytes: number;
  readOnly: string[];
  readWrite: string[];
}

export type FootprintBreakdown = Record<StorageCategory, StorageStats>;

export interface FootprintStats {
  readOnlyCount: number;
  readWriteCount: number;
  totalEntries: number;
  readOnlySizeBytes: number;
  readWriteSizeBytes: number;
  estimatedSizeBytes: number;
  isSAC: boolean;
  assetInfo?: AssetInfo;
  breakdown: FootprintBreakdown;
}

export interface FootprintEntry {
  xdr: string;
  type: string;
  contractId?: string;
  durability?: string;
  keyHash?: string;
  isSAC?: boolean;
  assetInfo?: AssetInfo;
  [key: string]: unknown;
}

export interface FootprintInput {
  readOnly: string[];
  readWrite: string[];
}

export interface SacContract {
  contractId: string;
  isSAC: true;
  assetInfo?: AssetInfo;
}

export interface ContractInvocation {
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

export interface AuthorizationInvocation {
  type: string;
  invocation?: ContractInvocation;
  authorizationLevel: AuthorizationLevel;
  subInvocations: AuthorizationInvocation[];
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

export interface SignerThresholdReport {
  invocationXdr: string;
  accountId: string;
  authorizationLevel: AuthorizationLevel;
  signers: { publicKey: string; weight: number | null }[];
  thresholdRequired: number | null;
  totalWeight: number | null;
  isSufficient: boolean | null;
}

export interface TtlInfo {
  liveUntilLedger: number | null;
  expiresInLedgers: number | null;
  requiresExtension?: boolean;
  requiresRestore?: boolean;
}

export interface TtlExtensionRecommendation {
  extendTo: number;
  entries: string[];
  restoreFirst: boolean;
}

export interface SimulationCost {
  cpuInsns: string;
  memBytes: string;
  ttlExtension?: TtlExtensionRecommendation;
}

export interface SimulateOptions {
  network?: Network;
  webhookUrl?: string;
  ledgerSequence?: number;
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
  rawFootprint?: FootprintInput;
  footprintStats?: FootprintStats;
  invocation?: ContractInvocation;
  authEntries?: AuthEntry[];
  events?: ContractEvent[];
  cost?: SimulationCost;
  resourceFee?: string;
  error?: string;
  code?: string;
  contractId?: string;
  requiredSigners?: string[];
  threshold?: number;
  signerThresholdReports?: SignerThresholdReport[];
  operations?: SimulateResult[];
  feeBump?: boolean;
  diagnosticEvents?: string[];
  cacheHit?: boolean;
  type?: string;
  warnings?: string[];
  /** Present when webhookUrl is provided and the simulation is queued asynchronously. */
  accepted?: boolean;
  jobId?: string;
  status?: "pending" | "completed" | "failed";
}

export interface BatchTransactionInput {
  xdr: string;
  ledgerSequence?: number;
}

export interface BatchSimulateOptions {
  network?: Network;
}

export interface BatchSimulateItem extends SimulateResult {
  index: number;
}

export interface BatchSimulateResult {
  results: BatchSimulateItem[];
}

export interface EstimateFeeOptions {
  cpuInsns?: string;
  memBytes?: string;
  network?: Network;
  operationType?: FeeOperationType;
  footprint?: FootprintInput;
  extendTo?: number;
}

export interface EstimateFeeRequest extends EstimateFeeOptions {
  xdr?: string;
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

export interface DiffFootprintsOptions {
  network?: Network;
  format?: "json" | "markdown";
}

export interface FootprintDiffResult {
  added: FootprintInput;
  removed: FootprintInput;
  unchanged: FootprintInput;
}

export interface DecodeResult {
  success: boolean;
  type: XdrType;
  decoded?: unknown;
  error?: string;
}
