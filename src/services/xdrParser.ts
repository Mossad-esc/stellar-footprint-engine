import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Parse XDR string into a Transaction object
 */
export function parseXdr(
  xdr: string,
  networkPassphrase: string,
): StellarSdk.Transaction | StellarSdk.FeeBumpTransaction {
  return StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
}

/** Preserve unsupported XDR in the caller rather than guessing a future union arm. */
export function parseLedgerKey(
  raw: string,
): StellarSdk.xdr.LedgerKey | undefined {
  try {
    return StellarSdk.xdr.LedgerKey.fromXDR(raw, "base64");
  } catch {
    return undefined;
  }
}
