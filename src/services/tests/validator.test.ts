import * as StellarSdk from "@stellar/stellar-sdk";

import { Network } from "../../config/stellar";
import { validateXdr } from "../validator";

describe("validateXdr", () => {
  const testnetPassphrase = StellarSdk.Networks.TESTNET;
  const mainnetPassphrase = StellarSdk.Networks.PUBLIC;

  beforeEach(() => {
    process.env.TESTNET_RPC_URL = "https://soroban-testnet.stellar.org";
    process.env.MAINNET_RPC_URL = "https://soroban-mainnet.stellar.org";
  });

  // Helper to create a simple transaction with an invokeHostFunction operation
  const createTxWithInvokeHostFunction = (network: Network): string => {
    const networkPassphrase =
      network === "testnet" ? testnetPassphrase : mainnetPassphrase;

    const dummyAccount = new StellarSdk.Account(
      StellarSdk.Keypair.random().publicKey(),
      "1",
    );

    const transaction = new StellarSdk.TransactionBuilder(dummyAccount, {
      fee: "10000",
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(
            Buffer.from([1, 2, 3]),
          ),
          auth: [],
        }),
      )
      .setTimeout(StellarSdk.TimeoutInfinite)
      .build();

    return transaction.toXDR();
  };

  // Helper to create a simple transaction without invokeHostFunction (e.g., payment)
  const createTxWithoutInvokeHostFunction = (network: Network): string => {
    const networkPassphrase =
      network === "testnet" ? testnetPassphrase : mainnetPassphrase;

    const dummyAccount = new StellarSdk.Account(
      StellarSdk.Keypair.random().publicKey(),
      "1",
    );

    const transaction = new StellarSdk.TransactionBuilder(dummyAccount, {
      fee: "10000",
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          amount: "10",
          asset: StellarSdk.Asset.native(),
        }),
      )
      .setTimeout(StellarSdk.TimeoutInfinite)
      .build();

    return transaction.toXDR();
  };

  it("returns valid for a transaction with invokeHostFunction on correct network", () => {
    const txXDR = createTxWithInvokeHostFunction("testnet");
    const result = validateXdr(txXDR, "testnet");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns invalid for non-base64 string", () => {
    const result = validateXdr("not-base64!!!", "testnet");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Invalid XDR: must be valid base64");
  });

  it("returns invalid for base64 string that is not a valid transaction XDR", () => {
    const result = validateXdr("AAAA", "testnet");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Failed to parse XDR as a transaction");
  });

  it("returns invalid for transaction without invokeHostFunction operation", () => {
    const txXDR = createTxWithoutInvokeHostFunction("testnet");
    const result = validateXdr(txXDR, "testnet");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Transaction must contain at least one Soroban invokeHostFunction operation",
    );
  });

  it("returns valid for mainnet transactions when network is mainnet", () => {
    const txXDR = createTxWithInvokeHostFunction("mainnet");
    const result = validateXdr(txXDR, "mainnet");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns warning when transaction contains additional non-Soroban operations", () => {
    const dummyAccount = new StellarSdk.Account(
      StellarSdk.Keypair.random().publicKey(),
      "1",
    );
    const transaction = new StellarSdk.TransactionBuilder(dummyAccount, {
      fee: "10000",
      networkPassphrase: testnetPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: StellarSdk.Keypair.random().publicKey(),
          amount: "10",
          asset: StellarSdk.Asset.native(),
        }),
      )
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(
            Buffer.from([1, 2, 3]),
          ),
          auth: [],
        }),
      )
      .setTimeout(StellarSdk.TimeoutInfinite)
      .build();

    const txXDR = transaction.toXDR();
    const result = validateXdr(txXDR, "testnet");
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([
      expect.stringContaining("non-Soroban operation"),
    ]);
  });

  it("handles oversized XDR", () => {
    const oversized = "AAAA".repeat(30000); // 120KB valid base64
    const result = validateXdr(oversized, "testnet");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("XDR too large: maximum 100kb");
  });

  it("returns error for missing network configuration", () => {
    const txXDR = createTxWithInvokeHostFunction("testnet");
    const result = validateXdr(txXDR, "invalid" as Network);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Network configuration not found for: invalid",
    );
  });
});
