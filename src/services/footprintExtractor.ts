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
import { getRpcServer, getNetworkConfig, Network } from "../config/stellar";
import type { AssetInfo, SacContract, FootprintBreakdown } from "../types";

export interface ExtractedFootprint {
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
  const responses = (
    Array.isArray(response) ? response : [response]
  ) as readonly StellarSdk.rpc.Api.SimulateTransactionSuccessResponse[];
  const footprints = responses.map((result) => {
    if (!result.transactionData) {
      throw new Error("Simulation succeeded but transactionData is missing");
    }
    return result.transactionData.build().resources().footprint();
  });
  const rawFootprint = {
    readOnly: footprints.flatMap((footprint) =>
      footprint
        .readOnly()
        .map((e: StellarSdk.xdr.LedgerKey) => e.toXDR("base64")),
    ),
    readWrite: footprints.flatMap((footprint) =>
      footprint
        .readWrite()
        .map((e: StellarSdk.xdr.LedgerKey) => e.toXDR("base64")),
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
  const type = envelope.switch().name;
  const tx =
    type === "envelopeTypeTxFeeBump"
      ? envelope.feeBump().tx().innerTx().v1().tx()
      : type === "envelopeTypeTx"
        ? envelope.v1().tx()
        : undefined;
  if (!tx || tx.ext().switch() !== 1) return { readOnly: [], readWrite: [] };
  const hasSorobanOperation = tx
    .operations()
    .some((operation) =>
      ["invokeHostFunction", "extendFootprintTtl", "restoreFootprint"].includes(
        operation.body().switch().name,
      ),
    );
  if (!hasSorobanOperation) return { readOnly: [], readWrite: [] };
  const footprint = tx.ext().sorobanData().resources().footprint();
  return mergeFootprints([
    {
      readOnly: footprint.readOnly().map((key) => key.toXDR("base64")),
      readWrite: footprint.readWrite().map((key) => key.toXDR("base64")),
    },
  ]);
}
