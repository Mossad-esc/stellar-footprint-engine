import { logger } from "./logger";

const DEFAULT_FALLBACK_ERROR = "An unexpected RPC error occurred.";

/**
 * Extracts a string message from diverse RPC error shapes (strings, JSON-RPC
 * envelopes, Axios/network errors, Error instances, or malformed objects).
 */
function extractErrorMessage(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") {
          return extractErrorMessage(parsed);
        }
      } catch {
        // Not valid JSON; treat as plain string
      }
    }
    return raw;
  }

  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;

    // Standard JSON-RPC error envelope: { error: { code, message } }
    if (obj.error && typeof obj.error === "object") {
      const nested = extractErrorMessage(obj.error);
      if (nested) return nested;
    }
    if (typeof obj.error === "string" && obj.error.trim()) {
      return obj.error;
    }

    // Axios response payload: { response: { data, statusText } }
    if (obj.response && typeof obj.response === "object") {
      const resp = obj.response as Record<string, unknown>;
      if (resp.data !== undefined) {
        const fromData = extractErrorMessage(resp.data);
        if (fromData) return fromData;
      }
      if (typeof resp.statusText === "string" && resp.statusText.trim()) {
        return resp.statusText;
      }
    }

    if (typeof obj.message === "string" && obj.message.trim()) {
      return typeof obj.code === "string" && obj.code.trim()
        ? `${obj.code}: ${obj.message}`
        : obj.message;
    }

    if (typeof obj.code === "string" && obj.code.trim()) {
      return obj.code;
    }
  }

  return "";
}

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
export function sanitizeRpcError(raw: unknown): string {
  logger.debug({ rawError: raw }, "RPC simulation error (raw)");

  const rawText = extractErrorMessage(raw);
  if (!rawText) {
    return DEFAULT_FALLBACK_ERROR;
  }

  // Detect raw HTML error pages (e.g., Cloudflare 500/502/504 proxy responses)
  if (/<(!doctype|html|head|body)\b/i.test(rawText)) {
    return "RPC service returned an unexpected error. Please try again.";
  }

  // Strip stack traces (lines starting with "at " or "Error:")
  let sanitized = rawText
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
  if (/host.*error|host.*panic|panicked|wasm.*trap/i.test(sanitized)) {
    return "Contract execution failed during simulation.";
  }
  if (
    /network.*timeout|connection.*refused|econnrefused|etimedout|econnreset|enotfound|timeout.*exceeded/i.test(
      sanitized,
    )
  ) {
    return "RPC network error. Please try again.";
  }

  return sanitized || DEFAULT_FALLBACK_ERROR;
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