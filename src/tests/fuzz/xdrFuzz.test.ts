import * as StellarSdk from "@stellar/stellar-sdk";

import { parseLedgerKey, parseXdr } from "../../services/xdrParser";
import { AppError } from "../../utils/AppError";
import { validateXdrInput } from "../../utils/validateXdrInput";
import {
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  SOROBAN_INVOKE_XDR,
  V0_ENVELOPE_XDR,
} from "../fixtures/xdr";

const SEED_XDRS = [
  SOROBAN_INVOKE_XDR,
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  V0_ENVELOPE_XDR,
];

/** Deterministic PRNG (Mulberry32) for reproducible fuzzing runs. */
function createPrng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Flips 1 to 8 random bits/bytes in a decoded XDR buffer and re-encodes as base64. */
function mutateByteFlip(validXdr: string, rand: () => number): string {
  const buf = Buffer.from(validXdr, "base64");
  if (buf.length === 0) return "";
  const flips = 1 + Math.floor(rand() * 8);
  for (let i = 0; i < flips; i++) {
    const idx = Math.floor(rand() * buf.length);
    const mask = 1 << Math.floor(rand() * 8);
    buf[idx] ^= mask;
  }
  return buf.toString("base64");
}

/** Truncates a decoded XDR buffer to a random shorter length and re-encodes as base64. */
function mutateBitTruncation(validXdr: string, rand: () => number): string {
  const buf = Buffer.from(validXdr, "base64");
  if (buf.length <= 1) return "";
  const cutLen = Math.floor(rand() * buf.length);
  return buf.subarray(0, cutLen).toString("base64");
}

/** Truncates or corrupts the base64 string directly without re-encoding. */
function mutateBase64String(validXdr: string, rand: () => number): string {
  const cut = Math.floor(rand() * validXdr.length);
  const truncated = validXdr.slice(0, cut);
  if (rand() < 0.5 || truncated.length === 0) {
    return truncated;
  }
  const garbageChars = "!@#$%^&*()_+-={}[]|;:'\",.<>?";
  const pos = Math.floor(rand() * truncated.length);
  const ch = garbageChars[Math.floor(rand() * garbageChars.length)];
  return truncated.slice(0, pos) + ch + truncated.slice(pos + 1);
}

describe("XDR fuzzing suite (#90)", () => {
  const ITERATIONS_PER_MUTATOR = 1000;
  const rand = createPrng(0x5eed1337);

  it("handles thousands of byte-flipped XDR payloads without unhandled panics", () => {
    for (let i = 0; i < ITERATIONS_PER_MUTATOR; i++) {
      const seedXdr = SEED_XDRS[i % SEED_XDRS.length];
      const mutated = mutateByteFlip(seedXdr, rand);

      const validation = validateXdrInput(mutated);
      expect(typeof validation.valid).toBe("boolean");

      if (validation.valid) {
        try {
          const parsed = parseXdr(mutated, StellarSdk.Networks.TESTNET);
          expect(parsed).toBeDefined();
        } catch (err: unknown) {
          expect(err).toBeInstanceOf(AppError);
          const appErr = err as AppError;
          expect(appErr.statusCode).toBe(400);
          expect(appErr.message).not.toMatch(/\bat\s+/);
        }
      } else {
        expect(typeof validation.error).toBe("string");
      }
    }
  });

  it("handles thousands of bit-truncated XDR payloads without unhandled panics", () => {
    for (let i = 0; i < ITERATIONS_PER_MUTATOR; i++) {
      const seedXdr = SEED_XDRS[i % SEED_XDRS.length];
      const mutated = mutateBitTruncation(seedXdr, rand);

      const validation = validateXdrInput(mutated);
      expect(typeof validation.valid).toBe("boolean");

      try {
        const parsed = parseXdr(mutated, StellarSdk.Networks.TESTNET);
        expect(parsed).toBeDefined();
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        const appErr = err as AppError;
        expect(appErr.statusCode).toBe(400);
        expect(appErr.message).not.toMatch(/\bat\s+/);
      }
    }
  });

  it("rejects corrupted and truncated base64 strings cleanly", () => {
    for (let i = 0; i < ITERATIONS_PER_MUTATOR; i++) {
      const seedXdr = SEED_XDRS[i % SEED_XDRS.length];
      const mutated = mutateBase64String(seedXdr, rand);

      const validation = validateXdrInput(mutated);
      expect(typeof validation.valid).toBe("boolean");

      if (!validation.valid) {
        expect(typeof validation.error).toBe("string");
        expect(validation.error!.length).toBeGreaterThan(0);
      }

      try {
        parseXdr(mutated, StellarSdk.Networks.TESTNET);
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }

      expect(() => parseLedgerKey(mutated)).not.toThrow();
    }
  });

  it("safely rejects non-string and adversarial inputs in validateXdrInput and parseXdr", () => {
    const adversarialInputs: unknown[] = [
      null,
      undefined,
      0,
      12345,
      true,
      false,
      {},
      [],
      Symbol("xdr"),
      "\x00\x01\x02",
      "====",
      "A",
      "AA",
      "AAA",
      "A".repeat(100 * 1024 + 4),
    ];

    for (const input of adversarialInputs) {
      const result = validateXdrInput(input);
      expect(result.valid).toBe(false);
      expect(typeof result.error).toBe("string");

      try {
        parseXdr(input as string, StellarSdk.Networks.TESTNET);
        throw new Error("Expected parseXdr to throw AppError");
      } catch (err: unknown) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(400);
      }

      expect(parseLedgerKey(input as string)).toBeUndefined();
    }
  });
});
