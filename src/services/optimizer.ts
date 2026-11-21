import { logger } from "../utils/logger";
import type { FootprintEntry } from "./footprintParser";

/**
 * Per-entry byte cost approximation for fee-savings calculation.
 * Each ledger key read-only slot costs ~100 stroops; we use 100 as a
 * conservative estimate when the actual fee schedule is not available.
 */
const BYTES_PER_ENTRY_ESTIMATE = 100;

/**
 * Result of footprint optimization
 */
export interface FootprintStats {
  originalReadOnlyCount: number;
  optimizedReadOnlyCount: number;
  removedCount: number;
  /** Number of readOnly keys pruned because they were covered by readWrite. */
  prunedCount: number;
  /** Estimated byte-fee savings from pruning redundant readOnly entries. */
  estimatedByteFeeSavings: number;
}

export interface OptimizationResult {
  readOnly: FootprintEntry[];
  readWrite: FootprintEntry[];
  optimized: boolean;
  rawFootprint: {
    readOnly: FootprintEntry[];
    readWrite: FootprintEntry[];
  };
  stats: FootprintStats;
}

/**
 * Canonicalise a footprint entry key to a stable base64 string for set
 * membership checks.  The `.xdr` field already stores the raw base64 that
 * came off the wire, so we normalise padding and use that directly rather
 * than introducing a lossy hash.
 */
function toCanonicalBase64(xdr: string): string {
  // Strip any trailing whitespace then re-pad to a multiple of 4 so that
  // two strings representing the same bytes compare equal.
  const stripped = xdr.trim().replace(/=+$/, "");
  const padded = stripped + "=".repeat((4 - (stripped.length % 4)) % 4);
  return padded;
}

/**
 * Optimize footprint by removing read-only entries that are already in read-write.
 * Entries in readWrite imply read access, so redundant readOnly entries can be
 * removed without any data loss.
 *
 * @param readOnly  - Array of read-only footprint entries
 * @param readWrite - Array of read-write footprint entries
 * @returns Optimized footprint with redundant entries removed and full stats
 */
export function optimizeFootprint(
  readOnly: FootprintEntry[],
  readWrite: FootprintEntry[],
): OptimizationResult {
  // Build a canonical set of all base64 keys that appear in readWrite.
  const readWriteKeys = new Set(readWrite.map((e) => toCanonicalBase64(e.xdr)));

  // Filter out readOnly entries whose canonical key is covered by readWrite.
  const optimizedReadOnly = readOnly.filter(
    (entry) => !readWriteKeys.has(toCanonicalBase64(entry.xdr)),
  );

  const prunedCount = readOnly.length - optimizedReadOnly.length;
  const removedCount = prunedCount;
  const optimized = prunedCount > 0;

  // Estimate byte-fee savings: each pruned entry saves approximately
  // BYTES_PER_ENTRY_ESTIMATE bytes worth of fees.
  const estimatedByteFeeSavings = prunedCount * BYTES_PER_ENTRY_ESTIMATE;

  const stats: FootprintStats = {
    originalReadOnlyCount: readOnly.length,
    optimizedReadOnlyCount: optimizedReadOnly.length,
    removedCount,
    prunedCount,
    estimatedByteFeeSavings,
  };

  if (optimized) {
    logger.info(
      {
        originalReadOnlyCount: stats.originalReadOnlyCount,
        optimizedReadOnlyCount: stats.optimizedReadOnlyCount,
        prunedCount: stats.prunedCount,
        estimatedByteFeeSavings: stats.estimatedByteFeeSavings,
      },
      "footprint optimizer: pruned redundant readOnly keys covered by readWrite",
    );
  }

  return {
    readOnly: optimizedReadOnly,
    readWrite,
    optimized,
    rawFootprint: {
      readOnly,
      readWrite,
    },
    stats,
  };
}
