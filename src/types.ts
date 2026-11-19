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
  isSAC: boolean;
  assetInfo?: AssetInfo;
  breakdown: FootprintBreakdown;
}

export type StorageCategory =
  | "contractCode"
  | "contractInstance"
  | "persistentData"
  | "temporaryData";

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
}

export interface TtlInfo {
  liveUntilLedger: number;
  expiresInLedgers: number;
}
