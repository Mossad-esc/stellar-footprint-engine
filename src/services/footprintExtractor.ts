import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer, getNetworkConfig, Network } from "../config/stellar";
import {
  FootprintStats,
  ContractType,
  AssetInfo,
  SacContract,
  FootprintBreakdown,
} from "../types";
import {
  parseFootprint,
  extractContracts,
  detectTokenContract,
  mergeFootprints,
  detectSacContracts,
  calculateFootprintStats as _calculateFootprintStats,
  type FootprintEntry,
} from "./footprintParser";
import { optimizeFootprint } from "./optimizer";

/**
 * Exact LedgerFootprint wire sizes, including both XDR array length prefixes.
 * Kept for API compatibility with controllers and feeEstimator.
 */
export function calculateFootprintStats(
  readOnly: string[],
  readWrite: string[],
): FootprintStats {
  return _calculateFootprintStats({ readOnly, readWrite });
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

  const mergedRaw = mergeFootprints([rawFootprint]);
  const merged = parseFootprint(mergedRaw, networkPassphrase, sacContracts);
  const optimizationResult = {
    readOnly: merged.readOnly,
    readWrite: merged.readWrite,
    optimized:
      merged.readOnly.length + merged.readWrite.length <
      rawFootprint.readOnly.length + rawFootprint.readWrite.length,
  };

  const contractType: ContractType = parsedFootprint.isSAC
    ? "sac"
    : contracts.length > 0
      ? await detectTokenContract(contracts[0], server, networkPassphrase)
      : "unknown";

  return {
    footprintStats: _calculateFootprintStats(rawFootprint, parsedFootprint),
    rawFootprint,
    parsedFootprint: {
      readOnly: parsedFootprint.readOnly,
      readWrite: parsedFootprint.readWrite,
      breakdown: parsedFootprint.breakdown,
    },
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
  const type = envelope.type;
  let tx: StellarSdk.xdr.Transaction | undefined;

  if (type === "envelopeTypeTxFeeBump") {
    const inner = envelope.feeBump.tx.innerTx;
    if (inner.type === "envelopeTypeTx") {
      tx = inner.v1.tx;
    }
  } else if (type === "envelopeTypeTx") {
    tx = envelope.v1.tx;
  }

  if (!tx) return { readOnly: [], readWrite: [] };

  // Check if sorobanData extension is present (ext.v() === 1)
  const ext = tx.ext;
  // In the new SDK, ext is a discriminated union; check if sorobanData key exists
  if (!ext || !("sorobanData" in ext)) return { readOnly: [], readWrite: [] };
  const sorobanExt = ext as {
    sorobanData: {
      resources: {
        footprint: {
          readOnly: StellarSdk.xdr.LedgerKey[];
          readWrite: StellarSdk.xdr.LedgerKey[];
        };
      };
    };
  };

  const hasSorobanOperation = tx.operations.some((operation) => {
    const bodyType = operation.body.type;
    return (
      bodyType === "invokeHostFunction" ||
      bodyType === "extendFootprintTtl" ||
      bodyType === "restoreFootprint"
    );
  });
  if (!hasSorobanOperation) return { readOnly: [], readWrite: [] };

  const footprint = sorobanExt.sorobanData.resources.footprint;
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
