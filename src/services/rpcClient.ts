import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer, Network } from "../config/stellar";

/**
 * Simulate a transaction via RPC
 */
export async function simulateViaRpc(
  tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  network: Network,
  signal?: AbortSignal,
  ledgerSequence?: number,
): Promise<StellarSdk.rpc.Api.SimulateTransactionResponse> {
  const server = getRpcServer(network);
  const simOptions: Record<string, unknown> = { signal };
  if (ledgerSequence !== undefined) {
    simOptions.ledger = ledgerSequence;
  }
  return server.simulateTransaction(tx, simOptions as never);
}

/**
 * Fetch TTL information for ledger entries
 */
export async function fetchTtlInfo(
  network: Network,
  footprintEntries: string[],
): Promise<
  Record<string, { liveUntilLedger: number; expiresInLedgers: number }>
> {
  if (footprintEntries.length === 0) {
    return {};
  }

  const server = getRpcServer(network);

  try {
    const ledgerKeys = footprintEntries.map((xdr) => {
      return StellarSdk.xdr.LedgerKey.fromXDR(xdr, "base64");
    });

    const response = await server.getLedgerEntries(...ledgerKeys);
    const ttlMap: Record<
      string,
      { liveUntilLedger: number; expiresInLedgers: number }
    > = {};
    const currentLedger = response.latestLedger ?? 0;

    if (response.entries) {
      for (let i = 0; i < response.entries.length; i++) {
        const entry = response.entries[i];
        const xdr = footprintEntries[i];

        if (entry.liveUntilLedgerSeq) {
          const liveUntilLedger = Number(entry.liveUntilLedgerSeq);
          const expiresInLedgers = liveUntilLedger - currentLedger;

          ttlMap[xdr] = {
            liveUntilLedger,
            expiresInLedgers,
          };
        }
      }
    }

    return ttlMap;
  } catch {
    return {};
  }
}
