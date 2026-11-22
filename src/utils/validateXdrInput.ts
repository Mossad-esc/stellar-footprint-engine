import { ErrorCode } from "../constants";

export interface XdrValidationResult {
  valid: boolean;
  error?: string;
  code?: ErrorCode;
}

const STRICT_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_XDR_BYTES = 100 * 1024;

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
