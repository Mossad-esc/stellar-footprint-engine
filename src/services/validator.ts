import * as StellarSdk from "@stellar/stellar-sdk";

import { Network, isValidNetwork } from "../config/stellar";

const PASSPHRASES: Record<Network, string> = {
  mainnet: StellarSdk.Networks.PUBLIC,
  testnet: StellarSdk.Networks.TESTNET,
  futurenet: StellarSdk.Networks.FUTURENET,
};

export interface XdrValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate XDR transaction for Soroban invokeHostFunction operation and network match.
 * @param xdr - Base64 encoded XDR transaction
 * @param network - Stellar network (mainnet, testnet, or futurenet)
 * @returns Validation result with valid flag, errors, and warnings
 */
export function validateXdr(
  xdr: string,
  network: Network,
): XdrValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Validate base64 format
  const BASE64_RE = /^[A-Za-z0-9+/]+=*$/;
  if (!BASE64_RE.test(xdr)) {
    errors.push("Invalid XDR: must be valid base64");
    return { valid: false, errors, warnings };
  }

  // 2. Validate size (optional but good practice)
  const MAX_XDR_BYTES = 100 * 1024; // 100KB
  if (xdr.length > MAX_XDR_BYTES) {
    errors.push("XDR too large: maximum 100kb");
    return { valid: false, errors, warnings };
  }

  // 3. Resolve network passphrase without requiring live RPC credentials
  if (!isValidNetwork(network)) {
    errors.push(`Network configuration not found for: ${network}`);
    return { valid: false, errors, warnings };
  }
  const networkPassphrase = PASSPHRASES[network];

  // 4. Parse XDR as a transaction
  let tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction;
  try {
    tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch {
    errors.push("Failed to parse XDR as a transaction");
    return { valid: false, errors, warnings };
  }

  // 5. Extract operations (handle fee bump transaction)
  const ops =
    tx instanceof StellarSdk.FeeBumpTransaction
      ? tx.innerTransaction.operations
      : tx.operations;

  if (ops.length === 0) {
    errors.push("Transaction contains no operations");
    return { valid: false, errors, warnings };
  }

  // 6. Check for at least one invokeHostFunction operation (Soroban operation)
  const hasInvokeHostFunction = ops.some(
    (op) => op.type === "invokeHostFunction",
  );

  if (!hasInvokeHostFunction) {
    errors.push(
      "Transaction must contain at least one Soroban invokeHostFunction operation",
    );
    return { valid: false, errors, warnings };
  }

  // 7. Optional warnings: if there are operations other than invokeHostFunction, we can warn
  const nonSorobanOps = ops.filter((op) => op.type !== "invokeHostFunction");
  if (nonSorobanOps.length > 0) {
    warnings.push(
      `Transaction contains ${nonSorobanOps.length} non-Soroban operation(s); only invokeHostFunction operations are processed`,
    );
  }

  // If we reach here, the XDR is valid
  return { valid: true, errors: [], warnings };
}
