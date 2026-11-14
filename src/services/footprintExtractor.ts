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

export interface ExtractedFootprint {
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
  footprintStats: FootprintStats;
  contracts: string[];
  contractType: ContractType;
}

function toLedgerKey(
  entry: StellarSdk.xdr.LedgerKey | string,
): StellarSdk.xdr.LedgerKey {
  if (typeof entry === "string") {
    return StellarSdk.xdr.LedgerKey.fromXDR(entry, "base64");
  }
  return entry;
}

/**
 * Calculate exact serialized XDR byte sizes for a Soroban LedgerFootprint,
 * including individual readOnly / readWrite LedgerKey byte totals and the
 * combined serialized LedgerFootprint struct byte length.
 */
export function calculateSerializedFootprintSize(
  footprint:
    | StellarSdk.xdr.LedgerFootprint
    | {
        readOnly: (StellarSdk.xdr.LedgerKey | string)[];
        readWrite: (StellarSdk.xdr.LedgerKey | string)[];
      },
): FootprintStats {
  const isXdrFootprint = footprint instanceof StellarSdk.xdr.LedgerFootprint;
  const readOnlyKeys = isXdrFootprint
    ? footprint.readOnly()
    : footprint.readOnly.map(toLedgerKey);
  const readWriteKeys = isXdrFootprint
    ? footprint.readWrite()
    : footprint.readWrite.map(toLedgerKey);

  const readOnlyBytes = readOnlyKeys.reduce(
    (sum, key) => sum + key.toXDR().length,
    0,
  );
  const readWriteBytes = readWriteKeys.reduce(
    (sum, key) => sum + key.toXDR().length,
    0,
  );

  const xdrFootprint = isXdrFootprint
    ? footprint
    : new StellarSdk.xdr.LedgerFootprint({
        readOnly: readOnlyKeys,
        readWrite: readWriteKeys,
      });
  const serializedFootprintBytes = xdrFootprint.toXDR().length;

  return {
    readOnlyCount: readOnlyKeys.length,
    readWriteCount: readWriteKeys.length,
    totalEntries: readOnlyKeys.length + readWriteKeys.length,
    readOnlyBytes,
    readWriteBytes,
    serializedFootprintBytes,
    estimatedSizeBytes: serializedFootprintBytes,
  };
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

  const footprint = response.transactionData.build().resources().footprint();
  const rawFootprint = {
    readOnly: footprint
      .readOnly()
      .map((e: StellarSdk.xdr.LedgerKey) => e.toXDR("base64")),
    readWrite: footprint
      .readWrite()
      .map((e: StellarSdk.xdr.LedgerKey) => e.toXDR("base64")),
  };

  const parsedFootprint = parseFootprint(rawFootprint);
  const allEntries = [...rawFootprint.readOnly, ...rawFootprint.readWrite];
  const contracts = extractContracts(allEntries);

  const optimizationResult = optimizeFootprint(
    parsedFootprint.readOnly,
    parsedFootprint.readWrite,
  );
  const footprintStats = calculateSerializedFootprintSize(footprint);

  const server = getRpcServer(network);
  const contractType =
    contracts.length > 0
      ? await detectTokenContract(contracts[0], server)
      : "unknown";

  return {
    rawFootprint,
    parsedFootprint,
    optimizationResult,
    footprintStats,
    contracts,
    contractType,
  };
}
