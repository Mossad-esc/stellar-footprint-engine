import * as StellarSdk from "@stellar/stellar-sdk";

import { ContractInvocation } from "../types";

/**
 * Types of ledger keys that can appear in a footprint
 */
export type LedgerKeyType =
  | "ContractData"
  | "ContractCode"
  | "Account"
  | "TrustLine"
  | "Unknown";

export interface FootprintEntry {
  /** Raw base64 is retained even if the SDK cannot decode a future key. */
  xdr: string;
  type: LedgerKeyType;
  contractId?: string;
  ttlInfo?: TtlInfo;
}

function classifyEntryType(key: StellarSdk.xdr.LedgerKey): LedgerKeyType {
  switch (key.type) {
    case "contractData":
      return LedgerKeyType.CONTRACT_DATA;
    case "contractCode":
      return LedgerKeyType.CONTRACT_CODE;
    case "account":
      return LedgerKeyType.ACCOUNT;
    case "trustline":
      return LedgerKeyType.TRUST_LINE;
    case "offer":
      return LedgerKeyType.OFFER;
    case "data":
      return LedgerKeyType.DATA;
    case "claimableBalance":
      return LedgerKeyType.CLAIMABLE_BALANCE;
    case "liquidityPool":
      return LedgerKeyType.LIQUIDITY_POOL;
    case "configSetting":
      return LedgerKeyType.CONFIG_SETTING;
    case "ttl":
      return LedgerKeyType.TTL;
    default:
      return LedgerKeyType.UNKNOWN;
  }
}

export function parseFootprintEntries(entries: string[]): FootprintEntry[] {
  return entries.map((raw) => {
    const key = parseLedgerKey(raw);
    if (!key) return { xdr: raw, type: LedgerKeyType.UNKNOWN };
    let contractId: string | undefined;
    if (
      key.type === "contractData" &&
      key.contractData.contract.type === "scAddressTypeContract"
    ) {
      contractId = key.contractData.contract.contractId.toString();
    } else if (key.type === "contractCode") {
      contractId = key.contractCode.hash.toString();
    }
    return { xdr: raw, type: classifyEntryType(key), contractId };
  });
}

/**
 * Extract all unique contract IDs from footprint entries
 * @param footprintEntries - Array of base64 XDR strings
 * @returns Array of unique contract IDs
 */
export function extractContracts(footprintEntries: string[]): string[] {
  const parsed = parseFootprintEntries(footprintEntries);
  const contractIds = new Set<string>();

  for (const entry of parsed) {
    if (entry.contractId) {
      contractIds.add(entry.contractId);
    }
  }

  return Array.from(contractIds);
}

/**
 * Parse both readOnly and readWrite footprint arrays
 * @param footprint - Object with readOnly and readWrite arrays
 * @returns Object with parsed entries and contracts array
 */
export function parseFootprint(footprint: {
  readOnly: string[];
  readWrite: string[];
}): {
  readOnly: FootprintEntry[];
  readWrite: FootprintEntry[];
  contracts: string[];
} {
  const allEntries = [...footprint.readOnly, ...footprint.readWrite];
  const contracts = extractContracts(allEntries);

  return {
    readOnly: parseFootprintEntries(footprint.readOnly),
    readWrite: parseFootprintEntries(footprint.readWrite),
    contracts,
  };
}

/** SEP-41 token interface required function names */
const SEP41_FUNCTIONS = [
  "transfer",
  "transfer_from",
  "burn",
  "burn_from",
  "balance",
  "allowance",
  "approve",
  "decimals",
  "name",
  "symbol",
  "total_supply",
  "mint",
];

export type ContractType = "token" | "unknown";

/** Cache of contractId → detected ContractType */
const contractTypeCache = new Map<string, ContractType>();

/**
 * Detect whether a contract implements the SEP-41 token interface.
 * Result is cached per contract ID.
 *
 * @param contractId - Hex contract ID
 * @param server - SorobanRpc server to fetch contract code
 * @returns "token" if SEP-41 signatures detected, otherwise "unknown"
 */
export async function detectTokenContract(
  contractId: string,
  server: StellarSdk.rpc.Server,
): Promise<ContractType> {
  if (contractTypeCache.has(contractId)) {
    return contractTypeCache.get(contractId)!;
  }

  try {
    const contractIdBytes = Uint8Array.from(
      contractId.match(/.{2}/g)!.map((b) => parseInt(b, 16)),
    );
    const ledgerKey = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({
        hash: contractIdBytes,
      }),
    );

    const response = await server.getLedgerEntries(ledgerKey);
    const entry = response.entries?.[0];

    if (!entry) {
      contractTypeCache.set(contractId, "unknown");
      return "unknown";
    }

    if (entry.val.type !== "contractCode") return "unknown";
    const wasmBytes = entry.val.contractCode.code;
    const wasmText = new TextDecoder().decode(wasmBytes);

    const matchCount = SEP41_FUNCTIONS.filter((fn) =>
      wasmText.includes(fn),
    ).length;

    // Require at least 6 of the SEP-41 function names to be present
    const result: ContractType = matchCount >= 6 ? "token" : "unknown";
    contractTypeCache.set(contractId, result);
    return result;
  } catch {
    contractTypeCache.set(contractId, "unknown");
    return "unknown";
  }
}

/** Parse invocations and network-specific contract IDs before deployment. */
export function parseContractInvocation(
  hostFunction: StellarSdk.xdr.HostFunction,
  networkPassphrase: string,
): ContractInvocation | undefined {
  switch (hostFunction.switch().name) {
    case "hostFunctionTypeInvokeContract": {
      const call = hostFunction.invokeContract();
      return {
        contractId: StellarSdk.Address.fromScAddress(
          call.contractAddress(),
        ).toString(),
        functionName: call.functionName().toString(),
        args: call.args().map((arg) => arg.toXDR("base64")),
      };
    }
    case "hostFunctionTypeCreateContract":
    case "hostFunctionTypeCreateContractV2": {
      const constructor =
        hostFunction.switch().name === "hostFunctionTypeCreateContractV2";
      const creation = constructor
        ? hostFunction.createContractV2()
        : hostFunction.createContract();
      const preimage = StellarSdk.xdr.HashIdPreimage.envelopeTypeContractId(
        new StellarSdk.xdr.HashIdPreimageContractId({
          networkId: StellarSdk.hash(Buffer.from(networkPassphrase)),
          contractIdPreimage: creation.contractIdPreimage(),
        }),
      );
      return {
        contractId: StellarSdk.StrKey.encodeContract(
          StellarSdk.hash(preimage.toXDR()),
        ),
        functionName: constructor ? "__constructor" : "createContract",
        args: constructor
          ? hostFunction
              .createContractV2()
              .constructorArgs()
              .map((arg) => arg.toXDR("base64"))
          : [],
        isContractCreation: true,
      };
    }
    default:
      return undefined;
  }
}

/** The instance key of a newly created contract must be writable. */
export function hasContractCreationInstance(
  invocation: ContractInvocation,
  readWrite: string[],
): boolean {
  const instance = new StellarSdk.Contract(invocation.contractId)
    .getFootprint()
    .toXDR("base64");
  return readWrite.includes(instance);
}
