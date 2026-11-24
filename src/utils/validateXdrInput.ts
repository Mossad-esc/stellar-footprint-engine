import { ErrorCode } from "../constants";

export interface XdrValidationResult {
  valid: boolean;
  error?: string;
  code?: ErrorCode;
}

const STRICT_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_XDR_BYTES = 100 * 1024;

/** Maximum allowed recursion depth when decoding nested ScVal / LedgerKey structures. */
export const MAX_XDR_DEPTH = 32;
/** Maximum allowed total node count across a decoded XDR structure. */
export const MAX_XDR_NODES = 5000;

/**
 * Tracks recursion depth and total node count while walking a decoded XDR
 * structure.  Guards against stack-overflow / ReDoS style payloads that use
 * deeply nested or bloated recursive structures.
 */
export class XdrGuard {
  private nodes = 0;

  constructor(
    private readonly maxDepth: number = MAX_XDR_DEPTH,
    private readonly maxNodes: number = MAX_XDR_NODES,
  ) {}

  /** Register a node visit at the given depth; throws if a limit is exceeded. */
  enter(depth: number): void {
    if (depth > this.maxDepth) {
      throw new XdrLimitError(
        `XDR nesting too deep: maximum ${this.maxDepth} levels`,
      );
    }
    this.nodes += 1;
    if (this.nodes > this.maxNodes) {
      throw new XdrLimitError(
        `XDR structure too large: maximum ${this.maxNodes} nodes`,
      );
    }
  }

  get nodeCount(): number {
    return this.nodes;
  }
}

/** Raised when an XDR payload exceeds the depth or node-count limits. */
export class XdrLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XdrLimitError";
  }
}

/**
 * Recursively walks a decoded XDR value (plain objects/arrays as produced by
 * a decoder) enforcing depth and node-count limits.  Returns the number of
 * nodes visited.  Throws {@link XdrLimitError} on violation.
 */
export function enforceXdrLimits(
  value: unknown,
  guard: XdrGuard = new XdrGuard(),
  depth = 0,
): number {
  guard.enter(depth);
  if (value !== null && typeof value === "object") {
    const children = Array.isArray(value)
      ? value
      : Object.values(value as Record<string, unknown>);
    for (const child of children) {
      enforceXdrLimits(child, guard, depth + 1);
    }
  }
  return guard.nodeCount;
}

/**
 * The first four bytes of an XDR-encoded TransactionEnvelope encode the
 * envelope type as a big-endian int32.  TransactionEnvelopeV0 has type 0x00
 * while the modern envelopeTypeTx has type 0x02.
 *
 * We detect v0 by decoding the first three base64 characters (18 bits) which
 * give us enough to read the leading uint32 discriminant.
 *
 * Layout (big-endian int32):
 *   envelopeTypeTxV0  = 0  → first 4 bytes 00 00 00 00
 *   envelopeTypeTx    = 2  → first 4 bytes 00 00 00 02
 *
 * We only need to check for type == 0 to identify a v0 envelope.
 */
function isV0Envelope(xdr: string): boolean {
  try {
    const bytes = Buffer.from(xdr, "base64");
    if (bytes.length < 4) return false;
    const envelopeType = bytes.readInt32BE(0);
    return envelopeType === 0; // envelopeTypeTxV0
  } catch {
    return false;
  }
}

export function validateXdrInput(xdr: unknown): XdrValidationResult {
  if (!xdr || typeof xdr !== "string") {
    return { valid: false, error: "Missing required field: xdr" };
  }
  if (!STRICT_BASE64_RE.test(xdr)) {
    return { valid: false, error: "Invalid XDR: must be valid base64" };
  }
  if (xdr.length > MAX_XDR_BYTES) {
    return { valid: false, error: "XDR too large: maximum 100kb" };
  }

  // Inspect the decoded byte length before any parsing/decoding occurs.
  let decodedBytes: Buffer;
  try {
    decodedBytes = Buffer.from(xdr, "base64");
  } catch {
    return { valid: false, error: "Invalid XDR: must be valid base64" };
  }
  if (decodedBytes.length > MAX_XDR_BYTES) {
    return { valid: false, error: "XDR too large: maximum 100kb" };
  }

  // Reject legacy v0 envelopes with a clear, actionable message.
  if (isV0Envelope(xdr)) {
    return {
      valid: false,
      code: ErrorCode.UNSUPPORTED_ENVELOPE_TYPE,
      error:
        "Unsupported envelope type: TransactionEnvelopeV0 (type 0) is not supported. " +
        "Please upgrade your transaction to a v1 envelope (envelopeTypeTx) before submitting.",
    };
  }

  return { valid: true };
}

/**
 * Validates a decoded XDR structure against the recursion depth and node
 * count limits.  Intended to be called with the output of a recursive
 * ScVal / LedgerKey decoder before the structure is processed further.
 */
export function validateXdrStructure(
  decoded: unknown,
  guard: XdrGuard = new XdrGuard(),
): XdrValidationResult {
  try {
    enforceXdrLimits(decoded, guard);
    return { valid: true };
  } catch (err) {
    if (err instanceof XdrLimitError) {
      return {
        valid: false,
        code: ErrorCode.XDR_DEPTH_EXCEEDED,
        error: `Bad Request: ${err.message}`,
      };
    }
    throw err;
  }
}
