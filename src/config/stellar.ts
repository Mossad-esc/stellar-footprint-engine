import * as StellarSdk from "@stellar/stellar-sdk";

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
  networkPassphrase: string;
  secretKey: string;
}

export function getNetworkConfig(network: Network = "testnet"): NetworkConfig {
  const configs: Record<Network, NetworkConfig> = {
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
  if (!config.rpcUrl) {
    throw new Error(`RPC URL not configured for network: ${network}`);
  }
  return config;
}

interface PoolEntry {
  server: StellarSdk.rpc.Server;
  createdAt: number;
}

const pool = new Map<Network, PoolEntry>();

export function clearRpcPool(): void {
  pool.clear();
}

export function getRpcServer(
  network: Network = "testnet",
): StellarSdk.rpc.Server {
  const rpcPoolTtlMs = parseInt(process.env.RPC_POOL_TTL_MS || "300000", 10);
  const now = Date.now();
  const entry = pool.get(network);

  if (entry && now - entry.createdAt < rpcPoolTtlMs) {
    return entry.server;
  }

  const { rpcUrl } = getNetworkConfig(network);
  const allowHttp = process.env.ALLOW_HTTP === "true";
  const headers = getRpcHeaders();
  const server = new StellarSdk.rpc.Server(rpcUrl, { allowHttp, headers } as never);
  pool.set(network, { server, createdAt: now });
  return server;
}
