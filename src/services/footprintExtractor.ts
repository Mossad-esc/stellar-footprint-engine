import * as StellarSdk from "@stellar/stellar-sdk";

import {
  parseFootprint,
  extractContracts,
  detectTokenContract,
  mergeFootprints,
  detectSacContracts,
  type FootprintEntry,
  type ContractType,
} from "./footprintParser";
import { getNetworkConfig, getRpcServer, Network } from "../config/stellar";
import {
  AssetInfo,
  FootprintBreakdown,
  FootprintStats,
  SacContract,
} from "../types";

/** Exact LedgerFootprint wire sizes, including both XDR array length prefixes. */
export function calculateFootprintStats(
  readOnly: string[],
  readWrite: string[],
  parsed?: Pick<
    ReturnType<typeof parseFootprint>,
    "isSAC" | "assetInfo" | "breakdown"
  >,
): FootprintStats & { readOnlySizeBytes: number; readWriteSizeBytes: number } {
  const footprint = new StellarSdk.xdr.LedgerFootprint({
    readOnly: readOnly.map((key) =>
      StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"),
    ),
    readWrite: readWrite.map((key) =>
      StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"),
    ),
  });
  const resolved = parsed ?? parseFootprint({ readOnly, readWrite });
  return {
    readOnlyCount: readOnly.length,
    readWriteCount: readWrite.length,
    totalEntries: readOnly.length + readWrite.length,
    readOnlySizeBytes:
      4 + footprint.readOnly.reduce((sum, key) => sum + key.toXDR().length, 0),
    readWriteSizeBytes:
      4 + footprint.readWrite.reduce((sum, key) => sum + key.toXDR().length, 0),
    estimatedSizeBytes: footprint.toXDR().length,
    isSAC: resolved.isSAC,
    ...(resolved.assetInfo ? { assetInfo: resolved.assetInfo } : {}),
    breakdown: resolved.breakdown,
  };
}

export interface ExtractedFootprint {
  footprintStats: FootprintStats;
  rawFootprint: {
    readOnly: string[];
    readWrite: string[];
  };
  parsedFootprint: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
    breakdown: FootprintBreakdown;
  };
  optimizationResult: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
    optimized: boolean;
  };
  contracts: string[];
  contractType: ContractType;
  isSAC: boolean;
  assetInfo?: AssetInfo;
  sacContracts: SacContract[];
}

/**
 * Extract footprint from simulation response
 */
export async function extractFootprint(
  response:
    | StellarSdk.rpc.Api.SimulateTransactionSuccessResponse
    | readonly StellarSdk.rpc.Api.SimulateTransactionSuccessResponse[],
  network: Network,
): Promise<ExtractedFootprint> {
  const singleResponse = Array.isArray(response) ? response[0] : response;
  if (!singleResponse?.transactionData) {
    throw new Error("Simulation succeeded but transactionData is missing");
  }

  const footprint = singleResponse.transactionData.build().resources.footprint;
  const rawFootprint = {
    readOnly: footprint.readOnly.map((e: StellarSdk.xdr.LedgerKey) =>
      e.toXDR("base64"),
    ),
    readWrite: footprint.readWrite.map((e: StellarSdk.xdr.LedgerKey) =>
      e.toXDR("base64"),
    ),
  };

  const { networkPassphrase } = getNetworkConfig(network);
  const server = getRpcServer(network);
  const initial = parseFootprint(rawFootprint, networkPassphrase);
  const sacContracts = await detectSacContracts(
    [...initial.readOnly, ...initial.readWrite],
    server,
    networkPassphrase,
  );
  const parsedFootprint = parseFootprint(
    rawFootprint,
    networkPassphrase,
    sacContracts,
  );
  const allEntries = [...rawFootprint.readOnly, ...rawFootprint.readWrite];
  const contracts = extractContracts(allEntries);

  const merged = parseFootprint(
    mergeFootprints([rawFootprint]),
    networkPassphrase,
    sacContracts,
  );
  const optimizationResult = {
    readOnly: merged.readOnly,
    readWrite: merged.readWrite,
    optimized:
      merged.readOnly.length + merged.readWrite.length <
      rawFootprint.readOnly.length + rawFootprint.readWrite.length,
  };

  const contractType = parsedFootprint.isSAC
    ? "sac"
    : contracts.length > 0
      ? await detectTokenContract(contracts[0], server, networkPassphrase)
      : "unknown";

  return {
    footprintStats: calculateFootprintStats(
      rawFootprint.readOnly,
      rawFootprint.readWrite,
    ),
    rawFootprint,
    parsedFootprint,
    optimizationResult,
    contracts,
    contractType,
    isSAC: parsedFootprint.isSAC,
    assetInfo: parsedFootprint.assetInfo,
    sacContracts: parsedFootprint.sacContracts,
  };
}

/**
 * Soroban resources are shared by all operations in a v1 envelope. Classic
 * operations carry no separate footprint; fee bumps use their inner envelope.
 */
export function extractEnvelopeFootprint(
  envelope: StellarSdk.xdr.TransactionEnvelope,
): { readOnly: string[]; readWrite: string[] } {
  const tx =
    envelope.type === "envelopeTypeTxFeeBump"
      ? envelope.feeBump.tx.innerTx.v1.tx
      : envelope.type === "envelopeTypeTx"
        ? envelope.v1.tx
        : undefined;
  if (!tx || !("sorobanData" in tx.ext)) return { readOnly: [], readWrite: [] };
  const hasSorobanOperation = tx.operations.some((operation) =>
    ["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"].includes(
      operation.body.type,
    ),
  );
  if (!hasSorobanOperation) return { readOnly: [], readWrite: [] };
  const footprint = tx.ext.sorobanData.resources.footprint;
  return mergeFootprints([
    {
      readOnly: footprint.readOnly.map((key: StellarSdk.xdr.LedgerKey) =>
        key.toXDR("base64"),
      ),
      readWrite: footprint.readWrite.map((key: StellarSdk.xdr.LedgerKey) =>
        key.toXDR("base64"),
      ),
    },
  ]);
}
