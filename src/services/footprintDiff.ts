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
