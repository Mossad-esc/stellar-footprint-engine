import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer, Network } from "../config/stellar";
import { logger } from "../utils/logger";
import {
  isTransientError,
  parseRetryAfterMs,
  RETRYABLE_HTTP_STATUSES,
  RPC_MAX_RETRIES,
} from "../utils/retry";

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

// ---------------------------------------------------------------------------
// #61 — Dynamic RPC endpoint pool with latency-weighted round-robin
// ---------------------------------------------------------------------------

/** Number of recent latency samples kept per endpoint for the moving average. */
const LATENCY_WINDOW = 10;

/** Latency assumed for an endpoint that has no samples yet (ms). */
const DEFAULT_LATENCY_MS = 100;

/** Multiplier applied to an endpoint's effective latency after a penalty. */
const PENALTY_MULTIPLIER = 4;

/** How long (ms) a penalty remains in effect before decaying. */
const PENALTY_TTL_MS = 30_000;

interface EndpointState {
  network: string;
  url: string;
  /** Rolling window of the most recent request latencies (ms). */
  latencies: number[];
  /** Timestamp until which the endpoint is penalized (0 = not penalized). */
  penalizedUntil: number;
  /** Weighted round-robin accumulator. */
  currentWeight: number;
}

const endpointPool = new Map<string, EndpointState>();

function endpointKey(network: string, url: string): string {
  return `${network}::${url}`;
}

function isDebugEnabled(): boolean {
  const flag = process.env.RPC_DEBUG ?? process.env.DEBUG;
  return flag === "1" || flag === "true";
}

function debugLog(message: string): void {
  if (isDebugEnabled()) {
    // eslint-disable-next-line no-console
    console.log(`[rpc-pool] ${message}`);
  }
}

/**
 * Parse a comma-separated list of RPC URLs into a trimmed, de-duplicated array.
 */
export function parseRpcUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const part of raw.split(",")) {
    const url = part.trim();
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}

/**
 * Resolve the configured RPC URLs for a network. Supports comma-separated
 * values in the per-network env var (e.g. `TESTNET_RPC_URL`) as well as the
 * generic `STELLAR_RPC_URL` fallback.
 */
export function getRpcUrls(network: Network): string[] {
  const perNetworkEnv: Record<string, string | undefined> = {
    testnet: process.env.TESTNET_RPC_URL,
    mainnet: process.env.MAINNET_RPC_URL,
    futurenet: process.env.FUTURENET_RPC_URL,
  };

  const candidates = [
    ...parseRpcUrls(perNetworkEnv[network]),
    ...parseRpcUrls(process.env.STELLAR_RPC_URL),
  ];

  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of candidates) {
    if (!seen.has(url)) {
      seen.add(url);
      result.push(url);
    }
  }
  return result;
}

function getOrCreateEndpoint(network: string, url: string): EndpointState {
  const key = endpointKey(network, url);
  let state = endpointPool.get(key);
  if (!state) {
    state = {
      network,
      url,
      latencies: [],
      penalizedUntil: 0,
      currentWeight: 0,
    };
    endpointPool.set(key, state);
  }
  return state;
}

/**
 * Compute the effective latency used for weighting. Endpoints without samples
 * use a default; penalized endpoints get a multiplied latency so they receive
 * proportionally less traffic.
 */
function effectiveLatency(state: EndpointState, now: number): number {
  const base =
    state.latencies.length > 0
      ? state.latencies.reduce((a, b) => a + b, 0) / state.latencies.length
      : DEFAULT_LATENCY_MS;
  const penalized = state.penalizedUntil > now;
  return penalized ? base * PENALTY_MULTIPLIER : base;
}

/**
 * Select the next endpoint for a network using latency-weighted round-robin.
 * Returns `undefined` when no endpoints are configured.
 */
export function selectRpcEndpoint(network: Network): string | undefined {
  const urls = getRpcUrls(network);
  if (urls.length === 0) return undefined;
  if (urls.length === 1) return urls[0];

  const now = Date.now();
  const states = urls.map((url) => getOrCreateEndpoint(network, url));

  // Weight is inversely proportional to effective latency.
  let totalWeight = 0;
  const weights = states.map((state) => {
    const weight = 1 / Math.max(effectiveLatency(state, now), 1);
    totalWeight += weight;
    return weight;
  });

  // Smooth weighted round-robin: add each weight to its accumulator and pick
  // the endpoint with the highest accumulator, then subtract the total.
  let selectedIndex = 0;
  let best = -Infinity;
  for (let i = 0; i < states.length; i++) {
    states[i].currentWeight += weights[i];
    if (states[i].currentWeight > best) {
      best = states[i].currentWeight;
      selectedIndex = i;
    }
  }
  states[selectedIndex].currentWeight -= totalWeight;

  const selected = states[selectedIndex];
  debugLog(
    `network=${network} selected=${sanitizeRpcUrl(selected.url)} ` +
      `avgLatency=${effectiveLatency(selected, now).toFixed(1)}ms ` +
      `penalized=${selected.penalizedUntil > now}`,
  );
  return selected.url;
}

/**
 * Record the outcome of a request against a specific endpoint, updating the
 * rolling latency window and applying penalties for failures/timeouts.
 */
export function recordEndpointResult(
  network: Network,
  url: string,
  latencyMs: number,
  failed: boolean,
  penaltyMs?: number,
): void {
  const state = getOrCreateEndpoint(network, url);
  state.latencies.push(latencyMs);
  if (state.latencies.length > LATENCY_WINDOW) {
    state.latencies.shift();
  }
  if (failed) {
    const duration = penaltyMs ?? PENALTY_TTL_MS;
    state.penalizedUntil = Date.now() + duration;
    debugLog(
      `network=${network} penalized=${sanitizeRpcUrl(url)} for ${duration}ms`,
    );
  }
}

/**
 * Reset the endpoint pool. Intended for tests.
 */
export function resetRpcPool(): void {
  endpointPool.clear();
}

// ---------------------------------------------------------------------------
// #65 — RPC response payload size limiter
// ---------------------------------------------------------------------------

/**
 * Measure the serialised byte length of a value using a TextEncoder so that
 * multi-byte characters are counted correctly.
 */
function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Guard a simulate-transaction response against oversized payloads.
 *
 * - Rejects with ErrorCode.RPC_PAYLOAD_TOO_LARGE when the serialised response
 *   exceeds RPC_MAX_PAYLOAD_BYTES (default 10 MB).
 * - Truncates diagnostic events and emits a warning when the payload exceeds
 *   RPC_PAYLOAD_WARN_BYTES (default 2 MB) but stays under the hard limit.
 */
export function guardPayloadSize(
  response: StellarSdk.rpc.Api.SimulateTransactionResponse,
): StellarSdk.rpc.Api.SimulateTransactionResponse {
  const size = byteLength(response);

  if (size > RPC_MAX_PAYLOAD_BYTES) {
    const err = Object.assign(
      new Error(
        `RPC response payload too large: ${size} bytes exceeds the ${RPC_MAX_PAYLOAD_BYTES}-byte limit`,
      ),
      { code: ErrorCode.RPC_PAYLOAD_TOO_LARGE },
    );
    throw err;
  }

  if (size > RPC_PAYLOAD_WARN_BYTES) {
    logger.warn(
      { payloadBytes: size, warnThresholdBytes: RPC_PAYLOAD_WARN_BYTES },
      "RPC response payload exceeds warn threshold; truncating diagnostic events",
    );

    const events = (response as unknown as { events?: unknown[] }).events ?? [];
    if (events.length > RPC_DIAGNOSTIC_EVENT_TRUNCATION_LIMIT) {
      return {
        ...response,
        events: events.slice(0, RPC_DIAGNOSTIC_EVENT_TRUNCATION_LIMIT),
      } as StellarSdk.rpc.Api.SimulateTransactionResponse;
    }
  }

  return response;
}

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

// ---------------------------------------------------------------------------
// #63 — Automatic provider failover on HTTP 429 and 5xx
// ---------------------------------------------------------------------------

/**
 * Extract the HTTP status code and Retry-After header value from an error
 * thrown by the Stellar SDK or a raw fetch response.
 */
function extractHttpInfo(err: unknown): {
  status: number | undefined;
  retryAfter: string | undefined;
} {
  if (!(err instanceof Error))
    return { status: undefined, retryAfter: undefined };

  const anyErr = err as {
    status?: number;
    response?: {
      status?: number;
      headers?: { get?: (h: string) => string | null };
    };
  };

  const status = anyErr.status ?? anyErr.response?.status;
  const retryAfter =
    anyErr.response?.headers?.get?.("retry-after") ??
    anyErr.response?.headers?.get?.("Retry-After") ??
    undefined;

  return { status, retryAfter: retryAfter ?? undefined };
}

/**
 * Simulate a transaction via RPC with automatic provider failover.
 *
 * On HTTP 429 or 5xx (502/503/504):
 *  1. Immediately back-off the failing host for the Retry-After duration
 *     (or 30 s if the header is absent).
 *  2. Re-route each retry attempt to the next available provider in the pool.
 *
 * Falls back to the default getRpcServer() when no pool URLs are configured.
 */
export async function simulateViaRpc(
  tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
  network: Network,
  signal?: AbortSignal,
  ledgerSequence?: number,
): Promise<StellarSdk.rpc.Api.SimulateTransactionResponse> {
  const simOptions: Record<string, unknown> = { signal };
  if (ledgerSequence !== undefined) {
    simOptions.ledger = ledgerSequence;
  }

  // No pool configured — use the default server without failover logic.
  const hasPool = getRpcUrls(network).length > 0;
  if (!hasPool) {
    const server = getRpcServer(network);
    return guardPayloadSize(
      await server.simulateTransaction(tx, simOptions as never),
    );
  }

  let lastError: unknown;

  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    const selectedUrl = selectRpcEndpoint(network);
    if (!selectedUrl) {
      const server = getRpcServer(network);
      return server.simulateTransaction(tx, simOptions as never);
    }

    const server = new StellarSdk.rpc.Server(selectedUrl);
    const startedAt = Date.now();

    try {
      const response = await server.simulateTransaction(
        tx,
        simOptions as never,
      );
      recordEndpointResult(network, selectedUrl, Date.now() - startedAt, false);
      return response;
    } catch (error) {
      lastError = error;
      const latency = Date.now() - startedAt;
      const { status, retryAfter } = extractHttpInfo(error);

      const isRateOrServerError =
        typeof status === "number" && RETRYABLE_HTTP_STATUSES.has(status);

      if (isRateOrServerError) {
        // Honour Retry-After when provided; default to 30 s.
        const penaltyMs = parseRetryAfterMs(retryAfter) ?? PENALTY_TTL_MS;
        recordEndpointResult(network, selectedUrl, latency, true, penaltyMs);

        logger.warn(
          {
            network,
            url: sanitizeRpcUrl(selectedUrl),
            status,
            penaltyMs,
            attempt: attempt + 1,
            maxRetries: RPC_MAX_RETRIES,
          },
          `RPC provider returned HTTP ${status}; backing off for ${penaltyMs}ms and failing over`,
        );

        if (attempt < RPC_MAX_RETRIES) {
          // Advance to the next attempt immediately — selectRpcEndpoint will
          // skip the penalized host automatically.
          continue;
        }
      } else {
        recordEndpointResult(
          network,
          selectedUrl,
          latency,
          !isTransientError(error),
        );
      }

      throw error;
    }
  }

  throw lastError;
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

  const selectedUrl = selectRpcEndpoint(network);
  const server = selectedUrl
    ? new StellarSdk.rpc.Server(selectedUrl)
    : getRpcServer(network);

  try {
    const ledgerKeys = footprintEntries.map((xdr) => {
      return StellarSdk.xdr.LedgerKey.fromXDR(xdr, "base64");
    });

    const startedAt = Date.now();
    const response = await server.getLedgerEntries(...ledgerKeys);
    if (selectedUrl) {
      recordEndpointResult(network, selectedUrl, Date.now() - startedAt, false);
    }
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
    if (selectedUrl) {
      recordEndpointResult(network, selectedUrl, 0, true);
    }
    return {};
  }
}

/**
 * Fetch contract TTL information by contract ID
 */
export async function fetchContractTtl(
  network: Network,
  contractId: string,
): Promise<{
  liveUntilLedger: number;
  remainingLedgers: number;
  estimatedExpirationDate: string | null;
  currentLedger: number;
} | null> {
  const selectedUrl = selectRpcEndpoint(network);
  const server = selectedUrl
    ? new StellarSdk.rpc.Server(selectedUrl)
    : getRpcServer(network);

  try {
    // Create contract instance ledger key
    const contractInstanceKey = StellarSdk.xdr.LedgerKey.contractInstance(
      new StellarSdk.xdr.ContractInstanceLedgerKey({
        contract: StellarSdk.Address.fromString(contractId).toScAddress(),
      }),
    );

    const startedAt = Date.now();
    const response = await server.getLedgerEntries(contractInstanceKey);
    if (selectedUrl) {
      recordEndpointResult(network, selectedUrl, Date.now() - startedAt, false);
    }

    const currentLedger = response.latestLedger ?? 0;

    if (response.entries && response.entries.length > 0) {
      const entry = response.entries[0];
      if (entry.liveUntilLedgerSeq) {
        const liveUntilLedger = Number(entry.liveUntilLedgerSeq);
        const remainingLedgers = liveUntilLedger - currentLedger;
        const estimatedExpirationDate = new Date(
          Date.now() + remainingLedgers * 5000, // 5 seconds per ledger
        ).toISOString();

        return {
          liveUntilLedger,
          remainingLedgers,
          estimatedExpirationDate,
          currentLedger,
        };
      }
    }

    return null;
  } catch (error) {
    if (selectedUrl) {
      recordEndpointResult(network, selectedUrl, 0, true);
    }
    // If contract not found, return null
    if (error instanceof Error && error.message.includes("not found")) {
      return null;
    }
    throw error;
  }
}
