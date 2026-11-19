import * as StellarSdk from "@stellar/stellar-sdk";

import { calculateFootprintStats } from "./footprintExtractor";
import { getRestorePreamble } from "./restorer";
import { getRpcServer, Network, getNetworkConfig } from "../config/stellar";
import { sanitizeRpcError } from "../utils/rpcErrorSanitizer";

// Stellar fee constants (CAP-0046)
// 1 XLM = 10_000_000 stroops
const STROOPS_PER_XLM = 10_000_000n;

// Soroban resource fee rate constants (network defaults, used as fallback)
const DEFAULT_FEE_RATE_PER_INSTRUCTION_INCREMENT = 25n; // stroops per 10k instructions
const INSTRUCTION_INCREMENT = 10_000n;
const DEFAULT_WRITE_FEE_PER_BYTE = 1_000n; // stroops per byte of write bandwidth
const DEFAULT_READ_FEE_PER_BYTE = 250n; // stroops per byte of read bandwidth
const DEFAULT_HISTORICAL_FEE_RATE = 100n; // stroops per byte of historical data
const DEFAULT_METADATA_FEE_RATE = 100n; // stroops per byte of metadata

// Typical overhead bytes for a Soroban transaction (approximate)
const TYPICAL_TX_OVERHEAD_BYTES = 300n;

export type FeeOperationType = "invoke" | "restore" | "extend";

export interface FeeEstimateOptions {
  operationType?: FeeOperationType;
  xdr?: string;
  extendTo?: number;
  footprint?: { readOnly: string[]; readWrite: string[] };
}

export interface FeeEstimate {
  baseFee: string;
  resourceFee: string;
  totalFee: string;
  feeInXLM: string;
  operationType?: FeeOperationType;
  breakdown?: {
    baseFee: string;
    writeFee: string;
    refundableFee: string;
    otherResourceFee: string;
  };
}

export interface DetailedFeeBreakdown {
  baseFee: string;
  resourceFee: string;
  inclusionFee: string;
  totalStroops: string;
  totalXlm: string;
  breakdown: {
    cpuFee: string;
    memoryFee: string;
    readFee: string;
    overheadFee: string;
  };
}

/**
 * Fetch the recommended inclusion fee (p50 of recent Soroban transactions)
 * from the RPC getFeeStats endpoint.
 */
async function fetchRecommendedInclusionFee(network: Network): Promise<bigint> {
  try {
    const server = getRpcServer(network);
    const stats = await server.getFeeStats();
    const p50 = BigInt(stats.sorobanInclusionFee.p50 ?? "100");
    return p50 > 0n ? p50 : 100n;
  } catch {
    return 100n; // fallback: 100 stroops (Stellar minimum base fee)
  }
}

/**
 * Estimate the Soroban resource fee with detailed breakdown.
 */
function estimateResourceFeeDetailed(
  cpuInsns: bigint,
  memBytes: bigint,
  footprintBytes: bigint = 0n,
): {
  total: bigint;
  cpuFee: bigint;
  memoryFee: bigint;
  readFee: bigint;
  overheadFee: bigint;
} {
  const cpuFee =
    ((cpuInsns + INSTRUCTION_INCREMENT - 1n) / INSTRUCTION_INCREMENT) *
    DEFAULT_FEE_RATE_PER_INSTRUCTION_INCREMENT;

  const memoryFee = memBytes * DEFAULT_WRITE_FEE_PER_BYTE;

  const overheadFee =
    (TYPICAL_TX_OVERHEAD_BYTES + footprintBytes) *
    (DEFAULT_HISTORICAL_FEE_RATE + DEFAULT_METADATA_FEE_RATE);

  const readFee = memBytes * DEFAULT_READ_FEE_PER_BYTE;

  const total = cpuFee + memoryFee + readFee + overheadFee;

  return { total, cpuFee, memoryFee, readFee, overheadFee };
}

/**
 * Estimate fees for a Soroban transaction given simulation cost output.
 */
export async function estimateFee(
  cpuInsns: string,
  memBytes: string,
  network: Network = "testnet",
  options: FeeEstimateOptions = {},
): Promise<FeeEstimate> {
  if (options.operationType && options.operationType !== "invoke") {
    return estimateMaintenanceFee(network, options);
  }
  const cpu = BigInt(cpuInsns);
  const mem = BigInt(memBytes);

  const [baseFee, resourceFee] = await Promise.all([
    fetchRecommendedInclusionFee(network),
    Promise.resolve(
      estimateResourceFeeDetailed(cpu, mem, getFootprintBytes(options)).total,
    ),
  ]);

  const totalFee = baseFee + resourceFee;
  const xlmWhole = totalFee / STROOPS_PER_XLM;
  const xlmFrac = totalFee % STROOPS_PER_XLM;
  const feeInXLM = `${xlmWhole}.${xlmFrac.toString().padStart(7, "0")}`;

  return {
    baseFee: baseFee.toString(),
    resourceFee: resourceFee.toString(),
    totalFee: totalFee.toString(),
    feeInXLM,
  };
}

/**
 * Estimate fees with detailed breakdown for a Soroban transaction.
 */
export async function estimateFeeDetailed(
  cpuInsns: string,
  memBytes: string,
  network: Network = "testnet",
  options: FeeEstimateOptions = {},
): Promise<DetailedFeeBreakdown> {
  const cpu = BigInt(cpuInsns);
  const mem = BigInt(memBytes);

  const [inclusionFee, resourceBreakdown] = await Promise.all([
    fetchRecommendedInclusionFee(network),
    Promise.resolve(
      estimateResourceFeeDetailed(cpu, mem, getFootprintBytes(options)),
    ),
  ]);

  const baseFee = inclusionFee; // Base fee is the inclusion fee
  const resourceFee = resourceBreakdown.total;
  const totalStroops = baseFee + resourceFee;

  // Convert to XLM
  const xlmWhole = totalStroops / STROOPS_PER_XLM;
  const xlmFrac = totalStroops % STROOPS_PER_XLM;
  const totalXlm = `${xlmWhole}.${xlmFrac.toString().padStart(7, "0")}`;

  return {
    baseFee: baseFee.toString(),
    resourceFee: resourceFee.toString(),
    inclusionFee: inclusionFee.toString(),
    totalStroops: totalStroops.toString(),
    totalXlm,
    breakdown: {
      cpuFee: resourceBreakdown.cpuFee.toString(),
      memoryFee: resourceBreakdown.memoryFee.toString(),
      readFee: resourceBreakdown.readFee.toString(),
      overheadFee: resourceBreakdown.overheadFee.toString(),
    },
  };
}

function getFootprintBytes(options: FeeEstimateOptions): bigint {
  return options.footprint
    ? BigInt(
        calculateFootprintStats(
          options.footprint.readOnly,
          options.footprint.readWrite,
        ).estimatedSizeBytes,
      )
    : 0n;
}

function ceilFee(bytes: bigint, rate: bigint, increment = 1024n): bigint {
  return (bytes * rate + increment - 1n) / increment;
}

/** Match Core's maximum signed envelope estimate and default RPC size adjustment. */
function maintenanceTransactionSize(
  tx: StellarSdk.Transaction,
  data: StellarSdk.xdr.SorobanTransactionData,
): bigint {
  const source = StellarSdk.xdr.MuxedAccount.keyTypeMuxedEd25519(
    new StellarSdk.xdr.MuxedAccountMed25519({
      id: StellarSdk.xdr.Uint64.fromString("0"),
      ed25519: Buffer.alloc(32),
    }),
  );
  const signer = StellarSdk.xdr.SignerKey.signerKeyTypeEd25519SignedPayload(
    new StellarSdk.xdr.SignerKeyEd25519SignedPayload({
      ed25519: Buffer.alloc(32),
      payload: Buffer.alloc(64),
    }),
  );
  const wire = tx.toEnvelope().v1();
  const transaction = wire.tx();
  transaction.sourceAccount(source);
  transaction.memo(StellarSdk.xdr.Memo.memoHash(Buffer.alloc(32)));
  transaction.cond(
    StellarSdk.xdr.Preconditions.precondV2(
      new StellarSdk.xdr.PreconditionsV2({
        timeBounds: new StellarSdk.xdr.TimeBounds({
          minTime: StellarSdk.xdr.Uint64.fromString("0"),
          maxTime: StellarSdk.xdr.Uint64.fromString("0"),
        }),
        ledgerBounds: new StellarSdk.xdr.LedgerBounds({
          minLedger: 0,
          maxLedger: 0,
        }),
        minSeqNum: StellarSdk.xdr.Int64.fromString("0"),
        minSeqAge: StellarSdk.xdr.Uint64.fromString("0"),
        minSeqLedgerGap: 0,
        extraSigners: [signer, signer],
      }),
    ),
  );
  transaction.operations()[0].sourceAccount(source);
  const sizingData = StellarSdk.xdr.SorobanTransactionData.fromXDR(
    data.toXDR(),
  );
  sizingData.ext(
    new StellarSdk.xdr.SorobanTransactionDataExt(
      1,
      new StellarSdk.xdr.SorobanResourcesExtV0({ archivedSorobanEntries: [] }),
    ),
  );
  transaction.ext(new StellarSdk.xdr.TransactionExt(1, sizingData));
  wire.signatures(
    Array.from(
      { length: 20 },
      () =>
        new StellarSdk.xdr.DecoratedSignature({
          hint: Buffer.alloc(4),
          signature: Buffer.alloc(64),
        }),
    ),
  );
  const size = BigInt(wire.toXDR().length);
  return size + 500n > (size * 11n) / 10n ? size + 500n : (size * 11n) / 10n;
}

/** RPC prices rent using archived entry sizes and the current ledger/network config. */
async function estimateMaintenanceFee(
  network: Network,
  options: FeeEstimateOptions,
): Promise<FeeEstimate> {
  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);
  const operationType = options.operationType;
  let tx: StellarSdk.Transaction;
  if (options.xdr) {
    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      options.xdr,
      networkPassphrase,
    );
    tx =
      parsed instanceof StellarSdk.FeeBumpTransaction
        ? parsed.innerTransaction
        : parsed;
  } else {
    if (!options.footprint)
      throw new Error(
        "Restoration and extension estimates require xdr or footprint",
      );
    const data = new StellarSdk.SorobanDataBuilder().setFootprint(
      options.footprint.readOnly.map((k) =>
        StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
      ),
      options.footprint.readWrite.map((k) =>
        StellarSdk.xdr.LedgerKey.fromXDR(k, "base64"),
      ),
    );
    if (operationType === "extend" && options.extendTo === undefined)
      throw new Error("Extension estimates require extendTo");
    tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(
        StellarSdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32)),
        "0",
      ),
      {
        fee: StellarSdk.BASE_FEE,
        networkPassphrase,
      },
    )
      .setSorobanData(data.build())
      .addOperation(
        operationType === "restore"
          ? StellarSdk.Operation.restoreFootprint({})
          : StellarSdk.Operation.extendFootprintTtl({
              extendTo: options.extendTo ?? 0,
            }),
      )
      .setTimeout(30)
      .build();
  }
  const expectedType =
    operationType === "restore" ? "restoreFootprint" : "extendFootprintTtl";
  if (tx.operations.length !== 1 || tx.operations[0].type !== expectedType) {
    throw new Error(`Expected exactly one ${expectedType} operation`);
  }
  const response = await server.simulateTransaction(tx);
  if (StellarSdk.rpc.Api.isSimulationError(response))
    throw new Error(sanitizeRpcError(response.error));
  if (getRestorePreamble(response))
    throw new Error(
      "Transaction requires restoration before estimating this operation",
    );
  const data = response.transactionData.build();
  const totalResourceFee = BigInt(response.minResourceFee);
  const resources = data.resources();
  const footprint = resources.footprint();
  const settingIds = [
    StellarSdk.xdr.ConfigSettingId.configSettingContractComputeV0(),
    StellarSdk.xdr.ConfigSettingId.configSettingContractLedgerCostV0(),
    StellarSdk.xdr.ConfigSettingId.configSettingContractLedgerCostExtV0(),
    StellarSdk.xdr.ConfigSettingId.configSettingContractHistoricalDataV0(),
    StellarSdk.xdr.ConfigSettingId.configSettingContractBandwidthV0(),
  ];
  const configuration = await server.getLedgerEntries(
    ...settingIds.map((configSettingId) =>
      StellarSdk.xdr.LedgerKey.configSetting(
        new StellarSdk.xdr.LedgerKeyConfigSetting({ configSettingId }),
      ),
    ),
  );
  const settings = new Map(
    configuration.entries.map((entry) => {
      const setting = entry.val.configSetting();
      return [setting.switch().name, setting] as const;
    }),
  );
  const required = (name: string): StellarSdk.xdr.ConfigSettingEntry => {
    const setting = settings.get(
      name as ReturnType<StellarSdk.xdr.ConfigSettingEntry["switch"]>["name"],
    );
    if (!setting) throw new Error(`Network fee setting unavailable: ${name}`);
    return setting;
  };
  const ledger = required(
    "configSettingContractLedgerCostV0",
  ).contractLedgerCost();
  const writeRate = BigInt(
    required("configSettingContractLedgerCostExtV0")
      .contractLedgerCostExt()
      .feeWrite1Kb()
      .toString(),
  );
  const writes = BigInt(footprint.readWrite().length);
  const writeFee =
    writes * BigInt(ledger.feeWriteLedgerEntry().toString()) +
    ceilFee(BigInt(resources.writeBytes()), writeRate);
  // Restoration reads archived entries from disk; extension uses live memory.
  const readFee =
    (operationType === "restore"
      ? writes * BigInt(ledger.feeDiskReadLedgerEntry().toString())
      : 0n) +
    ceilFee(
      BigInt(resources.diskReadBytes()),
      BigInt(ledger.feeDiskRead1Kb().toString()),
    );
  const cpuFee = ceilFee(
    BigInt(resources.instructions()),
    BigInt(
      required("configSettingContractComputeV0")
        .contractCompute()
        .feeRatePerInstructionsIncrement()
        .toString(),
    ),
    INSTRUCTION_INCREMENT,
  );
  const txBytes = maintenanceTransactionSize(tx, data);
  const overhead =
    ceilFee(
      txBytes + 300n,
      BigInt(
        required("configSettingContractHistoricalDataV0")
          .contractHistoricalData()
          .feeHistorical1Kb()
          .toString(),
      ),
    ) +
    ceilFee(
      txBytes,
      BigInt(
        required("configSettingContractBandwidthV0")
          .contractBandwidth()
          .feeTxSize1Kb()
          .toString(),
      ),
    );
  const nonRefundableFee = writeFee + readFee + cpuFee + overhead;
  if (totalResourceFee < nonRefundableFee)
    throw new Error(
      "RPC fee is inconsistent with current network fee settings",
    );
  const refundableFee = totalResourceFee - nonRefundableFee;
  const recommended = await fetchRecommendedInclusionFee(network);
  const baseFee = recommended < 100n ? 100n : recommended;
  const total = baseFee + totalResourceFee;
  return {
    baseFee: baseFee.toString(),
    resourceFee: totalResourceFee.toString(),
    totalFee: total.toString(),
    feeInXLM: `${total / STROOPS_PER_XLM}.${(total % STROOPS_PER_XLM).toString().padStart(7, "0")}`,
    operationType,
    breakdown: {
      baseFee: baseFee.toString(),
      writeFee: writeFee.toString(),
      refundableFee: refundableFee.toString(),
      otherResourceFee: (readFee + cpuFee + overhead).toString(),
    },
  };
}
