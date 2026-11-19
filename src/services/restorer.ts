import * as StellarSdk from "@stellar/stellar-sdk";

import { Network, getNetworkConfig, getRpcServer } from "../config/stellar";
import { sanitizeRpcError } from "../utils/rpcErrorSanitizer";

export interface RestoreResult {
  needsRestore: boolean;
  restoreXdr?: string;
  fee?: string;
  resourceFee?: string;
}

/** Accept parsed SDK preambles and raw preambles attached to restoration errors. */
export function getRestorePreamble(
  response:
    | StellarSdk.rpc.Api.SimulateTransactionResponse
    | StellarSdk.rpc.Api.RawSimulateTransactionResponse,
):
  | {
      transactionData: StellarSdk.xdr.SorobanTransactionData;
      minResourceFee: bigint;
    }
  | undefined {
  if (!("restorePreamble" in response) || !response.restorePreamble)
    return undefined;
  const preamble = response.restorePreamble;
  const data =
    typeof preamble.transactionData === "string"
      ? new StellarSdk.SorobanDataBuilder(preamble.transactionData).build()
      : preamble.transactionData.build();
  const minimum = BigInt(preamble.minResourceFee);
  const encoded = BigInt(data.resourceFee().toString());
  if (minimum < 0n || encoded < 0n)
    throw new Error("Invalid restoration resource fee");
  const minResourceFee = minimum > encoded ? minimum : encoded;
  data.resourceFee(StellarSdk.xdr.Int64.fromString(minResourceFee.toString()));
  return { transactionData: data, minResourceFee };
}

export async function buildRestoreTransaction(
  xdr: string,
  network: Network = "testnet",
): Promise<RestoreResult> {
  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);

  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const inner =
    tx instanceof StellarSdk.FeeBumpTransaction ? tx.innerTransaction : tx;
  // The SDK's parsed method discards restorePreamble when an error is present.
  // Read the documented raw response so archived WASM error preambles survive.
  const response = await server._simulateTransaction(inner);
  const preamble = getRestorePreamble(response);

  if (!preamble) {
    if ("error" in response && response.error) {
      throw new Error(sanitizeRpcError(response.error));
    }
    return { needsRestore: false };
  }

  const sourceAccount =
    "innerTransaction" in tx ? tx.innerTransaction.source : tx.source;
  const account = await server.getAccount(sourceAccount);
  // RPC computes rent from archived entry sizes, network rates and latestLedger.
  // Ledger keys contain hashes, not WASM, so their size cannot estimate this rent.
  const fee = (
    BigInt(StellarSdk.BASE_FEE) + preamble.minResourceFee
  ).toString();
  const restoreTx = new StellarSdk.TransactionBuilder(account, {
    // TransactionBuilder adds SorobanTransactionData.resourceFee automatically.
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .setSorobanData(preamble.transactionData)
    .addOperation(StellarSdk.Operation.restoreFootprint({}))
    .setTimeout(30)
    .build();

  return {
    needsRestore: true,
    restoreXdr: restoreTx.toXDR(),
    fee,
    resourceFee: preamble.minResourceFee.toString(),
  };
}
