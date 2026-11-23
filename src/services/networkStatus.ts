import { Network, getRpcServer, getNetworkConfig } from "../config/stellar";
import { CACHE_TTL } from "../constants";
import { logger } from "../utils/logger";

// ---------------------------------------------------------------------------
// Issue #70 — Cache getLatestLedger sequence (2s TTL)
// ---------------------------------------------------------------------------
interface LedgerCacheEntry {
  sequence: number;
  closeTime: number;
  timestamp: number;
}
const ledgerCache = new Map<Network, LedgerCacheEntry>();
const LEDGER_CACHE_TTL_MS = 2000;

let ledgerCacheHits = 0;
let ledgerCacheMisses = 0;

export function getLedgerCacheStats(): { hits: number; misses: number } {
  return { hits: ledgerCacheHits, misses: ledgerCacheMisses };
}

export async function getLatestLedgerCached(
  network: Network = "testnet",
  forceRefresh = false,
): Promise<{ sequence: number; closeTime: number }> {
  const now = Date.now();
  const cached = ledgerCache.get(network);
  if (!forceRefresh && cached && now - cached.timestamp < LEDGER_CACHE_TTL_MS) {
    ledgerCacheHits++;
    return { sequence: cached.sequence, closeTime: cached.closeTime };
  }
  ledgerCacheMisses++;
  const server = getRpcServer(network);
  const latest = await server.getLatestLedger();
  const entry: LedgerCacheEntry = {
    sequence: latest.sequence,
    closeTime: (latest as { closeTime?: number }).closeTime ?? now,
    timestamp: now,
  };
  ledgerCache.set(network, entry);
  return { sequence: entry.sequence, closeTime: entry.closeTime };
}
  ledger: number;
  baseFee: string;
  networkPassphrase: string;
  rpcLatencyMs: number;
}

export interface NetworkLimitsResult {
  protocolVersion: number;
  limits: {
    maxContractCpuInstructions: number;
    maxMemoryBytes: number;
    maxFootprintEntries: number;
  };
}

interface CachedStatus {
  data: NetworkStatusResult;
  timestamp: number;
}

interface CachedLimits {
  data: NetworkLimitsResult;
  timestamp: number;
}

const cache = new Map<Network, CachedStatus>();
const limitsCache = new Map<Network, CachedLimits>();

const LIMITS_CACHE_TTL_MS = 600_000; // 10 minutes

function getTtlMs(): number {
  const fromEnv = parseInt(process.env.NETWORK_STATUS_TTL_MS ?? "", 10);
  return Number.isFinite(fromEnv) && fromEnv > 0
    ? fromEnv
    : CACHE_TTL.NETWORK_STATUS_MS;
}

export async function getNetworkStatus(
  network: Network = "testnet",
): Promise<NetworkStatusResult> {
  const now = Date.now();
  const cached = cache.get(network);

  if (cached && now - cached.timestamp < getTtlMs()) {
    return cached.data;
  }

  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);
  const startTime = Date.now();

  const latestLedger = await server.getLatestLedger();
  const rpcLatencyMs = Date.now() - startTime;

  const result: NetworkStatusResult = {
    ledger: latestLedger.sequence,
    baseFee: "100",
    networkPassphrase,
    rpcLatencyMs,
  };

  cache.set(network, { data: result, timestamp: now });

  // Notify any registered broadcast listeners (e.g. WebSocket gateway).
  emitLedgerClose(network, result);

  return result;
}

// ---------------------------------------------------------------------------
// Issue #25 — Ledger-close event broadcasting for WebSocket subscribers
// ---------------------------------------------------------------------------

type LedgerCloseListener = (
  network: Network,
  status: NetworkStatusResult,
) => void;

const ledgerCloseListeners = new Set<LedgerCloseListener>();

/**
 * Register a callback that will be invoked whenever a fresh ledger-close
 * status is fetched from an RPC server.
 */
export function onLedgerClose(listener: LedgerCloseListener): () => void {
  ledgerCloseListeners.add(listener);
  return () => ledgerCloseListeners.delete(listener);
}

function emitLedgerClose(network: Network, status: NetworkStatusResult): void {
  for (const listener of ledgerCloseListeners) {
    try {
      listener(network, status);
    } catch (err) {
      logger.warn(
        { err },
        "networkStatus: uncaught error in ledgerClose listener",
      );
    }
  }
}
