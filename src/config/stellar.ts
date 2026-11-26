import * as StellarSdk from "@stellar/stellar-sdk";

import type { Network } from "../types";

export type { Network };

export function parseRpcHeaders(raw?: string): Record<string, string> {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) out[String(k)] = String(v);
      return out;
    }
  } catch {
    // fall through to formatted pairs
  }
  const out: Record<string, string> = {};
  for (const pair of trimmed.split(/[,;\n]/)) {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) out[key] = val;
    } else {
      const colon = pair.indexOf(":");
      if (colon > 0) {
        const key = pair.slice(0, colon).trim();
        const val = pair.slice(colon + 1).trim();
        if (key) out[key] = val;
      }
    }
  }
  return out;
}

export function getRpcHeaders(): Record<string, string> {
  return parseRpcHeaders(process.env.STELLAR_RPC_HEADERS);
}

export function isValidNetwork(value: unknown): value is Network {
  return value === "testnet" || value === "mainnet" || value === "futurenet";
}

interface NetworkConfig {
  rpcUrl: string;
  rpcUrls: string[];
  networkPassphrase: string;
  secretKey: string;
}

/**
 * Parse a raw RPC URL setting into a de-duplicated list of endpoints.
 * Supports comma-separated (and whitespace/semicolon/newline separated) values.
 */
export function parseRpcUrls(raw?: string): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[,;\s]+/)) {
    const url = part.trim();
    if (!url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

function resolveRpcUrls(network: Network): string[] {
  const perNetwork = parseRpcUrls(
    process.env[`${network.toUpperCase()}_RPC_URL`],
  );
  if (perNetwork.length > 0) return perNetwork;
  return parseRpcUrls(process.env.STELLAR_RPC_URL);
}

export function getNetworkConfig(network: Network = "testnet"): NetworkConfig {
  const configs: Record<Network, Omit<NetworkConfig, "rpcUrls">> = {
    mainnet: {
      rpcUrl: process.env.MAINNET_RPC_URL || "",
      networkPassphrase: StellarSdk.Networks.PUBLIC,
      secretKey: process.env.MAINNET_SECRET_KEY || "",
    },
    testnet: {
      rpcUrl: process.env.TESTNET_RPC_URL || "",
      networkPassphrase: StellarSdk.Networks.TESTNET,
      secretKey: process.env.TESTNET_SECRET_KEY || "",
    },
    futurenet: {
      rpcUrl: process.env.FUTURENET_RPC_URL || "",
      networkPassphrase: StellarSdk.Networks.FUTURENET,
      secretKey: process.env.FUTURENET_SECRET_KEY || "",
    },
  };

  const config = configs[network];
  const rpcUrls = resolveRpcUrls(network);
  if (rpcUrls.length === 0) {
    throw new Error(`RPC URL not configured for network: ${network}`);
  }
  return { ...config, rpcUrl: rpcUrls[0], rpcUrls };
}

interface PoolEntry {
  server: StellarSdk.rpc.Server;
  url: string;
  createdAt: number;
}

interface NetworkPool {
  servers: PoolEntry[];
  createdAt: number;
}

const pool = new Map<Network, NetworkPool>();

export function clearRpcPool(): void {
  pool.clear();
}

function buildServer(url: string): StellarSdk.rpc.Server {
  const allowHttp = process.env.ALLOW_HTTP === "true";
  const headers = getRpcHeaders();
  return new StellarSdk.rpc.Server(url, { allowHttp, headers } as never);
}

/**
 * Return the pool of RPC servers for a network, one per configured endpoint.
 * The pool is cached for RPC_POOL_TTL_MS and rebuilt when the URL set changes.
 */
export function getRpcServers(
  network: Network = "testnet",
): StellarSdk.rpc.Server[] {
  const rpcPoolTtlMs = parseInt(process.env.RPC_POOL_TTL_MS || "300000", 10);
  const now = Date.now();
  const { rpcUrls } = getNetworkConfig(network);
  const entry = pool.get(network);

  const sameUrls =
    entry &&
    entry.servers.length === rpcUrls.length &&
    entry.servers.every((s, i) => s.url === rpcUrls[i]);

  if (entry && sameUrls && now - entry.createdAt < rpcPoolTtlMs) {
    return entry.servers.map((s) => s.server);
  }

  const servers: PoolEntry[] = rpcUrls.map((url) => ({
    server: buildServer(url),
    url,
    createdAt: now,
  }));
  pool.set(network, { servers, createdAt: now });
  return servers.map((s) => s.server);
}

export function getRpcServer(
  network: Network | string = "testnet",
): StellarSdk.rpc.Server {
  if (typeof network === "string" && /^https?:\/\//i.test(network)) {
    return buildServer(network);
  }
  return getRpcServers(network as Network)[0];
}
