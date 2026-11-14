import { getRpcServer } from "../config/stellar";
import { Network } from "../config/stellar";

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

export interface FootprintFeeInput {
  readOnlyBytes?: number | bigint;
  readWriteBytes?: number | bigint;
  estimatedSizeBytes?: number | bigint;
}

export interface FeeEstimate {
  baseFee: string;
  resourceFee: string;
  totalFee: string;
  feeInXLM: string;
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
    footprintFee?: string;
  };
}

function calculateFootprintFee(
  footprintBytes?: number | bigint | FootprintFeeInput,
): bigint {
  if (footprintBytes === undefined) {
    return 0n;
  }

  const envelopeRate = DEFAULT_HISTORICAL_FEE_RATE + DEFAULT_METADATA_FEE_RATE;
  if (
    typeof footprintBytes === "number" ||
    typeof footprintBytes === "bigint"
  ) {
    const size = BigInt(footprintBytes);
    return size > 0n ? size * envelopeRate : 0n;
  }

  const readOnly = BigInt(footprintBytes.readOnlyBytes ?? 0);
  const readWrite = BigInt(footprintBytes.readWriteBytes ?? 0);
  const serialized = BigInt(
    footprintBytes.estimatedSizeBytes ?? readOnly + readWrite,
  );

  const keyBandwidthFee =
    (readOnly > 0n ? readOnly * DEFAULT_READ_FEE_PER_BYTE : 0n) +
    (readWrite > 0n ? readWrite * DEFAULT_WRITE_FEE_PER_BYTE : 0n);
  const txSizeFee = serialized > 0n ? serialized * envelopeRate : 0n;

  return keyBandwidthFee + txSizeFee;
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
 * Estimate the Soroban resource fee from CPU instructions and memory bytes.
 */
function estimateResourceFee(
  cpuInsns: bigint,
  memBytes: bigint,
  footprintBytes?: number | bigint | FootprintFeeInput,
): bigint {
  const cpuFee =
    ((cpuInsns + INSTRUCTION_INCREMENT - 1n) / INSTRUCTION_INCREMENT) *
    DEFAULT_FEE_RATE_PER_INSTRUCTION_INCREMENT;

  const memFee = memBytes * DEFAULT_WRITE_FEE_PER_BYTE;

  const overhead =
    TYPICAL_TX_OVERHEAD_BYTES *
    (DEFAULT_HISTORICAL_FEE_RATE + DEFAULT_METADATA_FEE_RATE);

  const readFee = memBytes * DEFAULT_READ_FEE_PER_BYTE;
  const footprintFee = calculateFootprintFee(footprintBytes);

  return cpuFee + memFee + readFee + overhead + footprintFee;
}

/**
 * Estimate the Soroban resource fee with detailed breakdown.
 */
function estimateResourceFeeDetailed(
  cpuInsns: bigint,
  memBytes: bigint,
  footprintBytes?: number | bigint | FootprintFeeInput,
): {
  total: bigint;
  cpuFee: bigint;
  memoryFee: bigint;
  readFee: bigint;
  overheadFee: bigint;
  footprintFee: bigint;
} {
  const cpuFee =
    ((cpuInsns + INSTRUCTION_INCREMENT - 1n) / INSTRUCTION_INCREMENT) *
    DEFAULT_FEE_RATE_PER_INSTRUCTION_INCREMENT;

  const memoryFee = memBytes * DEFAULT_WRITE_FEE_PER_BYTE;

  const overheadFee =
    TYPICAL_TX_OVERHEAD_BYTES *
    (DEFAULT_HISTORICAL_FEE_RATE + DEFAULT_METADATA_FEE_RATE);

  const readFee = memBytes * DEFAULT_READ_FEE_PER_BYTE;
  const footprintFee = calculateFootprintFee(footprintBytes);

  const total = cpuFee + memoryFee + readFee + overheadFee + footprintFee;

  return { total, cpuFee, memoryFee, readFee, overheadFee, footprintFee };
}

/**
 * Estimate fees for a Soroban transaction given simulation cost output.
 */
export async function estimateFee(
  cpuInsns: string,
  memBytes: string,
  network: Network = "testnet",
  footprintBytes?: number | bigint | FootprintFeeInput,
): Promise<FeeEstimate> {
  const cpu = BigInt(cpuInsns);
  const mem = BigInt(memBytes);

  const [baseFee, resourceFee] = await Promise.all([
    fetchRecommendedInclusionFee(network),
    Promise.resolve(estimateResourceFee(cpu, mem, footprintBytes)),
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
  footprintBytes?: number | bigint | FootprintFeeInput,
): Promise<DetailedFeeBreakdown> {
  const cpu = BigInt(cpuInsns);
  const mem = BigInt(memBytes);

  const [inclusionFee, resourceBreakdown] = await Promise.all([
    fetchRecommendedInclusionFee(network),
    Promise.resolve(estimateResourceFeeDetailed(cpu, mem, footprintBytes)),
  ]);

  const baseFee = inclusionFee; // Base fee is the inclusion fee
  const resourceFee = resourceBreakdown.total;
  const totalStroops = baseFee + resourceFee;

  // Convert to XLM
  const xlmWhole = totalStroops / STROOPS_PER_XLM;
  const xlmFrac = totalStroops % STROOPS_PER_XLM;
  const totalXlm = `${xlmWhole}.${xlmFrac.toString().padStart(7, "0")}`;

  const breakdown: DetailedFeeBreakdown["breakdown"] = {
    cpuFee: resourceBreakdown.cpuFee.toString(),
    memoryFee: resourceBreakdown.memoryFee.toString(),
    readFee: resourceBreakdown.readFee.toString(),
    overheadFee: resourceBreakdown.overheadFee.toString(),
  };

  if (footprintBytes !== undefined) {
    breakdown.footprintFee = resourceBreakdown.footprintFee.toString();
  }

  return {
    baseFee: baseFee.toString(),
    resourceFee: resourceFee.toString(),
    inclusionFee: inclusionFee.toString(),
    totalStroops: totalStroops.toString(),
    totalXlm,
    breakdown,
  };
}
