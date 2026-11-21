import type { FootprintEntry } from "../footprintParser";
import { optimizeFootprint } from "../optimizer";

const entry = (xdr: string): FootprintEntry => ({ xdr, type: "ContractData" });

// Use realistic-looking base64 strings so the canonical comparison is exercised.
const A = entry("AAAAAAAAAAA=");
const B = entry("AAAAAAAAAAB=");
const C = entry("AAAAAAAAAAC=");

// Same payload as B but with slightly different (but equivalent) padding
const B_EQUIV = entry("AAAAAAAAAAB");

describe("optimizeFootprint", () => {
  it("removes readOnly entries that are also in readWrite", () => {
    const result = optimizeFootprint([A, B], [B, C]);
    expect(result.readOnly).toEqual([A]);
    expect(result.readWrite).toEqual([B, C]);
  });

  it("sets optimized: true when entries are removed", () => {
    const result = optimizeFootprint([A, B], [B]);
    expect(result.optimized).toBe(true);
    expect(result.stats.removedCount).toBe(1);
  });

  it("sets optimized: false when no entries are removed", () => {
    const result = optimizeFootprint([A], [B]);
    expect(result.optimized).toBe(false);
    expect(result.stats.removedCount).toBe(0);
  });

  it("returns empty outputs for empty inputs", () => {
    const result = optimizeFootprint([], []);
    expect(result.readOnly).toEqual([]);
    expect(result.readWrite).toEqual([]);
    expect(result.optimized).toBe(false);
  });

  it("preserves rawFootprint with original entries", () => {
    const result = optimizeFootprint([A, B], [B]);
    expect(result.rawFootprint.readOnly).toEqual([A, B]);
    expect(result.rawFootprint.readWrite).toEqual([B]);
  });

  // --- Issue #22 additions ---

  it("tracks prunedCount equal to removedCount", () => {
    const result = optimizeFootprint([A, B, C], [B, C]);
    expect(result.stats.prunedCount).toBe(2);
    expect(result.stats.prunedCount).toBe(result.stats.removedCount);
  });

  it("sets prunedCount to 0 when no overlap", () => {
    const result = optimizeFootprint([A], [B, C]);
    expect(result.stats.prunedCount).toBe(0);
  });

  it("calculates estimatedByteFeeSavings proportional to prunedCount", () => {
    const result = optimizeFootprint([A, B, C], [A, B, C]);
    expect(result.stats.prunedCount).toBe(3);
    // savings must be a positive number proportional to pruned entries
    expect(result.stats.estimatedByteFeeSavings).toBeGreaterThan(0);
    expect(result.stats.estimatedByteFeeSavings).toBe(
      result.stats.prunedCount * 100, // BYTES_PER_ENTRY_ESTIMATE
    );
  });

  it("sets estimatedByteFeeSavings to 0 when nothing is pruned", () => {
    const result = optimizeFootprint([A], [B]);
    expect(result.stats.estimatedByteFeeSavings).toBe(0);
  });

  it("prunes overlapping keys without data loss in readWrite", () => {
    // readWrite must be untouched even when all readOnly keys overlap
    const result = optimizeFootprint([A, B], [A, B, C]);
    expect(result.readOnly).toEqual([]);
    expect(result.readWrite).toEqual([A, B, C]);
    expect(result.stats.prunedCount).toBe(2);
  });

  it("treats canonical base64 equivalents as the same key", () => {
    // B and B_EQUIV differ only in padding but represent the same bytes
    const result = optimizeFootprint([B_EQUIV], [B]);
    expect(result.readOnly).toEqual([]);
    expect(result.stats.prunedCount).toBe(1);
  });

  it("includes correct originalReadOnlyCount and optimizedReadOnlyCount", () => {
    const result = optimizeFootprint([A, B, C], [C]);
    expect(result.stats.originalReadOnlyCount).toBe(3);
    expect(result.stats.optimizedReadOnlyCount).toBe(2);
  });
});
