import * as StellarSdk from "@stellar/stellar-sdk";

import { parseFootprintEntries } from "./footprintParser";

/**
 * A footprint input for comparison
 */
export interface FootprintInput {
  readOnly: string[];
  readWrite: string[];
}

/**
 * Result of comparing two footprints
 */
export interface FootprintDiffResult {
  /** Entries added in the 'after' footprint */
  added: {
    readOnly: string[];
    readWrite: string[];
  };
  /** Entries removed in the 'after' footprint (present in 'before' but not in 'after') */
  removed: {
    readOnly: string[];
    readWrite: string[];
  };
  /** Entries unchanged between before and after */
  unchanged: {
    readOnly: string[];
    readWrite: string[];
  };
}

/**
 * Compare two footprint objects and return added, removed, and unchanged ledger keys.
 * @param before - The before footprint (XDR strings)
 * @param after - The after footprint (XDR strings)
 * @returns Object containing added, removed, and unchanged XDR strings
 */
export function footprintDiff(
  before: FootprintInput,
  after: FootprintInput,
): FootprintDiffResult {
  const beforeReadOnly = before.readOnly ?? [];
  const beforeReadWrite = before.readWrite ?? [];
  const afterReadOnly = after.readOnly ?? [];
  const afterReadWrite = after.readWrite ?? [];

  const beforeReadOnlySet = new Set(beforeReadOnly);
  const beforeReadWriteSet = new Set(beforeReadWrite);
  const afterReadOnlySet = new Set(afterReadOnly);
  const afterReadWriteSet = new Set(afterReadWrite);

  // Added entries (in after but not in before)
  const addedReadOnly = afterReadOnly.filter(
    (xdr) => !beforeReadOnlySet.has(xdr),
  );
  const addedReadWrite = afterReadWrite.filter(
    (xdr) => !beforeReadWriteSet.has(xdr),
  );

  // Removed entries (in before but not in after)
  const removedReadOnly = beforeReadOnly.filter(
    (xdr) => !afterReadOnlySet.has(xdr),
  );
  const removedReadWrite = beforeReadWrite.filter(
    (xdr) => !afterReadWriteSet.has(xdr),
  );

  // Unchanged entries (present in both)
  const unchangedReadOnly = beforeReadOnly.filter((xdr) =>
    afterReadOnlySet.has(xdr),
  );
  const unchangedReadWrite = beforeReadWrite.filter((xdr) =>
    afterReadWriteSet.has(xdr),
  );

  return {
    added: { readOnly: addedReadOnly, readWrite: addedReadWrite },
    removed: { readOnly: removedReadOnly, readWrite: removedReadWrite },
    unchanged: { readOnly: unchangedReadOnly, readWrite: unchangedReadWrite },
  };
}
/** Render access changes as modifications without altering the JSON diff. */
export function formatDiffAsMarkdown(diff: FootprintDiffResult): string {
  const rows: string[] = [];
  const modified: string[] = [];
  const removed = {
    readOnly: new Set(diff.removed.readOnly),
    readWrite: new Set(diff.removed.readWrite),
  };
  const sorted = (keys: string[]): string[] =>
    [...new Set(keys)].sort((a, b) =>
      Buffer.compare(Buffer.from(a, "base64"), Buffer.from(b, "base64")),
    );
  const row = (change: string, key: string, mode: string): string => {
    const entry = parseFootprintEntries([key])[0];
    const id =
      entry.type === "ContractData" && entry.contractId
        ? StellarSdk.StrKey.encodeContract(Buffer.from(entry.contractId, "hex"))
        : (entry.accountId ?? entry.contractId ?? "—");
    return `| ${change} | ${entry.type} | ${id} | ${mode} |`;
  };
  for (const [mode, other, label, previous] of [
    ["readOnly", "readWrite", "RO", "RW"],
    ["readWrite", "readOnly", "RW", "RO"],
  ] as const) {
    for (const key of sorted(diff.added[mode])) {
      if (removed[other].delete(key))
        modified.push(row("modified", key, `${previous} → ${label}`));
      else rows.push(row("+", key, label));
    }
  }
  for (const [mode, label] of [
    ["readOnly", "RO"],
    ["readWrite", "RW"],
  ] as const) {
    for (const key of sorted([...removed[mode]]))
      rows.push(row("-", key, label));
  }
  rows.push(...modified);
  return [
    "| Change Type | Entry Type | Contract ID / Account | Access Mode |",
    "| --- | --- | --- | --- |",
    ...rows,
    ...(rows.length === 0 ? ["", "No footprint changes."] : []),
    "",
  ].join("\n");
}
