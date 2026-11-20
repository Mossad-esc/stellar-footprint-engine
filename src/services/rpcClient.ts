import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer, Network } from "../config/stellar";

// ---------------------------------------------------------------------------
// #40 — RPC pool stats tracking
// ---------------------------------------------------------------------------

export type CircuitStatus = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface RpcEndpointStats {
  network: string;
  url: string;
  requests: number;
  errors: number;
  avgLatencyMs: number;
  circuitStatus: CircuitStatus;
  failureRate: number;
}

interface StatsEntry {
  requests: number;
  errors: number;
  totalLatencyMs: number;
  circuitStatus: CircuitStatus;
}

const rpcStats = new Map<string, StatsEntry>();

/**
 * Sanitize a URL by masking credentials and sensitive query parameters.
 * - Masks basic-auth user:pass in the URL authority.
 * - Replaces query parameter values whose key contains "key", "secret",
 *   "token", "auth", or "password" (case-insensitive) with "***".
 */
export function sanitizeRpcUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Mask basic-auth credentials
    if (parsed.username || parsed.password) {
      parsed.username = "***";
      parsed.password = "***";
    }

    // Mask sensitive query params
    const sensitivePattern = /key|secret|token|auth|password/i;
    for (const [param] of Array.from(parsed.searchParams.entries())) {
      if (sensitivePattern.test(param)) {
        parsed.searchParams.set(param, "***");
      }
    }

    return parsed.toString();
  } catch {
    // If URL parsing fails, return as-is (best-effort)
    return url;
  }
}

/**
 * Record a completed RPC call for a given network.
 */
export function recordRpcCall(
  network: string,
  _url: string,
  latencyMs: number,
  failed: boolean,
): void {
  const existing = rpcStats.get(network) ?? {
    requests: 0,
    errors: 0,
    totalLatencyMs: 0,
    circuitStatus: "CLOSED" as CircuitStatus,
  };

  existing.requests += 1;
  if (failed) existing.errors += 1;
  existing.totalLatencyMs += latencyMs;

  rpcStats.set(network, existing);
}

/**
 * Update the circuit breaker status for a given network.
 */
export function setCircuitStatus(network: string, status: CircuitStatus): void {
  const existing = rpcStats.get(network) ?? {
    requests: 0,
    errors: 0,
    totalLatencyMs: 0,
    circuitStatus: "CLOSED" as CircuitStatus,
  };
  existing.circuitStatus = status;
  rpcStats.set(network, existing);
}

/**
 * Return stats for all networks that have a configured RPC URL.
 * Networks with no recorded calls get zeroed-out stats.
 */
export function getRpcStats(): RpcEndpointStats[] {
  const networkEnvMap: Record<string, string | undefined> = {
    testnet: process.env.TESTNET_RPC_URL,
    mainnet: process.env.MAINNET_RPC_URL,
    futurenet: process.env.FUTURENET_RPC_URL,
  };

  return Object.entries(networkEnvMap)
    .filter(([, envUrl]) => Boolean(envUrl))
    .map(([network, envUrl]) => {
      const entry = rpcStats.get(network);
      const requests = entry?.requests ?? 0;
      const errors = entry?.errors ?? 0;
      const totalLatencyMs = entry?.totalLatencyMs ?? 0;
      const circuitStatus = entry?.circuitStatus ?? "CLOSED";

      return {
        network,
        url: sanitizeRpcUrl(envUrl as string),
        requests,
        errors,
        avgLatencyMs: requests > 0 ? totalLatencyMs / requests : 0,
        circuitStatus,
        failureRate: requests > 0 ? errors / requests : 0,
      };
    });
}

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
