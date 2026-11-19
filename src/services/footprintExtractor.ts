import * as StellarSdk from "@stellar/stellar-sdk";

import {
  parseFootprint,
  extractContracts,
  detectTokenContract,
  type FootprintEntry,
  type ContractType,
} from "./footprintParser";
import { optimizeFootprint } from "./optimizer";
import { getRpcServer, Network } from "../config/stellar";
import { FootprintStats } from "../types";

/** Exact LedgerFootprint wire sizes, including both XDR array length prefixes. */
export function calculateFootprintStats(
  readOnly: string[],
  readWrite: string[],
): FootprintStats {
  const footprint = new StellarSdk.xdr.LedgerFootprint({
    readOnly: readOnly.map((key) =>
      StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"),
    ),
    readWrite: readWrite.map((key) =>
      StellarSdk.xdr.LedgerKey.fromXDR(key, "base64"),
    ),
  });
  return {
    readOnlyCount: readOnly.length,
    readWriteCount: readWrite.length,
    totalEntries: readOnly.length + readWrite.length,
    readOnlySizeBytes:
      4 +
      footprint.readOnly().reduce((sum, key) => sum + key.toXDR().length, 0),
    readWriteSizeBytes:
      4 +
      footprint.readWrite().reduce((sum, key) => sum + key.toXDR().length, 0),
    estimatedSizeBytes: footprint.toXDR().length,
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
  };
  optimizationResult: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
    optimized: boolean;
  };
  contracts: string[];
  contractType: ContractType;
}

/**
 * Extract footprint from simulation response
 */
export async function extractFootprint(
  response: StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
  network: Network,
): Promise<ExtractedFootprint> {
  if (!response.transactionData) {
    throw new Error("Simulation succeeded but transactionData is missing");
  }

  const footprint = response.transactionData.build().resources.footprint;
  const rawFootprint = {
    readOnly: footprint.readOnly.map((e: StellarSdk.xdr.LedgerKey) =>
      e.toXDR("base64"),
    ),
    readWrite: footprint.readWrite.map((e: StellarSdk.xdr.LedgerKey) =>
      e.toXDR("base64"),
    ),
  };

  const parsedFootprint = parseFootprint(rawFootprint);
  const allEntries = [...rawFootprint.readOnly, ...rawFootprint.readWrite];
  const contracts = extractContracts(allEntries);

  const optimizationResult = optimizeFootprint(
    parsedFootprint.readOnly,
    parsedFootprint.readWrite,
  );

  const server = getRpcServer(network);
  const contractType =
    contracts.length > 0
      ? await detectTokenContract(contracts[0], server)
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
  };
}
