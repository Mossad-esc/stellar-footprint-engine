import * as StellarSdk from "@stellar/stellar-sdk";

export type XdrType = "transaction" | "operation" | "ledger_key" | "auth_entry";

export interface DecodeResult {
  success: boolean;
  type: XdrType;
  decoded?: unknown;
  error?: string;
}

function normalizeXdrValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  if (Buffer.isBuffer(value)) {
    return value.toString("base64");
  }

  if (typeof value === "object" && value !== null) {
    if (
      "_attributes" in value &&
      typeof (value as { _attributes?: unknown })._attributes === "object"
    ) {
      const attributes = (value as { _attributes: Record<string, unknown> })
        ._attributes;
      return Object.fromEntries(
        Object.entries(attributes).map(([key, nestedValue]) => [
          key,
          normalizeXdrValue(nestedValue),
        ]),
      );
    }

    if ("_value" in value) {
      return normalizeXdrValue((value as { _value: unknown })._value);
    }
  }

  // XDR objects that can serialize themselves to base64
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { toXDR?: unknown }).toXDR === "function"
  ) {
    return (value as { toXDR: (fmt: string) => string }).toXDR("base64");
  }

  // Stellar SDK enum-like values expose a readable name
  if (
    typeof value === "object" &&
    value !== null &&
    "name" in value &&
    typeof (value as { name?: unknown }).name === "string"
  ) {
    return (value as { name: string }).name;
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeXdrValue(item));
  }

  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([key, nestedValue]) => [key, normalizeXdrValue(nestedValue)],
      ),
    );
  }

  return value;
}

/**
 * Serialize an XDR LedgerKey to a plain object by inspecting its arm/value.
 */
function ledgerKeyToJson(key: StellarSdk.xdr.LedgerKey): unknown {
  return { type: key.type, ...(key.value.toJson() as Record<string, unknown>) };
}

/**
 * Decode a base64 XDR string into a human-readable JSON representation.
 * Supports transaction envelopes, individual operations, and ledger keys.
 */
export function decodeXdr(xdr: string, type: XdrType): DecodeResult {
  try {
    let decoded: unknown;

    switch (type) {
      case "transaction": {
        const tx = StellarSdk.TransactionBuilder.fromXDR(
          xdr,
          StellarSdk.Networks.TESTNET,
        );
        const raw = JSON.parse(JSON.stringify(tx)) as Record<string, unknown>;
        // Expose sequence as a top-level property for convenience
        if (raw._sequence !== undefined) {
          raw.sequence = raw._sequence;
        }
        decoded = raw;
        break;
      }

      case "operation": {
        // xdr.Operation.fromXDR returns the raw XDR object; Operation.fromXDRObject gives a plain JS op
        const opXdr = StellarSdk.xdr.Operation.fromXDR(xdr, "base64");
        const op = StellarSdk.Operation.fromXDRObject(opXdr);
        decoded = op;
        break;
      }

      case "ledger_key": {
        const key = StellarSdk.xdr.LedgerKey.fromXDR(xdr, "base64");
        decoded = ledgerKeyToJson(key);
        break;
      }

      case "auth_entry": {
        const entry = StellarSdk.xdr.SorobanAuthorizationEntry.fromXDR(
          xdr,
          "base64",
        );
        decoded = normalizeXdrValue(entry);
        break;
      }

      default:
        return {
          success: false,
          type,
          error: `Unsupported type. Supported types: transaction, operation, ledger_key, auth_entry`,
        };
    }

    return { success: true, type, decoded };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : "Invalid XDR format";
    // Normalize SDK error messages to always contain "Invalid" for consistency
    const message = raw.startsWith("Invalid") ? raw : `Invalid XDR: ${raw}`;
    return { success: false, type, error: message };
  }
}
