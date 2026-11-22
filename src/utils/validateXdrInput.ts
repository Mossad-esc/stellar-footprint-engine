export interface XdrValidationResult {
  valid: boolean;
  error?: string;
}

const STRICT_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_XDR_BYTES = 100 * 1024;

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
  return { valid: true };
}
