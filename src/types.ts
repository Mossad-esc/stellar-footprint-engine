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
  estimatedSizeBytes: number;
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
  contractId: string;
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
