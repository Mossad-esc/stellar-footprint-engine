import * as StellarSdk from "@stellar/stellar-sdk";

import type {
  AssetInfo,
  ContractType,
  SacContract,
  StorageCategory,
  FootprintBreakdown,
  FootprintStats,
} from "../types";

export type { ContractType } from "../types";

/** Merge ledger keys by their XDR bytes. Write access always includes read access. */
export function mergeFootprints(
  footprints: readonly { readOnly: string[]; readWrite: string[] }[],
): { readOnly: string[]; readWrite: string[] } {
  const readOnly = new Map<string, Buffer>();
  const readWrite = new Map<string, Buffer>();
  for (const footprint of footprints) {
    for (const [entries, target] of [
      [footprint.readOnly, readOnly],
      [footprint.readWrite, readWrite],
    ] as const) {
      for (const entry of entries) {
        const bytes = Buffer.from(entry, "base64");
        target.set(bytes.toString("base64"), bytes);
      }
    }
  }
  for (const key of readWrite.keys()) readOnly.delete(key);
  const sorted = (entries: Map<string, Buffer>): string[] =>
    [...entries.values()]
      .sort(Buffer.compare)
      .map((bytes) => bytes.toString("base64"));
  return { readOnly: sorted(readOnly), readWrite: sorted(readWrite) };
}

/**
 * Types of ledger keys that can appear in a footprint
 */
export type LedgerKeyType =
  | "ContractData"
  | "ContractCode"
  | "Account"
  | "TrustLine"
  | "Unknown";

/**
 * A footprint entry with its type and extracted data
 */
export interface FootprintEntry {
  /** The raw base64 XDR of the entry */
  xdr: string;
  /** The classified type of the ledger key */
  type: LedgerKeyType;
  /** The contract ID if this is a ContractData or ContractCode entry */
  contractId?: string;
  accountId?: string;
  isSAC?: boolean;
  assetInfo?: AssetInfo;
  storageType?: StorageCategory;
}

/** A SAC address is a network-specific hash of an asset, not a special prefix. */
export function isSacContract(
  contractId: string,
  assetInfo: AssetInfo = { code: "XLM" },
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): boolean {
  try {
    const asset = assetInfo.issuer
      ? new StellarSdk.Asset(assetInfo.code, assetInfo.issuer)
      : assetInfo.code === "XLM"
        ? StellarSdk.Asset.native()
        : undefined;
    const address = /^[a-f0-9]{64}$/i.test(contractId)
      ? StellarSdk.StrKey.encodeContract(Buffer.from(contractId, "hex"))
      : contractId;
    return asset?.contractId(networkPassphrase) === address;
  } catch {
    return false;
  }
}

function trustLineAsset(key: StellarSdk.xdr.LedgerKey): AssetInfo | undefined {
  const asset = key.trustLine().asset();
  if (asset.switch().name === "assetTypePoolShare") return undefined;
  const credit =
    asset.switch().name === "assetTypeCreditAlphanum4"
      ? asset.alphaNum4()
      : asset.alphaNum12();
  return {
    code: credit.assetCode().toString("ascii").replace(/\0+$/, ""),
    issuer: StellarSdk.StrKey.encodeEd25519PublicKey(credit.issuer().ed25519()),
  };
}

function sacAssetFromInstance(
  instance: StellarSdk.xdr.ScContractInstance,
): AssetInfo | undefined {
  for (const entry of instance.storage() ?? []) {
    if (entry.key().switch().name !== "scvVec") continue;
    const key = entry.key().vec();
    if (
      key?.length !== 1 ||
      key[0].switch().name !== "scvSymbol" ||
      key[0].sym().toString() !== "AssetInfo"
    )
      continue;
    const value = StellarSdk.scValToNative(entry.val()) as unknown;
    if (!Array.isArray(value)) continue;
    if (value[0] === "Native") return { code: "XLM" };
    if (value[0] !== "AlphaNum4" && value[0] !== "AlphaNum12") continue;
    const credit = value[1] as
      | { asset_code?: unknown; issuer?: unknown }
      | undefined;
    if (
      typeof credit?.asset_code !== "string" ||
      !(credit.issuer instanceof Uint8Array)
    )
      continue;
    return {
      code: credit.asset_code,
      issuer: StellarSdk.StrKey.encodeEd25519PublicKey(
        Buffer.from(credit.issuer),
      ),
    };
  }
  return undefined;
}

/** Read actual SAC executables and AssetInfo for contract balances without trustlines. */
export async function detectSacContracts(
  entries: FootprintEntry[],
  server: StellarSdk.rpc.Server,
  networkPassphrase: string,
): Promise<SacContract[]> {
  const contracts = new Map<string, SacContract>();
  const unknown = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "ContractData" || !entry.contractId) continue;
    if (entry.isSAC)
      contracts.set(entry.contractId, {
        contractId: entry.contractId,
        isSAC: true,
        assetInfo: entry.assetInfo,
      });
    else unknown.add(entry.contractId);
  }
  const ids = [...unknown].filter((id) => !contracts.has(id));
  if (ids.length === 0) return [...contracts.values()];
  try {
    const keys = ids.map((id) =>
      StellarSdk.xdr.LedgerKey.contractData(
        new StellarSdk.xdr.LedgerKeyContractData({
          contract: StellarSdk.Address.fromString(
            StellarSdk.StrKey.encodeContract(Buffer.from(id, "hex")),
          ).toScAddress(),
          key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
          durability: StellarSdk.xdr.ContractDataDurability.persistent(),
        }),
      ),
    );
    const response = await server.getLedgerEntries(...keys);
    for (const entry of response.entries ?? []) {
      if (entry.val.switch().name !== "contractData") continue;
      const data = entry.val.contractData();
      if (data.val().switch().name !== "scvContractInstance") continue;
      const instance = data.val().instance();
      if (
        instance.executable().switch().name !== "contractExecutableStellarAsset"
      )
        continue;
      const contractId = Buffer.from(
        data.contract().value() as unknown as Uint8Array,
      ).toString("hex");
      if (!ids.includes(contractId)) continue;
      const assetInfo = sacAssetFromInstance(instance);
      // An executable proves SAC status; only attach asset metadata if its hash matches.
      contracts.set(contractId, {
        contractId,
        isSAC: true,
        ...(assetInfo && isSacContract(contractId, assetInfo, networkPassphrase)
          ? { assetInfo }
          : {}),
      });
    }
  } catch {
    // Metadata lookups must not invalidate an otherwise usable footprint.
  }
  return [...contracts.values()];
}

/**
 * Get the switch name for a ledger key
 */
function getLedgerKeySwitchName(key: StellarSdk.xdr.LedgerKey): string {
  return key.switch().name;
}

/**
 * Parse a single footprint entry XDR and extract its contract ID
 * @param xdrBase64 - The base64 encoded XDR string
 * @returns The decoded contract ID if this is a ContractData or ContractCode entry
 */
function extractContractId(xdrBase64: string): string | undefined {
  try {
    const ledgerKey = StellarSdk.xdr.LedgerKey.fromXDR(xdrBase64, "base64");
    const switchName = getLedgerKeySwitchName(ledgerKey);

    // Check if this is a ContractData or ContractCode entry
    if (switchName === "contractData") {
      const contractData = ledgerKey.contractData();
      return (contractData.contract().value() as unknown as Buffer).toString(
        "hex",
      );
    }

    if (switchName === "contractCode") {
      const contractCode = ledgerKey.contractCode();
      return contractCode.hash().toString("hex");
    }

    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Classify a ledger key XDR into its type
 * @param xdrBase64 - The base64 encoded XDR string
 * @returns The type of the ledger key
 */
function classifyEntryType(xdrBase64: string): LedgerKeyType {
  try {
    const ledgerKey = StellarSdk.xdr.LedgerKey.fromXDR(xdrBase64, "base64");
    const switchName = getLedgerKeySwitchName(ledgerKey);

    switch (switchName) {
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
  } catch {
    return "Unknown";
  }
}

/**
 * Parse footprint entries and extract contract IDs
 * @param footprintEntries - Array of base64 XDR strings
 * @returns Array of footprint entries with type and contract ID
 */
export function parseFootprintEntries(entries: string[]): FootprintEntry[] {
  return entries.map((xdr) => {
    const type = classifyEntryType(xdr);
    const contractId = extractContractId(xdr);

    const entry: FootprintEntry = {
      xdr,
      type,
      contractId,
    };
    try {
      const key = StellarSdk.xdr.LedgerKey.fromXDR(xdr, "base64");
      if (type === "ContractCode") {
        entry.storageType = "contractCode";
      } else if (type === "ContractData") {
        const data = key.contractData();
        entry.storageType =
          data.key().switch().name === "scvLedgerKeyContractInstance"
            ? "contractInstance"
            : data.durability().name === "temporary"
              ? "temporaryData"
              : "persistentData";
      } else if (type === "TrustLine") {
        entry.accountId = StellarSdk.StrKey.encodeEd25519PublicKey(
          key.trustLine().accountId().ed25519(),
        );
        entry.assetInfo = trustLineAsset(key);
      } else if (type === "Account") {
        entry.accountId = StellarSdk.StrKey.encodeEd25519PublicKey(
          key.account().accountId().ed25519(),
        );
      }
    } catch {
      // Invalid and unsupported ledger keys remain Unknown.
    }
    return entry;
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
  const empty = () => ({
    count: 0,
    estimatedSizeBytes: 0,
    readOnly: [] as string[],
    readWrite: [] as string[],
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
  return {
    readOnlyCount: footprint.readOnly.length,
    readWriteCount: footprint.readWrite.length,
    totalEntries: footprint.readOnly.length + footprint.readWrite.length,
    estimatedSizeBytes: [...footprint.readOnly, ...footprint.readWrite].reduce(
      (sum, key) => sum + Buffer.from(key, "base64").length,
      0,
    ),
    isSAC: parsed.isSAC,
    ...(parsed.assetInfo ? { assetInfo: parsed.assetInfo } : {}),
    breakdown: parsed.breakdown,
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
 *
 * @param contractId - Hex contract ID
 * @param server - SorobanRpc server to fetch contract code
 * @returns "token" if SEP-41 signatures detected, otherwise "unknown"
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
        hash: contractIdBytes as unknown as Buffer,
      }),
    );

    const response = await server.getLedgerEntries(ledgerKey);
    const entry = response.entries?.[0];

    if (!entry) {
      contractTypeCache.set(contractId, "unknown");
      return "unknown";
    }

    const ledgerEntryData = entry.val.contractCode();
    const wasmBytes = ledgerEntryData.code() as unknown as Uint8Array;
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
