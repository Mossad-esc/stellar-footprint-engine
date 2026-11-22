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
    expect(result.stats).toEqual({
      originalReadOnlyCount: 2,
      optimizedReadOnlyCount: 1,
      removedCount: 1,
    });
  });

  it("sets optimized: true when entries are removed", () => {
    const result = optimizeFootprint([A, B], [B]);
    expect(result.optimized).toBe(true);
    expect(result.stats).toEqual({
      originalReadOnlyCount: 2,
      optimizedReadOnlyCount: 1,
      removedCount: 1,
    });
  });

  it("sets optimized: false when no entries are removed", () => {
    const result = optimizeFootprint([A], [B]);
    expect(result.optimized).toBe(false);
    expect(result.readOnly).toEqual([A]);
    expect(result.readWrite).toEqual([B]);
    expect(result.stats).toEqual({
      originalReadOnlyCount: 1,
      optimizedReadOnlyCount: 1,
      removedCount: 0,
    });
  });

  it("returns empty outputs for empty inputs", () => {
    const result = optimizeFootprint([], []);
    expect(result.readOnly).toEqual([]);
    expect(result.readWrite).toEqual([]);
    expect(result.optimized).toBe(false);
    expect(result.stats).toEqual({
      originalReadOnlyCount: 0,
      optimizedReadOnlyCount: 0,
      removedCount: 0,
    });
  });

  it("preserves rawFootprint with original entries", () => {
    const result = optimizeFootprint([A, B], [B]);
    expect(result.rawFootprint.readOnly).toEqual([A, B]);
    expect(result.rawFootprint.readWrite).toEqual([B]);
  });

  it("removes multiple overlapping entries while retaining distinct ones", () => {
    const result = optimizeFootprint([A, B, C], [A, C]);
    expect(result.readOnly).toEqual([B]);
    expect(result.readWrite).toEqual([A, C]);
    expect(result.optimized).toBe(true);
    expect(result.stats).toEqual({
      originalReadOnlyCount: 3,
      optimizedReadOnlyCount: 1,
      removedCount: 2,
    });
  });
});
