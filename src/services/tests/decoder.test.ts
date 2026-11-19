import * as StellarSdk from "@stellar/stellar-sdk";

import {
  SOROBAN_INVOKE_XDR,
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  INVALID_BASE64_XDR,
  INVALID_XDR_BYTES,
} from "../../tests/fixtures/xdr";
import { decodeXdr, XdrType } from "../decoder";

// ── Test Fixtures ────────────────────────────────────────────────────────────

/**
 * A valid Operation XDR (InvokeHostFunction operation extracted from SOROBAN_INVOKE_XDR).
 */
const VALID_OPERATION_XDR =
  "AAAAAAAAABgAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABWhlbGxvAAAAAAAAAQAAAAEAAAAA";

/**
 * A valid LedgerKey XDR (Account ledger key for the source account of SOROBAN_INVOKE_XDR).
 */
const VALID_LEDGER_KEY_XDR =
  "AAAAAAAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1Q==";

/**
 * A valid LedgerKey XDR for a contract data entry.
 * This represents a more complex ledger key with nested structures.
 */
const CONTRACT_DATA_LEDGER_KEY_XDR =
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAAA4AAAAFaGVsbG8AAAAAAAAB";

// ── Tests ────────────────────────────────────────────────────────────────────

describe("decodeXdr", () => {
  // ── Transaction Type ───────────────────────────────────────────────────────

  describe("transaction type", () => {
    it("decodes a valid Soroban transaction XDR", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "transaction");

      expect(result.success).toBe(true);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify transaction structure
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("_fee");
      expect(decoded).toHaveProperty("_operations");
      expect(decoded).toHaveProperty("_source");
      expect(decoded).toHaveProperty("sequence");
    });

    it("decodes a valid classic payment transaction XDR", () => {
      const result = decodeXdr(CLASSIC_PAYMENT_XDR, "transaction");

      expect(result.success).toBe(true);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeDefined();

      // Verify it's a payment transaction
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("_operations");
      const operations = decoded._operations as Array<Record<string, unknown>>;
      expect(operations).toHaveLength(1);
      expect(operations[0]).toHaveProperty("type");
      expect(operations[0].type).toBe("payment");
    });

    it("decodes a valid fee-bump transaction XDR", () => {
      const result = decodeXdr(FEE_BUMP_XDR, "transaction");

      expect(result.success).toBe(true);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeDefined();

      // Verify fee-bump structure
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("_fee");
      expect(decoded).toHaveProperty("_feeSource");
      expect(decoded).toHaveProperty("_innerTransaction");
    });

    it("returns error for invalid base64 transaction XDR", () => {
      const result = decodeXdr(INVALID_BASE64_XDR, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid");
    });

    it("returns error for invalid XDR bytes as transaction", () => {
      const result = decodeXdr(INVALID_XDR_BYTES, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when operation XDR is passed as transaction", () => {
      const result = decodeXdr(VALID_OPERATION_XDR, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when ledger key XDR is passed as transaction", () => {
      const result = decodeXdr(VALID_LEDGER_KEY_XDR, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // ── Operation Type ─────────────────────────────────────────────────────────

  describe("operation type", () => {
    it("decodes a valid operation XDR", () => {
      const result = decodeXdr(VALID_OPERATION_XDR, "operation");

      expect(result.success).toBe(true);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify operation structure
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("type");
    });

    it("decodes an InvokeHostFunction operation from transaction", () => {
      // Extract operation from a Soroban transaction
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        SOROBAN_INVOKE_XDR,
        StellarSdk.Networks.TESTNET,
      );
      const envelope = tx.toEnvelope();
      if (envelope.type !== "envelopeTypeTx")
        throw new Error("Expected a v1 envelope");
      const opXdr = envelope.v1.tx.operations[0].toXDR("base64");

      const result = decodeXdr(opXdr, "operation");

      expect(result.success).toBe(true);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeDefined();

      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded.type).toBe("invokeHostFunction");
    });

    it("decodes a Payment operation from transaction", () => {
      // Extract operation from a payment transaction
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        CLASSIC_PAYMENT_XDR,
        StellarSdk.Networks.TESTNET,
      );
      const envelope = tx.toEnvelope();
      if (envelope.type !== "envelopeTypeTx")
        throw new Error("Expected a v1 envelope");
      const opXdr = envelope.v1.tx.operations[0].toXDR("base64");

      const result = decodeXdr(opXdr, "operation");

      expect(result.success).toBe(true);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeDefined();

      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded.type).toBe("payment");
    });

    it("returns error for invalid base64 operation XDR", () => {
      const result = decodeXdr(INVALID_BASE64_XDR, "operation");

      expect(result.success).toBe(false);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid");
    });

    it("returns error for invalid XDR bytes as operation", () => {
      const result = decodeXdr(INVALID_XDR_BYTES, "operation");

      expect(result.success).toBe(false);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when transaction XDR is passed as operation", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "operation");

      expect(result.success).toBe(false);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when ledger key XDR is passed as operation", () => {
      const result = decodeXdr(VALID_LEDGER_KEY_XDR, "operation");

      expect(result.success).toBe(false);
      expect(result.type).toBe("operation");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // ── Ledger Key Type ────────────────────────────────────────────────────────

  describe("ledger_key type", () => {
    it("decodes a valid account ledger key XDR", () => {
      const result = decodeXdr(VALID_LEDGER_KEY_XDR, "ledger_key");

      expect(result.success).toBe(true);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeDefined();
      expect(result.error).toBeUndefined();

      // Verify ledger key structure
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("type");
    });

    it("decodes a contract data ledger key XDR", () => {
      const result = decodeXdr(CONTRACT_DATA_LEDGER_KEY_XDR, "ledger_key");

      expect(result.success).toBe(true);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeDefined();

      // Verify contract data structure
      const decoded = result.decoded as Record<string, unknown>;
      expect(decoded).toHaveProperty("type");
      expect(decoded.type).toBe("contractData");
    });

    it("serializes nested XDR objects to base64 in ledger key", () => {
      const result = decodeXdr(CONTRACT_DATA_LEDGER_KEY_XDR, "ledger_key");

      expect(result.success).toBe(true);
      const decoded = result.decoded as Record<string, unknown>;

      // Verify that nested XDR objects are serialized
      expect(decoded).toHaveProperty("contract");
      expect(decoded).toHaveProperty("key");

      // These should be base64 strings (XDR serialized)
      if (typeof decoded.contract === "string") {
        expect(decoded.contract).toMatch(/^[A-Za-z0-9+/=]+$/);
      }
      if (typeof decoded.key === "string") {
        expect(decoded.key).toMatch(/^[A-Za-z0-9+/=]+$/);
      }
    });

    it("returns error for invalid base64 ledger key XDR", () => {
      const result = decodeXdr(INVALID_BASE64_XDR, "ledger_key");

      expect(result.success).toBe(false);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Invalid");
    });

    it("returns error for invalid XDR bytes as ledger key", () => {
      const result = decodeXdr(INVALID_XDR_BYTES, "ledger_key");

      expect(result.success).toBe(false);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when transaction XDR is passed as ledger key", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "ledger_key");

      expect(result.success).toBe(false);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error when operation XDR is passed as ledger key", () => {
      const result = decodeXdr(VALID_OPERATION_XDR, "ledger_key");

      expect(result.success).toBe(false);
      expect(result.type).toBe("ledger_key");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // ── Unknown Type ───────────────────────────────────────────────────────────

  describe("unknown type", () => {
    it("returns error for unsupported type", () => {
      const result = decodeXdr(
        SOROBAN_INVOKE_XDR,
        "unsupported_type" as XdrType,
      );

      expect(result.success).toBe(false);
      expect(result.type).toBe("unsupported_type");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Unsupported type");
      expect(result.error).toContain("transaction, operation, ledger_key");
    });

    it("returns error for empty string type", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "" as XdrType);

      expect(result.success).toBe(false);
      expect(result.type).toBe("");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
      expect(result.error).toContain("Unsupported type");
    });

    it("returns error for null-like type", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, null as unknown as XdrType);

      expect(result.success).toBe(false);
      expect(result.type).toBe(null);
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for numeric type", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, 123 as unknown as XdrType);

      expect(result.success).toBe(false);
      expect(result.type).toBe(123);
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // ── Invalid Base64 Input ───────────────────────────────────────────────────

  describe("invalid base64 input", () => {
    it("returns error with success: false for invalid base64", () => {
      const result = decodeXdr(INVALID_BASE64_XDR, "transaction");

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(typeof result.error).toBe("string");
    });

    it("returns error for empty string XDR", () => {
      const result = decodeXdr("", "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for whitespace-only XDR", () => {
      const result = decodeXdr("   ", "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for XDR with special characters", () => {
      const result = decodeXdr("ABC!@#$%^&*()", "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for XDR with newlines", () => {
      const result = decodeXdr("AAAA\nAAAA\nAAAA", "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for truncated base64 XDR", () => {
      const truncated = SOROBAN_INVOKE_XDR.slice(0, 20);
      const result = decodeXdr(truncated, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });

    it("returns error for corrupted base64 XDR", () => {
      const corrupted = SOROBAN_INVOKE_XDR.slice(0, -10) + "CORRUPTED==";
      const result = decodeXdr(corrupted, "transaction");

      expect(result.success).toBe(false);
      expect(result.type).toBe("transaction");
      expect(result.decoded).toBeUndefined();
      expect(result.error).toBeDefined();
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("handles very long valid XDR strings", () => {
      // Use a fee-bump transaction which is longer
      const result = decodeXdr(FEE_BUMP_XDR, "transaction");

      expect(result.success).toBe(true);
      expect(result.decoded).toBeDefined();
    });

    it("preserves type in result for all cases", () => {
      const types: XdrType[] = ["transaction", "operation", "ledger_key"];

      types.forEach((type) => {
        const result = decodeXdr(INVALID_BASE64_XDR, type);
        expect(result.type).toBe(type);
      });
    });

    it("never returns both decoded and error", () => {
      const testCases = [
        { xdr: SOROBAN_INVOKE_XDR, type: "transaction" as XdrType },
        { xdr: VALID_OPERATION_XDR, type: "operation" as XdrType },
        { xdr: VALID_LEDGER_KEY_XDR, type: "ledger_key" as XdrType },
        { xdr: INVALID_BASE64_XDR, type: "transaction" as XdrType },
        { xdr: INVALID_XDR_BYTES, type: "operation" as XdrType },
      ];

      testCases.forEach(({ xdr, type }) => {
        const result = decodeXdr(xdr, type);

        if (result.success) {
          expect(result.decoded).toBeDefined();
          expect(result.error).toBeUndefined();
        } else {
          expect(result.decoded).toBeUndefined();
          expect(result.error).toBeDefined();
        }
      });
    });

    it("returns consistent error format", () => {
      const invalidCases = [
        { xdr: INVALID_BASE64_XDR, type: "transaction" as XdrType },
        { xdr: INVALID_XDR_BYTES, type: "operation" as XdrType },
        { xdr: "", type: "ledger_key" as XdrType },
      ];

      invalidCases.forEach(({ xdr, type }) => {
        const result = decodeXdr(xdr, type);

        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
        expect(typeof result.error).toBe("string");
        expect(result.error!.length).toBeGreaterThan(0);
      });
    });
  });

  // ── Type Safety ────────────────────────────────────────────────────────────

  describe("type safety", () => {
    it("returns DecodeResult with correct structure for success", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "transaction");

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("type");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.type).toBe("string");

      if (result.success) {
        expect(result).toHaveProperty("decoded");
        expect(result).not.toHaveProperty("error");
      }
    });

    it("returns DecodeResult with correct structure for failure", () => {
      const result = decodeXdr(INVALID_BASE64_XDR, "transaction");

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("type");
      expect(result).toHaveProperty("error");
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.type).toBe("string");
      expect(typeof result.error).toBe("string");

      if (!result.success) {
        expect(result).not.toHaveProperty("decoded");
      }
    });

    it("decoded field contains serializable JSON", () => {
      const result = decodeXdr(SOROBAN_INVOKE_XDR, "transaction");

      expect(result.success).toBe(true);
      expect(result.decoded).toBeDefined();

      // Should be able to stringify and parse
      expect(() => JSON.stringify(result.decoded)).not.toThrow();
      const stringified = JSON.stringify(result.decoded);
      expect(() => JSON.parse(stringified)).not.toThrow();
    });
  });
});
