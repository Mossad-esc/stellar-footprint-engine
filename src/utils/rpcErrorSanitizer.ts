import { logger } from "./logger";

/**
 * Represents a sanitized RPC error with optional remediation advice.
 */
export interface SanitizedRpcError {
  /** User-facing error message */
  message: string;
  /** Actionable remediation advice for the user (optional) */
  remediation?: string;
  /** The specific resource that was exceeded, if detected */
  resourceExceeded?: "cpu_instructions" | "memory_bytes" | "footprint_entries";
}

/**
 * Maps known Stellar RPC error patterns to safe user-facing messages.
 * Strips stack traces, internal URLs, file paths, and provider-specific
 * identifiers before returning. Logs the raw error internally for debugging.
 */
export function sanitizeRpcError(raw: string): SanitizedRpcError {
  logger.debug({ rawError: raw }, "RPC simulation error (raw)");

  // Strip stack traces (lines starting with "at " or "Error:")
  let sanitized = raw
    .replace(/\n\s+at\s+.+/g, "")
    .replace(/^Error:\s*/i, "")
    .trim();

  // Strip file paths (Unix and Windows)
  sanitized = sanitized.replace(/(?:\/[\w.\-/]+|[A-Za-z]:\\[\w.\-\\]+)/g, "");

  // Strip internal URLs (http/https with hostnames)
  sanitized = sanitized.replace(/https?:\/\/[^\s"')]+/g, "");

  // Strip provider-specific identifiers (e.g. API keys in path segments)
  sanitized = sanitized.replace(/\/v\d+\/[A-Za-z0-9_-]{20,}/g, "");

  sanitized = sanitized.trim();

  // Check for RESOURCE_LIMIT_EXCEEDED errors first (more specific)
  const resourceLimitResult = parseResourceLimitExceeded(sanitized);
  if (resourceLimitResult) {
    return resourceLimitResult;
  }

  // Known pattern mappings (order matters - more specific first)
  if (/contract.*not.*found|no such contract/i.test(sanitized)) {
    return { message: "Contract not found on the specified network." };
  }
  if (/invalid xdr|failed to decode/i.test(sanitized)) {
    return { message: "Invalid transaction XDR provided." };
  }
  if (/insufficient.*balance|account.*not.*found/i.test(sanitized)) {
    return { message: "Source account not found or has insufficient balance." };
  }
  if (/exceeded.*instructions|cpu.*limit/i.test(sanitized)) {
    return {
      message: "Transaction exceeded CPU instruction limit.",
      remediation: "Consider splitting the operation into multiple transactions or optimizing loops.",
      resourceExceeded: "cpu_instructions",
    };
  }
  if (/exceeded.*memory|memory.*limit/i.test(sanitized)) {
    return {
      message: "Transaction exceeded memory limit.",
      remediation: "Reduce the contract's memory footprint by minimizing data structures or splitting operations.",
      resourceExceeded: "memory_bytes",
    };
  }
  if (/host.*error|wasm.*trap/i.test(sanitized)) {
    return { message: "Contract execution failed during simulation." };
  }
  if (/network.*timeout|connection.*refused|econnrefused/i.test(sanitized)) {
    return { message: "RPC network error. Please try again." };
  }

  return {
    message: sanitized || "An unexpected RPC error occurred.",
  };
}

/**
 * Parses RESOURCE_LIMIT_EXCEEDED and related resource exhaustion errors.
 * Returns a SanitizedRpcError with specific resource info and remediation advice.
 */
function parseResourceLimitExceeded(error: string): SanitizedRpcError | null {
  // Common patterns for resource limit exceeded errors from Stellar RPC
  const patterns = [
    // Pattern: "Resource limit exceeded: cpu_instructions > 100000000"
    /resource\s+limit\s+exceeded:\s*(cpu_instructions|memory_bytes|footprint_entries)\s*[><=]/i,
    // Pattern: "RESOURCE_LIMIT_EXCEEDED: cpu_instructions limit exceeded"
    /resource_limit_exceeded[:\s]+(cpu_instructions|memory_bytes|footprint_entries)/i,
    // Pattern: "cpu_instructions limit of 100000000 exceeded"
    /(cpu_instructions|memory_bytes|footprint_entries)\s+limit\s+of\s+\d+\s+exceeded/i,
    // Pattern: "exceeded cpu_instructions limit"
    /exceeded\s+(cpu_instructions|memory_bytes|footprint_entries)\s+limit/i,
  ];

  for (const pattern of patterns) {
    const match = error.match(pattern);
    if (match) {
      const resource = match[1].toLowerCase() as
        | "cpu_instructions"
        | "memory_bytes"
        | "footprint_entries";

      switch (resource) {
        case "cpu_instructions":
          return {
            message: "Transaction exceeded CPU instruction limit.",
            remediation:
              "Consider splitting the operation into multiple transactions or optimizing loops.",
            resourceExceeded: "cpu_instructions",
          };
        case "memory_bytes":
          return {
            message: "Transaction exceeded memory limit.",
            remediation:
              "Reduce the contract's memory footprint by minimizing data structures or splitting operations.",
            resourceExceeded: "memory_bytes",
          };
        case "footprint_entries":
          return {
            message: "Transaction exceeded footprint entry limit.",
            remediation:
              "Reduce the number of ledger keys accessed in a single transaction or split into multiple transactions.",
            resourceExceeded: "footprint_entries",
          };
      }
    }
  }

  return null;
}