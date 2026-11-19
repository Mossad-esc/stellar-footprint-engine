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
}

export interface AuthEntry {
  contractId: string;
  functionName: string;
  xdr: string;
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
}

export interface TtlInfo {
  liveUntilLedger: number;
  expiresInLedgers: number;
}
