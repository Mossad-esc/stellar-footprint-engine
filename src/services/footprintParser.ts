import * as StellarSdk from "@stellar/stellar-sdk";

import {
  AssetInfo,
  ContractInvocation,
  ContractType,
  FootprintBreakdown,
  FootprintStats,
  SacContract,
  StorageCategory,
  TtlInfo,
} from "../types";

export type { ContractType };

/**
 * Types of ledger keys that can appear in a footprint
 */
export enum LedgerKeyType {
  CONTRACT_DATA = "ContractData",
  CONTRACT_CODE = "ContractCode",
  ACCOUNT = "Account",
  TRUST_LINE = "TrustLine",
  OFFER = "Offer",
  DATA = "Data",
  CLAIMABLE_BALANCE = "ClaimableBalance",
  LIQUIDITY_POOL = "LiquidityPool",
  CONFIG_SETTING = "ConfigSetting",
  TTL = "Ttl",
  UNKNOWN = "Unknown",
}

export interface FootprintEntry {
  /** Raw base64 is retained even if the SDK cannot decode a future key. */
  xdr: string;
  type: LedgerKeyType;
  contractId?: string;
  accountId?: string;
  storageType?: StorageCategory;
  isSAC?: boolean;
  assetInfo?: AssetInfo;
  ttlInfo?: TtlInfo;
}

function toBytes(val: unknown): Uint8Array {
  if (val instanceof Uint8Array) return val;
  if (val && typeof val === "object" && "value" in val) {
    return (val as { value: Uint8Array }).value;
  }
  return val as Uint8Array;
}

function parseLedgerKey(raw: string): StellarSdk.xdr.LedgerKey | null {
  try {
    return StellarSdk.xdr.LedgerKey.fromXDR(raw, "base64");
  } catch {
    return null;
  }
}

function extractTrustlineAssetInfo(
  asset: StellarSdk.xdr.TrustLineAsset,
): AssetInfo | undefined {
  if (asset.type === "assetTypeCreditAlphanum4") {
    return {
      code: Buffer.from(toBytes(asset.alphaNum4.assetCode))
        .toString("ascii")
        .replace(/\0+$/, ""),
      issuer: StellarSdk.StrKey.encodeEd25519PublicKey(
        Buffer.from(toBytes(asset.alphaNum4.issuer.ed25519)),
      ),
    };
  }
  if (asset.type === "assetTypeCreditAlphanum12") {
    return {
      code: Buffer.from(toBytes(asset.alphaNum12.assetCode))
        .toString("ascii")
        .replace(/\0+$/, ""),
      issuer: StellarSdk.StrKey.encodeEd25519PublicKey(
        Buffer.from(toBytes(asset.alphaNum12.issuer.ed25519)),
      ),
    };
  }
  return undefined;
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
    let accountId: string | undefined;
    let storageType: StorageCategory | undefined;
    let assetInfo: AssetInfo | undefined;
    if (key.type === "contractData") {
      if (key.contractData.contract.type === "scAddressTypeContract") {
        contractId = Buffer.from(
          toBytes(key.contractData.contract.contractId),
        ).toString("hex");
      }
      if (key.contractData.key.type === "scvLedgerKeyContractInstance") {
        storageType = "contractInstance";
      } else if (
        key.contractData.durability ===
        StellarSdk.xdr.ContractDataDurability.persistent
      ) {
        storageType = "persistentData";
      } else {
        storageType = "temporaryData";
      }
    } else if (key.type === "contractCode") {
      contractId = Buffer.from(toBytes(key.contractCode.hash)).toString("hex");
      storageType = "contractCode";
    } else if (key.type === "account") {
      accountId = StellarSdk.StrKey.encodeEd25519PublicKey(
        Buffer.from(toBytes(key.account.accountId.ed25519)),
      );
    } else if (key.type === "trustline") {
      accountId = StellarSdk.StrKey.encodeEd25519PublicKey(
        Buffer.from(toBytes(key.trustLine.accountId.ed25519)),
      );
      assetInfo = extractTrustlineAssetInfo(key.trustLine.asset);
    }
    return {
      xdr: raw,
      type: classifyEntryType(key),
      ...(contractId ? { contractId } : {}),
      ...(accountId ? { accountId } : {}),
      ...(storageType ? { storageType } : {}),
      ...(assetInfo ? { assetInfo } : {}),
    };
  });
}

export function isSacContract(
  contractId: string,
  asset: AssetInfo,
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): boolean {
  try {
    const stellarAsset =
      asset.code === "XLM" && !asset.issuer
        ? StellarSdk.Asset.native()
        : asset.issuer
          ? new StellarSdk.Asset(asset.code, asset.issuer)
          : null;
    if (!stellarAsset) return false;
    const strKeyId = stellarAsset.contractId(networkPassphrase);
    const hexId = Buffer.from(
      StellarSdk.StrKey.decodeContract(strKeyId),
    ).toString("hex");
    return contractId === hexId || contractId === strKeyId;
  } catch {
    return false;
  }
}

function parseAssetInfoFromScVal(
  val: StellarSdk.xdr.ScVal,
): AssetInfo | undefined {
  if (val.type !== "scvContractInstance") return undefined;
  const storage = val.instance.storage ?? [];
  for (const entry of storage) {
    const isAssetInfoKey =
      (entry.key.type === "scvVec" &&
        entry.key.vec?.[0]?.type === "scvSymbol" &&
        entry.key.vec[0].sym.toString() === "AssetInfo") ||
      (entry.key.type === "scvSymbol" &&
        entry.key.sym.toString() === "AssetInfo");
    if (!isAssetInfoKey) continue;
    if (entry.val.type !== "scvVec" || !entry.val.vec?.length) continue;
    const tag = entry.val.vec[0];
    if (tag.type !== "scvSymbol") continue;
    if (tag.sym.toString() === "Native") {
      return { code: "XLM" };
    }
    if (
      (tag.sym.toString() === "AlphaNum4" ||
        tag.sym.toString() === "AlphaNum12") &&
      entry.val.vec[1]?.type === "scvMap"
    ) {
      let code: string | undefined;
      let issuer: string | undefined;
      for (const kv of entry.val.vec[1].map ?? []) {
        if (kv.key.type !== "scvSymbol") continue;
        const k = kv.key.sym.toString();
        if (k === "asset_code" && kv.val.type === "scvString") {
          code = kv.val.str.toString();
        } else if (k === "issuer" && kv.val.type === "scvBytes") {
          issuer = StellarSdk.StrKey.encodeEd25519PublicKey(
            Buffer.from(toBytes(kv.val.bytes)),
          );
        }
      }
      if (code && issuer) return { code, issuer };
    }
  }
  return undefined;
}

export async function detectSacContracts(
  entries: FootprintEntry[],
  server: StellarSdk.rpc.Server,
  networkPassphrase: string = StellarSdk.Networks.TESTNET,
): Promise<SacContract[]> {
  const instanceEntries = entries.filter(
    (e) =>
      e.type === LedgerKeyType.CONTRACT_DATA &&
      e.storageType === "contractInstance" &&
      e.contractId,
  );
  if (instanceEntries.length === 0) return [];

  const sacs: SacContract[] = [];
  for (const entry of instanceEntries) {
    try {
      const ledgerKey = StellarSdk.xdr.LedgerKey.fromXDR(entry.xdr, "base64");
      const resp = await server.getLedgerEntries(ledgerKey);
      const val = resp.entries?.[0]?.val;
      if (!val || val.type !== "contractData") continue;
      const assetInfo = parseAssetInfoFromScVal(val.contractData.val);
      if (
        assetInfo &&
        entry.contractId &&
        isSacContract(entry.contractId, assetInfo, networkPassphrase)
      ) {
        sacs.push({
          contractId: entry.contractId,
          isSAC: true,
          assetInfo,
        });
      }
    } catch {
      // Keep footprints usable when SAC metadata lookup fails
    }
  }
  return sacs;
}

export function mergeFootprints(
  footprints: { readOnly: string[]; readWrite: string[] }[],
): { readOnly: string[]; readWrite: string[] } {
  const rwSet = new Set<string>();
  const roSet = new Set<string>();
  for (const fp of footprints) {
    for (const k of fp.readWrite) rwSet.add(k);
  }
  for (const fp of footprints) {
    for (const k of fp.readOnly) {
      if (!rwSet.has(k)) roSet.add(k);
    }
  }
  return {
    readOnly: Array.from(roSet),
    readWrite: Array.from(rwSet),
  };
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
  const readOnlySizeBytes =
    4 +
    footprint.readOnly.reduce(
      (sum, key) => sum + Buffer.from(key, "base64").length,
      0,
    );
  const readWriteSizeBytes =
    4 +
    footprint.readWrite.reduce(
      (sum, key) => sum + Buffer.from(key, "base64").length,
      0,
    );
  return {
    readOnlyCount: footprint.readOnly.length,
    readWriteCount: footprint.readWrite.length,
    totalEntries: footprint.readOnly.length + footprint.readWrite.length,
    readOnlySizeBytes,
    readWriteSizeBytes,
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
  switch (hostFunction.type) {
    case "hostFunctionTypeInvokeContract": {
      const call = hostFunction.invokeContract;
      return {
        contractId: StellarSdk.Address.fromScAddress(
          call.contractAddress,
        ).toString(),
        functionName: call.functionName.toString(),
        args: call.args.map((arg) => arg.toXDR("base64")),
      };
    }
    case "hostFunctionTypeCreateContract":
    case "hostFunctionTypeCreateContractV2": {
      const constructor =
        hostFunction.type === "hostFunctionTypeCreateContractV2";
      const creation = constructor
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
        functionName: constructor ? "__constructor" : "createContract",
        args:
          hostFunction.type === "hostFunctionTypeCreateContractV2"
            ? hostFunction.createContractV2.constructorArgs.map((arg) =>
                arg.toXDR("base64"),
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
