import * as StellarSdk from "@stellar/stellar-sdk";

import { HTTP_STATUS } from "../constants";
import { AppError } from "../utils/AppError";

/**
 * Parse XDR string into a Transaction object.
 * Wraps any SDK/XDR decoding failure in a typed 400 AppError so malformed
 * payloads never leak internal stack traces or crash the process.
 */
export function parseXdr(
  xdr: string,
  networkPassphrase: string,
): StellarSdk.Transaction | StellarSdk.FeeBumpTransaction {
  if (!xdr || typeof xdr !== "string") {
    throw new AppError("Invalid transaction XDR", HTTP_STATUS.BAD_REQUEST);
  }
  try {
    return StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch {
    throw new AppError("Invalid transaction XDR", HTTP_STATUS.BAD_REQUEST);
  }
}

/** Preserve unsupported XDR in the caller rather than guessing a future union arm. */
export function parseLedgerKey(
  raw: string,
): StellarSdk.xdr.LedgerKey | undefined {
  if (!raw || typeof raw !== "string") {
    return undefined;
  }
  try {
    return StellarSdk.xdr.LedgerKey.fromXDR(raw, "base64");
  } catch {
    return undefined;
  }
}
