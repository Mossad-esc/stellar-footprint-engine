import * as StellarSdk from "@stellar/stellar-sdk";

import {
  ContractInvocation,
  StorageCategory,
  FootprintBreakdown,
  FootprintStats,
  AssetInfo,
  SacContract,
  ContractType,
  TtlInfo,
} from "../types";

/**
 * Types of ledger keys that can appear in a footprint
 */
export type LedgerKeyType =
  "ContractData" | "ContractCode" | "Account" | "TrustLine" | "Unknown";

export interface FootprintEntry {
  /** Raw base64 is retained even if the SDK cannot decode a future key. */
  xdr: string;
  type: LedgerKeyType;
  contractId?: string;
  ttlInfo?: TtlInfo;
  /** Storage category for the breakdown table. */
  storageType?: StorageCategory;
  isSAC?: boolean;
  assetInfo?: AssetInfo;
}

/** Safely parse a base64 XDR ledger key; returns undefined on failure. */
export function parseLedgerKey(
  raw: string,
): StellarSdk.xdr.LedgerKey | undefined {
  try {
    return StellarSdk.xdr.LedgerKey.fromXDR(raw, "base64");
  } catch {
    return undefined;
  }
}

function classifyEntryType(key: StellarSdk.xdr.LedgerKey): LedgerKeyType {
  switch (key.type) {
    case "contractData":
      return "ContractData";
    case "contractCode":
      return "ContractCode";
    case "account":
      return "Account";
    case "trustline":
      return "TrustLine";
    default:
      return "Unknown";
  }
}

/**
 * Determine the StorageCategory for a ledger key.
 * ContractCode → "contractCode"
 * ContractData + scvLedgerKeyContractInstance → "contractInstance"
 * ContractData + persistent durability → "persistentData"
 * ContractData + temporary durability → "temporaryData"
 * Everything else → undefined (not counted in breakdown)
 */
function classifyStorageType(
  key: StellarSdk.xdr.LedgerKey,
): StorageCategory | undefined {
  if (key.type === "contractCode") return "contractCode";
  if (key.type !== "contractData") return undefined;

  const data = key.contractData;

  // scvLedgerKeyContractInstance identifies the instance key specifically
  if (data.key.type === "scvLedgerKeyContractInstance") {
    return "contractInstance";
  }

  // For all other contract data keys, use the durability field
  // durability is a ContractDataDurability object with a .name property
  if (data.durability.name === "temporary") return "temporaryData";
  return "persistentData";
}

export function parseFootprintEntries(entries: string[]): FootprintEntry[] {
  return entries.map((raw) => {
    const key = parseLedgerKey(raw);
    if (!key) return { xdr: raw, type: "Unknown" };
    let contractId: string | undefined;
    if (
      key.type === "contractData" &&
      key.contractData.contract.type === "scAddressTypeContract"
    ) {
      contractId = Buffer.from(
        key.contractData.contract.contractId as unknown as Uint8Array,
      ).toString("hex");
    } else if (key.type === "contractCode") {
      contractId = Buffer.from(
        key.contractCode.hash as unknown as Uint8Array,
      ).toString("hex");
    }
    return {
      xdr: raw,
      type: classifyEntryType(key),
      contractId,
      storageType: classifyStorageType(key),
    };
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

/** Merge footprint arrays by deduplicating entries across readOnly and readWrite. */
export function mergeFootprints(
  footprints: { readOnly: string[]; readWrite: string[] }[],
): { readOnly: string[]; readWrite: string[] } {
  const readWrite = new Set<string>();
  const readOnly = new Set<string>();
  for (const fp of footprints) {
    for (const key of fp.readWrite) readWrite.add(key);
    for (const key of fp.readOnly) {
      if (!readWrite.has(key)) readOnly.add(key);
    }
  }
  return {
    readOnly: Array.from(readOnly),
    readWrite: Array.from(readWrite),
  };
}

/**
 * Check whether a contract ID corresponds to the SAC for a given asset and network.
 */
export function isSacContract(
  contractId: string,
  assetInfo?: AssetInfo,
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): boolean {
  if (!assetInfo) return false;
  try {
    const asset = assetInfo.issuer
      ? new StellarSdk.Asset(assetInfo.code, assetInfo.issuer)
      : StellarSdk.Asset.native();
    const sacId = Buffer.from(
      StellarSdk.StrKey.decodeContract(asset.contractId(networkPassphrase)),
    ).toString("hex");
    return sacId === contractId;
  } catch {
    return false;
  }
}

/**
 * Read SAC instance entries to discover asset metadata when it isn't deducible
 * from the classic ledger keys alone.
 */
export async function detectSacContracts(
  entries: FootprintEntry[],
  server: StellarSdk.rpc.Server,
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): Promise<SacContract[]> {
  const instanceEntries = entries.filter(
    (e) => e.storageType === "contractInstance" && e.contractId,
  );
  if (instanceEntries.length === 0) return [];
  try {
    const keys = instanceEntries.map((e) =>
      StellarSdk.xdr.LedgerKey.fromXDR(e.xdr, "base64"),
    );
    const { entries: ledgerEntries } = await server.getLedgerEntries(...keys);
    const sacs: SacContract[] = [];
    for (const entry of ledgerEntries) {
      if (entry.val.type !== "contractData") continue;
      const instanceData = entry.val.contractData;
      if (instanceData.val.type !== "scvContractInstance") continue;
      const instance = instanceData.val.instance;
      if (instance.executable.type !== "contractExecutableStellarAsset")
        continue;
      const contractKey = entry.key;
      if (contractKey.type !== "contractData") continue;
      const contractAddr = contractKey.contractData.contract;
      if (contractAddr.type !== "scAddressTypeContract") continue;
      const contractId = Buffer.from(
        contractAddr.contractId as unknown as Uint8Array,
      ).toString("hex");
      sacs.push({ contractId, isSAC: true });
    }
    return sacs;
  } catch {
    return [];
  }
}

/**
 * Parse both readOnly and readWrite footprint arrays
 * @param footprint - Object with readOnly and readWrite arrays
 * @returns Object with parsed entries and contracts array
 */
export function parseFootprint(
  footprint: {
    readOnly: string[];
    readWrite: string[];
  },
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
  sacContracts: SacContract[] = [],
): {
  readOnly: FootprintEntry[];
  readWrite: FootprintEntry[];
  contracts: string[];
  isSAC: boolean;
  assetInfo?: AssetInfo;
  sacContracts: SacContract[];
  breakdown: FootprintBreakdown;
} {
  const allEntries = [...footprint.readOnly, ...footprint.readWrite];
  const contracts = extractContracts(allEntries);

  const readOnly = parseFootprintEntries(footprint.readOnly);
  const readWrite = parseFootprintEntries(footprint.readWrite);
  const entries = [...readOnly, ...readWrite];
  const assets: AssetInfo[] = [{ code: "XLM" }];
  for (const entry of entries) {
    if (entry.type === "TrustLine" && entry.assetInfo)
      assets.push(entry.assetInfo);
  }
  const sacs = new Map(
    sacContracts.map((contract) => [contract.contractId, contract]),
  );
  for (const entry of entries) {
    if (entry.type !== "ContractData" || !entry.contractId) continue;
    const contractId = entry.contractId;
    const assetInfo = assets.find((asset) =>
      isSacContract(contractId, asset, networkPassphrase),
    );
    if (assetInfo)
      sacs.set(entry.contractId, {
        contractId: entry.contractId,
        isSAC: true,
        assetInfo,
      });
  }
  for (const entry of entries) {
    const sac =
      entry.type === "ContractData" && entry.contractId
        ? sacs.get(entry.contractId)
        : undefined;
    const balanceAsset =
      entry.type === "Account"
        ? { code: "XLM" }
        : entry.type === "TrustLine"
          ? entry.assetInfo
          : undefined;
    const balanceSac = balanceAsset
      ? [...sacs.values()].find(
          (candidate) =>
            candidate.assetInfo?.code === balanceAsset.code &&
            candidate.assetInfo?.issuer === balanceAsset.issuer,
        )
      : undefined;
    entry.isSAC = Boolean(sac || balanceSac);
    if (sac?.assetInfo) entry.assetInfo = sac.assetInfo;
    if (balanceSac?.assetInfo) entry.assetInfo = balanceSac.assetInfo;
  }
  const confirmed = [...sacs.values()];
  return {
    readOnly,
    readWrite,
    contracts,
    isSAC: confirmed.length > 0,
    ...(confirmed.length === 1 && confirmed[0].assetInfo
      ? { assetInfo: confirmed[0].assetInfo }
      : {}),
    sacContracts: confirmed,
    breakdown: buildFootprintBreakdown(readOnly, readWrite),
  };
}

function buildFootprintBreakdown(
  readOnly: FootprintEntry[],
  readWrite: FootprintEntry[],
): FootprintBreakdown {
  const empty = (): {
    count: number;
    estimatedSizeBytes: number;
    readOnly: string[];
    readWrite: string[];
  } => ({
    count: 0,
    estimatedSizeBytes: 0,
    readOnly: [],
    readWrite: [],
  });
  const breakdown: FootprintBreakdown = {
    contractCode: empty(),
    contractInstance: empty(),
    persistentData: empty(),
    temporaryData: empty(),
  };
  for (const [entries, mode] of [
    [readOnly, "readOnly"],
    [readWrite, "readWrite"],
  ] as const) {
    for (const entry of entries) {
      if (!entry.storageType) continue;
      const category = breakdown[entry.storageType];
      category[mode].push(entry.xdr);
      category.count++;
      category.estimatedSizeBytes += Buffer.from(entry.xdr, "base64").length;
    }
  }
  return breakdown;
}

export function calculateFootprintStats(
  footprint: { readOnly: string[]; readWrite: string[] },
  parsed: Pick<
    ReturnType<typeof parseFootprint>,
    "isSAC" | "assetInfo" | "breakdown"
  > = parseFootprint(footprint),
): FootprintStats {
  const allKeys = [...footprint.readOnly, ...footprint.readWrite];
  const temporaryEntries = [
    ...parsed.breakdown.temporaryData.readOnly,
    ...parsed.breakdown.temporaryData.readWrite,
  ];
  const persistentEntries = [
    ...parsed.breakdown.persistentData.readOnly,
    ...parsed.breakdown.persistentData.readWrite,
  ];
  const temporaryEntrySizeBytes = temporaryEntries.reduce(
    (sum, k) => sum + Buffer.from(k, "base64").length,
    0,
  );
  const persistentEntrySizeBytes = persistentEntries.reduce(
    (sum, k) => sum + Buffer.from(k, "base64").length,
    0,
  );
  const persistentStorageOptimizationHint =
    persistentEntries.length > 0
      ? `${persistentEntries.length} persistent storage entr${persistentEntries.length === 1 ? "y" : "ies"} detected. ` +
        "Consider using temporary storage for transient data to reduce rent costs."
      : undefined;

  // Calculate exact LedgerFootprint wire sizes
  const readOnlyKeys = footprint.readOnly.flatMap((k) => {
    try {
      return [StellarSdk.xdr.LedgerKey.fromXDR(k, "base64")];
    } catch {
      return [];
    }
  });
  const readWriteKeys = footprint.readWrite.flatMap((k) => {
    try {
      return [StellarSdk.xdr.LedgerKey.fromXDR(k, "base64")];
    } catch {
      return [];
    }
  });
  const readOnlySizeBytes =
    4 + readOnlyKeys.reduce((sum, key) => sum + key.toXDR().length, 0);
  const readWriteSizeBytes =
    4 + readWriteKeys.reduce((sum, key) => sum + key.toXDR().length, 0);
  const estimatedSizeBytes = allKeys.reduce(
    (sum, key) => sum + Buffer.from(key, "base64").length,
    0,
  );

  return {
    readOnlyCount: footprint.readOnly.length,
    readWriteCount: footprint.readWrite.length,
    totalEntries: footprint.readOnly.length + footprint.readWrite.length,
    readOnlySizeBytes,
    readWriteSizeBytes,
    estimatedSizeBytes,
    isSAC: parsed.isSAC,
    ...(parsed.assetInfo ? { assetInfo: parsed.assetInfo } : {}),
    breakdown: parsed.breakdown,
    temporaryEntryCount: temporaryEntries.length,
    temporaryEntrySizeBytes,
    persistentEntryCount: persistentEntries.length,
    persistentEntrySizeBytes,
    ...(persistentStorageOptimizationHint
      ? { persistentStorageOptimizationHint }
      : {}),
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

/** Cache of contractId → detected ContractType */
const contractTypeCache = new Map<string, ContractType>();

/**
 * Detect whether a contract implements the SEP-41 token interface.
 * Result is cached per contract ID.
 */
export async function detectTokenContract(
  contractId: string,
  server: StellarSdk.rpc.Server,
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): Promise<ContractType> {
  if (isSacContract(contractId, { code: "XLM" }, networkPassphrase))
    return "sac";
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
  switch (hostFunction.type) {
    case "hostFunctionTypeInvokeContract": {
      const call = hostFunction.invokeContract;
      return {
        contractId: StellarSdk.Address.fromScAddress(
          call.contractAddress,
        ).toString(),
        functionName: call.functionName.toString(),
        args: call.args.map((arg: StellarSdk.xdr.ScVal) => arg.toXDR("base64")),
      };
    }
    case "hostFunctionTypeCreateContract":
    case "hostFunctionTypeCreateContractV2": {
      const isV2 = hostFunction.type === "hostFunctionTypeCreateContractV2";
      const creation = isV2
        ? hostFunction.createContractV2
        : hostFunction.createContract;
      const preimage = StellarSdk.xdr.HashIdPreimage.envelopeTypeContractId(
        new StellarSdk.xdr.HashIdPreimageContractId({
          networkId: StellarSdk.hash(Buffer.from(networkPassphrase)),
          contractIdPreimage: creation.contractIdPreimage,
        }),
      );
      return {
        contractId: StellarSdk.StrKey.encodeContract(
          StellarSdk.hash(preimage.toXDR()),
        ),
        functionName: isV2 ? "__constructor" : "createContract",
        args: isV2
          ? hostFunction.createContractV2.constructorArgs.map(
              (arg: StellarSdk.xdr.ScVal) => arg.toXDR("base64"),
            )
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
