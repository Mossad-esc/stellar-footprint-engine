import { ErrorCode } from "../../constants";
import { validateXdrInput } from "../validateXdrInput";

const VALID_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

// A TransactionEnvelopeV0 starts with a big-endian int32 value of 0.
// We build a minimal fake v0 XDR: 4 bytes of 0x00 followed by padding.
const V0_XDR = Buffer.alloc(32).toString("base64"); // all zeros → envelopeType = 0

describe("validateXdrInput", () => {
  it("returns valid for a well-formed base64 XDR string", () => {
    expect(validateXdrInput(VALID_XDR)).toEqual({ valid: true });
  });

  it("returns error when xdr is missing (undefined)", () => {
    const result = validateXdrInput(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Missing required field: xdr/);
  });

  it("returns error when xdr is an empty string", () => {
    const result = validateXdrInput("");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Missing required field: xdr/);
  });

  it("returns error when xdr is not a string", () => {
    const result = validateXdrInput(42);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Missing required field: xdr/);
  });

  it("returns error when xdr contains non-base64 characters", () => {
    const result = validateXdrInput("not-valid-base64!!!");
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid XDR: must be valid base64/);
  });

  it("returns error when xdr exceeds 100kb", () => {
    const oversized = "A".repeat(100 * 1024 + 1);
    const result = validateXdrInput(oversized);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/XDR too large/);
  });

  // --- Issue #23: v0 envelope handling ---

  it("rejects a v0 envelope with UNSUPPORTED_ENVELOPE_TYPE code", () => {
    const result = validateXdrInput(V0_XDR);
    expect(result.valid).toBe(false);
    expect(result.code).toBe(ErrorCode.UNSUPPORTED_ENVELOPE_TYPE);
  });

  it("includes an actionable message telling the caller to upgrade to v1", () => {
    const result = validateXdrInput(V0_XDR);
    expect(result.error).toMatch(/TransactionEnvelopeV0/);
    expect(result.error).toMatch(/v1 envelope/i);
  });

  it("does not throw on v0 envelope input — returns a structured error instead", () => {
    expect(() => validateXdrInput(V0_XDR)).not.toThrow();
    const result = validateXdrInput(V0_XDR);
    expect(result.valid).toBe(false);
  });

  it("accepts a v1 envelope (envelopeTypeTx = 2) without rejecting it as v0", () => {
    // Build a minimal buffer whose first 4 bytes encode int32 = 2 (envelopeTypeTx).
    const buf = Buffer.alloc(32);
    buf.writeInt32BE(2, 0);
    const v1Xdr = buf.toString("base64");
    // The function should not reject it for the v0 reason (it may fail other
    // validations, but the error must NOT be UNSUPPORTED_ENVELOPE_TYPE).
    const result = validateXdrInput(v1Xdr);
    expect(result.code).not.toBe(ErrorCode.UNSUPPORTED_ENVELOPE_TYPE);
  });
});
