import { createHash } from "crypto";
import { gzipSync, gunzipSync, brotliCompressSync, brotliDecompressSync } from "zlib";

import metrics from "../middleware/metrics";
import { logger } from "../utils/logger";
import { env } from "../config/env";

// ioredis is lazy-loaded only when REDIS_URL is present to avoid the ~40ms
// module-parse cost during cold starts where Redis is not configured.
type RedisClient = import("ioredis").default;
type ClusterClient = import("ioredis").Cluster;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  /** When set, the entry is considered stale after this timestamp (SWR window) */
  staleAt?: number;
}

export interface CacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  flush(): Promise<void>;
  /** Which backend is currently active */
  readonly backend: "redis" | "memory" | "cluster" | "sentinel";
  /** Whether stale-while-revalidate is enabled */
  readonly staleWhileRevalidate: boolean;
  /**
   * Returns the cached value (even if stale) plus whether it is stale.
   * Callers can use this to trigger a background refresh when stale.
   */
  getWithMeta<T>(key: string): Promise<{ value: T; isStale: boolean } | null>;
}

const COMPRESSION_PREFIX_GZIP = "__gz:";
const COMPRESSION_PREFIX_BROTLI = "__br:";
const COMPRESSION_THRESHOLD = env.CACHE_COMPRESSION_THRESHOLD;

/** Milliseconds of the stale-while-revalidate window (from CACHE_SWR_MS env var) */
export const CACHE_SWR_MS = parseInt(process.env.CACHE_SWR_MS ?? "0", 10) || 0;

// ---------------------------------------------------------------------------
// Exported synchronous LRU cache (used by tests and idempotency layer)
// ---------------------------------------------------------------------------

export class LruMemoryCache<T> {
  readonly backend = "lru-memory" as const;
  private readonly store = new Map<string, { value: T; expiresAt: number }>();
  private hits = 0;
  private misses = 0;
  private readonly ttlMs: number;
  private readonly maxSize: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    // LRU: move to end
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits++;
    return entry.value;
  }

  set(key: string, value: T): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  stats() {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? 0 : this.hits / total,
      missRate: total === 0 ? 0 : this.misses / total,
      size: this.store.size,
      backend: this.backend,
      ttlSeconds: this.ttlMs / 1000,
    };
  }
}

/** Singleton idempotency cache with 24-hour TTL */
export const idempotencyCache = new LruMemoryCache<string>(
  10_000,
  24 * 60 * 60 * 1000,
);

// ---------------------------------------------------------------------------
// Compression utilities
// ---------------------------------------------------------------------------

function shouldCompress(data: string): boolean {
  return env.CACHE_COMPRESSION_ENABLED && data.length > COMPRESSION_THRESHOLD;
}

function compressValue(value: string): string {
  try {
    // Use Brotli for better compression ratio, fallback to gzip
    const compressed = brotliCompressSync(Buffer.from(value, "utf8"));
    return COMPRESSION_PREFIX_BROTLI + compressed.toString("base64");
  } catch {
    const compressed = gzipSync(Buffer.from(value, "utf8"));
    return COMPRESSION_PREFIX_GZIP + compressed.toString("base64");
  }
}

function decompressValue(value: string): string {
  if (value.startsWith(COMPRESSION_PREFIX_BROTLI)) {
    const data = Buffer.from(value.slice(COMPRESSION_PREFIX_BROTLI.length), "base64");
    return brotliDecompressSync(data).toString("utf8");
  }
  if (value.startsWith(COMPRESSION_PREFIX_GZIP)) {
    const data = Buffer.from(value.slice(COMPRESSION_PREFIX_GZIP.length), "base64");
    return gunzipSync(data).toString("utf8");
  }
  return value; // Uncompressed (backward compatible)
}

// ---------------------------------------------------------------------------
// In-memory LRU cache (async CacheService implementation)
// ---------------------------------------------------------------------------

const DEFAULT_MAX_SIZE = 500;

class AsyncLruMemoryCache implements CacheService {
  readonly backend = "memory" as const;
  readonly staleWhileRevalidate: boolean;

  private readonly store = new Map<string, CacheEntry<unknown>>();
  private readonly maxSize: number;
  private readonly swrMs: number;

  constructor(maxSize = DEFAULT_MAX_SIZE, swrMs = CACHE_SWR_MS) {
    this.maxSize = maxSize;
    this.swrMs = swrMs;
    this.staleWhileRevalidate = swrMs > 0;
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // LRU: move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.value as T;
  }

  async getWithMeta<T>(
    key: string,
  ): Promise<{ value: T; isStale: boolean } | null> {
    const entry = this.store.get(key);
    if (!entry) return null;

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }

    // LRU: move to end
    this.store.delete(key);
    this.store.set(key, entry);

    const isStale = entry.staleAt !== undefined && now > entry.staleAt;
    return { value: entry.value as T, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    // Evict oldest entry when at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }

    const now = Date.now();
    const staleAt =
      this.staleWhileRevalidate && ttlMs > this.swrMs
        ? now + (ttlMs - this.swrMs)
        : undefined;

    this.store.set(key, { value, expiresAt: now + ttlMs, staleAt });
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async flush(): Promise<void> {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Redis cache adapter (standalone, sentinel, cluster)
// ---------------------------------------------------------------------------

class RedisCache implements CacheService {
  readonly backend: "redis" | "cluster" | "sentinel";
  readonly staleWhileRevalidate: boolean;

  private readonly swrMs: number;
  private readonly isCluster: boolean;
  private readonly isSentinel: boolean;

  constructor(
    private readonly client: RedisClient | ClusterClient,
    swrMs = CACHE_SWR_MS,
    backendType: "redis" | "cluster" | "sentinel" = "redis",
  ) {
    this.swrMs = swrMs;
    this.staleWhileRevalidate = swrMs > 0;
    this.backend = backendType;
    this.isCluster = backendType === "cluster";
    this.isSentinel = backendType === "sentinel";
  }

  private async getClient(): Promise<RedisClient | ClusterClient> {
    return this.client;
  }

  async get<T>(key: string): Promise<T | null> {
    const start = Date.now();
    const client = await this.getClient();
    const raw = await client.get(key);
    metrics.recordCacheLatency("get", this.backend, (Date.now() - start) / 1000);
    if (raw === null) return null;
    const decompressed = decompressValue(raw);
    return JSON.parse(decompressed) as T;
  }

  async getWithMeta<T>(
    key: string,
  ): Promise<{ value: T; isStale: boolean } | null> {
    const start = Date.now();
    const client = await this.getClient();
    const [raw, ttlMs] = await Promise.all([
      client.get(key),
      client.pttl(key),
    ]);
    metrics.recordCacheLatency("get", this.backend, (Date.now() - start) / 1000);
    if (raw === null) return null;
    const decompressed = decompressValue(raw);
    const value = JSON.parse(decompressed) as T;
    const isStale =
      this.staleWhileRevalidate && ttlMs >= 0 && ttlMs < this.swrMs;
    return { value, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const start = Date.now();
    const client = await this.getClient();
    const json = JSON.stringify(value);
    const finalValue = shouldCompress(json) ? compressValue(json) : json;
    // PX = millisecond precision TTL
    await client.set(key, finalValue, "PX", ttlMs);
    metrics.recordCacheLatency("set", this.backend, (Date.now() - start) / 1000);
  }

  async delete(key: string): Promise<void> {
    const client = await this.getClient();
    await client.del(key);
  }

  async flush(): Promise<void> {
    const client = await this.getClient();
    if (this.isCluster) {
      // For cluster, flushall is not directly supported on all nodes
      // Use SCAN + DEL pattern
      const nodes = (client as ClusterClient).nodes("all");
      for (const node of nodes) {
        await node.flushdb();
      }
    } else {
      await client.flushdb();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — builds the right backend, falls back to memory on Redis failure
// ---------------------------------------------------------------------------

let _cache: CacheService | null = null;

function buildRedisClient(): RedisClient | ClusterClient | null {
  const redisUrl = process.env.REDIS_URL;
  const sentinelHosts = process.env.REDIS_SENTINEL_HOSTS;
  const clusterNodes = process.env.REDIS_CLUSTER_NODES;

  const Redis = require("ioredis") as typeof import("ioredis").default;

  // Redis Sentinel configuration
  if (sentinelHosts) {
    const sentinels = sentinelHosts.split(",").map((host) => {
      const [h, p] = host.trim().split(":");
      return { host: h, port: parseInt(p || "26379", 10) };
    });
    const masterName = process.env.REDIS_SENTINEL_MASTER_NAME || "mymaster";
    logger.info({ sentinels, masterName }, "Initializing Redis Sentinel client");
    return new Redis({
      sentinels,
      name: masterName,
      role: "master",
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 100, 3000);
      },
    });
  }

  // Redis Cluster configuration
  if (clusterNodes) {
    const nodes = clusterNodes.split(",").map((node) => {
      const [h, p] = node.trim().split(":");
      return { host: h, port: parseInt(p || "6379", 10) };
    });
    const maxRedirections = parseInt(process.env.REDIS_CLUSTER_MAX_REDIRECTIONS || "16", 10);
    logger.info({ nodes }, "Initializing Redis Cluster client");
    return new Redis.Cluster(nodes, {
      maxRedirections,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 100, 3000);
      },
    });
  }

  // Standalone Redis
  if (redisUrl) {
    logger.info({ url: redisUrl }, "Initializing standalone Redis client");
    return new Redis(redisUrl, {
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
      retryStrategy: (times: number) => {
        if (times > 10) return null;
        return Math.min(times * 100, 3000);
      },
    });
  }

  return null;
}

export function getCache(): CacheService {
  if (_cache) return _cache;

  const client = buildRedisClient();

  if (client) {
    try {
      let backendType: "redis" | "cluster" | "sentinel" = "redis";
      if (process.env.REDIS_SENTINEL_HOSTS) backendType = "sentinel";
      else if (process.env.REDIS_CLUSTER_NODES) backendType = "cluster";

      const handleError = (err: Error) => {
        logger.warn({ err: err.message, backend: backendType }, "Redis error — falling back to in-memory cache");
        if (_cache && (_cache.backend === "redis" || _cache.backend === "cluster" || _cache.backend === "sentinel")) {
          _cache = new AsyncLruMemoryCache();
        }
      };

      const handleConnect = () => {
        logger.info({ backend: backendType }, `Redis ${backendType} cache connected`);
      };

      const handleReconnecting = () => {
        logger.warn({ backend: backendType }, `Redis ${backendType} reconnecting...`);
      };

      client.on("error", handleError);
      client.on("connect", handleConnect);
      client.on("reconnecting", handleReconnecting);

      // For cluster, also listen to node events
      if (backendType === "cluster") {
        const clusterClient = client as ClusterClient;
        clusterClient.on("node error", handleError);
        clusterClient.on("node connect", handleConnect);
      }

      _cache = new RedisCache(client, CACHE_SWR_MS, backendType);
      logger.info({ backend: backendType }, `Cache backend: Redis ${backendType}`);
    } catch (err) {
      logger.warn({ err }, "Failed to initialise Redis — falling back to in-memory cache");
      _cache = new AsyncLruMemoryCache();
    }
  } else {
    _cache = new AsyncLruMemoryCache();
    logger.info("Cache backend: in-memory LRU (REDIS_URL not set)");
  }

  return _cache;
}

/**
 * Replace the active cache instance.
 * Exposed for testing and for the fallback swap on Redis errors.
 */
export function setCache(instance: CacheService): void {
  _cache = instance;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cache key from arbitrary request data.
 * Uses SHA-256 so key length is always fixed regardless of input size.
 */
export function buildCacheKey(data: Record<string, unknown>): string {
  const canonical = JSON.stringify(
    Object.keys(data)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = data[k];
        return acc;
      }, {}),
  );
  return createHash("sha256").update(canonical).digest("hex");
}