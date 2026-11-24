import { createHash } from "crypto";
import * as v8 from "v8";

import metrics from "../middleware/metrics";
import { logger } from "../utils/logger";
import { env } from "../config/env";
import { CACHE_SCHEMA_VERSION, cacheKeyPrefix } from "../constants";

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
  /** Estimated size in bytes */
  sizeBytes?: number;
  /** Contract IDs touched by this cached simulation (for tag invalidation) */
  contractIds?: string[];
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
  /**
   * Invalidate all cache entries associated with a contract ID.
   * Returns the number of entries invalidated.
   */
  invalidateContractCache(contractId: string): Promise<number>;
}

const COMPRESSION_PREFIX_GZIP = "__gz:";
const COMPRESSION_PREFIX_BROTLI = "__br:";
const COMPRESSION_THRESHOLD = env.CACHE_COMPRESSION_THRESHOLD;

/**
 * Whether the service may fall back to in-memory caching when Redis is
 * unreachable. Defaults to true in development and false in strict prod.
 */
export const ALLOW_CACHE_FALLBACK: boolean =
  process.env.ALLOW_CACHE_FALLBACK !== undefined
    ? process.env.ALLOW_CACHE_FALLBACK === "true"
    : env.NODE_ENV !== "production";

/** Health status of the Redis backend. */
export type RedisHealthStatus = "healthy" | "unhealthy" | "disabled";

export interface CacheHealth {
  backend: CacheService["backend"];
  redis: RedisHealthStatus;
  fallbackEnabled: boolean;
  schemaVersion: string;
}

let _redisHealth: RedisHealthStatus = "disabled";

/** Returns the current cache/Redis health snapshot for readiness checks. */
export function getCacheHealth(): CacheHealth {
  const backend = _cache ? _cache.backend : "memory";
  return {
    backend,
    redis: _redisHealth,
    fallbackEnabled: ALLOW_CACHE_FALLBACK,
    schemaVersion: CACHE_SCHEMA_VERSION,
  };
}

/** Marks the Redis backend healthy/unhealthy (used by event listeners). */
export function setRedisHealth(status: RedisHealthStatus): void {
  _redisHealth = status;
}

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
  private readonly tagIndex = new Map<string, Set<string>>(); // contractId -> Set<cacheKey>
  private readonly maxSize: number;
  private readonly swrMs: number;
  private let estimatedTotalBytes = 0;

  constructor(maxSize = DEFAULT_MAX_SIZE, swrMs = CACHE_SWR_MS) {
    this.maxSize = maxSize;
    this.swrMs = swrMs;
    this.staleWhileRevalidate = swrMs > 0;
  }

  private approxSize(value: unknown): number {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  }

  private updateMetrics(): void {
    metrics.recordMemoryCacheKeys(this.store.size);
    metrics.recordMemoryCacheBytes(this.estimatedTotalBytes);
  }

  private maybeEmergencyTrim(): void {
    const heapStats = v8.getHeapStatistics();
    const used = heapStats.used_heap_size;
    const limit = heapStats.heap_size_limit;
    const ratio = limit > 0 ? used / limit : 0;

    if (ratio >= env.CACHE_HEAP_SAFETY_THRESHOLD) {
      const targetRemovals = Math.ceil(this.store.size * env.CACHE_EMERGENCY_TRIM_RATIO);
      let removed = 0;
      for (const key of this.store.keys()) {
        this.evictEntry(key);
        removed++;
        if (removed >= targetRemovals) break;
      }
      metrics.recordEmergencyTrim();
      logger.warn(
        { heapRatio: ratio, removed, remaining: this.store.size },
        "Emergency cache trim triggered due to heap pressure",
      );
    }
  }

  private evictEntry(key: string): void {
    const entry = this.store.get(key);
    if (entry) {
      if (entry.sizeBytes) this.estimatedTotalBytes -= entry.sizeBytes;
      if (entry.contractIds) {
        for (const cid of entry.contractIds) {
          const set = this.tagIndex.get(cid);
          if (set) {
            set.delete(key);
            if (set.size === 0) this.tagIndex.delete(cid);
          }
        }
      }
    }
    this.store.delete(key);
    metrics.recordCacheEviction("memory");
  }

  async get<T>(key: string): Promise<T | null> {
    this.maybeEmergencyTrim();

    const entry = this.store.get(key);
    if (!entry) {
      metrics.recordCacheOperation("memory", "get", "miss");
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.evictEntry(key);
      metrics.recordCacheOperation("memory", "get", "miss");
      return null;
    }

    // LRU: move to end (most recently used)
    this.store.delete(key);
    this.store.set(key, entry);

    metrics.recordCacheOperation("memory", "get", "hit");
    this.updateMetrics();
    return entry.value as T;
  }

  async getWithMeta<T>(
    key: string,
  ): Promise<{ value: T; isStale: boolean } | null> {
    const entry = this.store.get(key);
    if (!entry) {
      metrics.recordCacheOperation("memory", "get", "miss");
      return null;
    }

    const now = Date.now();
    if (now > entry.expiresAt) {
      this.evictEntry(key);
      metrics.recordCacheOperation("memory", "get", "miss");
      return null;
    }

    // LRU: move to end
    this.store.delete(key);
    this.store.set(key, entry);

    const isStale = entry.staleAt !== undefined && now > entry.staleAt;
    metrics.recordCacheOperation("memory", "get", isStale ? "hit" : "hit");
    this.updateMetrics();
    return { value: entry.value as T, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    this.maybeEmergencyTrim();

    // Evict oldest entry when at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.evictEntry(oldest);
    }

    const now = Date.now();
    const staleAt =
      this.staleWhileRevalidate && ttlMs > this.swrMs
        ? now + (ttlMs - this.swrMs)
        : undefined;

    const sizeBytes = this.approxSize(value);
    const contractIds = this.extractContractIds(value);

    // Remove old entry if exists to update size tracking
    if (this.store.has(key)) {
      this.evictEntry(key);
    }

    this.estimatedTotalBytes += sizeBytes;
    this.store.set(key, { value, expiresAt: now + ttlMs, staleAt, sizeBytes, contractIds });

    // Update tag index
    for (const cid of contractIds) {
      let set = this.tagIndex.get(cid);
      if (!set) {
        set = new Set();
        this.tagIndex.set(cid, set);
      }
      set.add(key);
    }

    metrics.recordCacheOperation("memory", "set", "success");
    this.updateMetrics();
  }

  private extractContractIds(value: unknown): string[] {
    try {
      const obj = value as Record<string, unknown>;
      if (obj.footprint && typeof obj.footprint === "object") {
        const footprint = obj.footprint as Record<string, unknown>;
        const readOnly = (footprint.readOnly as unknown[]) || [];
        const readWrite = (footprint.readWrite as unknown[]) || [];
        const contracts = new Set<string>();
        for (const entry of [...readOnly, ...readWrite]) {
          const e = entry as Record<string, unknown>;
          if (e.contractId && typeof e.contractId === "string") {
            contracts.add(e.contractId);
          }
        }
        return [...contracts];
      }
    } catch {
      // Ignore extraction errors
    }
    return [];
  }

  async delete(key: string): Promise<void> {
    this.evictEntry(key);
    metrics.recordCacheOperation("memory", "delete", "success");
    this.updateMetrics();
  }

  async flush(): Promise<void> {
    this.store.clear();
    this.tagIndex.clear();
    this.estimatedTotalBytes = 0;
    metrics.recordCacheOperation("memory", "flush", "success");
    this.updateMetrics();
  }

  async invalidateContractCache(contractId: string): Promise<number> {
    const keys = this.tagIndex.get(contractId);
    if (!keys || keys.size === 0) return 0;

    let count = 0;
    for (const key of keys) {
      this.evictEntry(key);
      count++;
    }
    this.tagIndex.delete(contractId);
    this.updateMetrics();
    return count;
  }
}

// ---------------------------------------------------------------------------
// Redis cache adapter (standalone, sentinel, cluster)
// ---------------------------------------------------------------------------

class RedisCache implements CacheService {
  readonly backend: "redis" | "cluster" | "sentinel";
  readonly staleWhileRevalidate: boolean;

  private readonly swrMs: number;
  private readonly tagPrefix = cacheKeyPrefix("tag:contract:");

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
    const raw = await this.client.get(key);
    metrics.recordCacheLatency("get", "redis", (Date.now() - start) / 1000);
    if (raw === null) {
      metrics.recordCacheOperation("redis", "get", "miss");
      return null;
    }
    metrics.recordCacheOperation("redis", "get", "hit");
    return JSON.parse(decompressValue(raw)) as T;
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
    metrics.recordCacheLatency("get", "redis", (Date.now() - start) / 1000);
    if (raw === null) {
      metrics.recordCacheOperation("redis", "get", "miss");
      return null;
    }
    const value = JSON.parse(decompressValue(raw)) as T;
    const isStale =
      this.staleWhileRevalidate && ttlMs >= 0 && ttlMs < this.swrMs;
    metrics.recordCacheOperation("redis", "get", isStale ? "hit" : "hit");
    return { value, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const start = Date.now();
    const client = await this.getClient();
    const json = JSON.stringify(value);
    const finalValue = shouldCompress(json) ? compressValue(json) : json;
    // PX = millisecond precision TTL
    await this.client.set(key, finalValue, "PX", ttlMs);
    metrics.recordCacheLatency("set", "redis", (Date.now() - start) / 1000);

    // Index contract IDs in Redis Sets
    const contractIds = this.extractContractIds(value);
    if (contractIds.length > 0) {
      const pipeline = this.client.pipeline();
      for (const cid of contractIds) {
        pipeline.sadd(`${this.tagPrefix}${cid}`, key);
        pipeline.expire(`${this.tagPrefix}${cid}`, Math.ceil(ttlMs / 1000) + 60);
      }
      await pipeline.exec();
    }
    metrics.recordCacheOperation("redis", "set", "success");
  }

  private extractContractIds(value: unknown): string[] {
    try {
      const obj = value as Record<string, unknown>;
      if (obj.footprint && typeof obj.footprint === "object") {
        const footprint = obj.footprint as Record<string, unknown>;
        const readOnly = (footprint.readOnly as unknown[]) || [];
        const readWrite = (footprint.readWrite as unknown[]) || [];
        const contracts = new Set<string>();
        for (const entry of [...readOnly, ...readWrite]) {
          const e = entry as Record<string, unknown>;
          if (e.contractId && typeof e.contractId === "string") {
            contracts.add(e.contractId);
          }
        }
        return [...contracts];
      }
    } catch {
      // Ignore extraction errors
    }
    return [];
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
    metrics.recordCacheOperation("redis", "delete", "success");
  }

  async flush(): Promise<void> {
    await this.client.flushdb();
    metrics.recordCacheOperation("redis", "flush", "success");
  }

  async invalidateContractCache(contractId: string): Promise<number> {
    const tagKey = `${this.tagPrefix}${contractId}`;
    const keys = await this.client.smembers(tagKey);
    if (!keys.length) return 0;

    const pipeline = this.client.pipeline();
    for (const key of keys) {
      pipeline.del(key);
    }
    pipeline.del(tagKey);
    await pipeline.exec();
    metrics.recordCacheEviction("redis");
    return keys.length;
  }

  /**
   * Scan and delete all keys belonging to a given schema version.
   * Uses SCAN (never KEYS) to avoid blocking the Redis server.
   */
  async flushVersion(version: string): Promise<number> {
    const match = `sfe:${version}:*`;
    let cursor = "0";
    let deleted = 0;
    do {
      const [next, found] = await this.client.scan(
        cursor,
        "MATCH",
        match,
        "COUNT",
        100,
      );
      cursor = next;
      if (found.length > 0) {
        const pipeline = this.client.pipeline();
        for (const key of found) pipeline.del(key);
        await pipeline.exec();
        deleted += found.length;
      }
    } while (cursor !== "0");
    return deleted;
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// Tiered cache: L1 in-memory LRU + L2 Redis (#47)
// ---------------------------------------------------------------------------

const L1_MAX_SIZE = 500;
const L1_TTL_MS = 15_000;
const L2_TTL_MS = 60_000;

export class TieredCache implements CacheService {
  readonly backend = "tiered" as const;
  readonly staleWhileRevalidate: boolean;

  private readonly l1: AsyncLruMemoryCache;
  private readonly l2: RedisCache | null;

  constructor(l1: AsyncLruMemoryCache, l2: RedisCache | null = null) {
    this.l1 = l1;
    this.l2 = l2;
    this.staleWhileRevalidate = l1.staleWhileRevalidate;
  }

  async get<T>(key: string): Promise<T | null> {
    const l1Hit = await this.l1.get<T>(key);
    if (l1Hit !== null) {
      metrics.recordL1Hit("simulation");
      return l1Hit;
    }
    metrics.recordL1Miss("simulation");

    if (this.l2) {
      const l2Hit = await this.l2.get<T>(key);
      if (l2Hit !== null) {
        metrics.recordL2Hit("simulation");
        await this.l1.set(key, l2Hit, L1_TTL_MS);
        return l2Hit;
      }
    }
    metrics.recordL2Miss("simulation");

    return null;
  }

  async getWithMeta<T>(
    key: string,
  ): Promise<{ value: T; isStale: boolean } | null> {
    const l1Hit = await this.l1.getWithMeta<T>(key);
    if (l1Hit) {
      metrics.recordL1Hit("simulation");
      return l1Hit;
    }
    metrics.recordL1Miss("simulation");

    if (this.l2) {
      const l2Hit = await this.l2.getWithMeta<T>(key);
      if (l2Hit) {
        metrics.recordL2Hit("simulation");
        await this.l1.set(key, l2Hit.value, L1_TTL_MS);
        return l2Hit;
      }
    }
    metrics.recordL2Miss("simulation");

    return null;
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    await this.l1.set(key, value, Math.min(ttlMs, L1_TTL_MS));
    if (this.l2) {
      await this.l2.set(key, value, Math.max(ttlMs, L2_TTL_MS));
    }
  }

  async delete(key: string): Promise<void> {
    this.l1.delete(key);
    if (this.l2) {
      await this.l2.delete(key);
    }
  }

  async flush(): Promise<void> {
    this.l1.flush();
    if (this.l2) {
      await this.l2.flush();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — builds the right backend, falls back to memory on Redis failure
// ---------------------------------------------------------------------------

let _cache: CacheService | null = null;
let _reconnectTimer: NodeJS.Timeout | null = null;
let _reconnectAttempts = 0;
let _redisClient: RedisClient | ClusterClient | null = null;

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

  const l1 = new AsyncLruMemoryCache(L1_MAX_SIZE, CACHE_SWR_MS);
  const client = buildRedisClient();

  if (client) {
    try {
      _redisClient = client;
      const backendType: "redis" | "cluster" | "sentinel" =
        process.env.REDIS_CLUSTER_NODES
          ? "cluster"
          : process.env.REDIS_SENTINEL_HOSTS
            ? "sentinel"
            : "redis";

      const l2 = new RedisCache(client, CACHE_SWR_MS, backendType);

      const scheduleFallback = () => {
        setRedisHealth("unhealthy");
        if (!ALLOW_CACHE_FALLBACK) {
          logger.error(
            "Redis unavailable and ALLOW_CACHE_FALLBACK is disabled — cache operations will fail",
          );
          return;
        }
        logger.warn(
          "Redis unavailable — falling back to L1-only cache",
        );
        if (!_cache || _cache.backend !== "tiered") {
          _cache = new TieredCache(l1);
        }
      };

      // Attach the error listener immediately so an unreachable host never
      // throws an unhandled 'error' event and crashes the Node process.
      client.on("error", (err: Error) => {
        logger.warn({ err: err.message }, "Redis error — marking cache unhealthy");
        scheduleFallback();
      });

      client.on("connect", () => {
        logger.info("Redis cache connected");
        _reconnectAttempts = 0;
        if (_reconnectTimer) {
          clearTimeout(_reconnectTimer);
          _reconnectTimer = null;
        }
      });

      client.on("reconnecting", () => {
        logger.warn({ attempt: _reconnectAttempts + 1 }, "Redis reconnecting...");
        _reconnectAttempts++;
      });

      client.on("close", () => {
        logger.warn("Redis connection closed — scheduling reconnect");
        setRedisHealth("unhealthy");
      });

      client.on("ready", () => {
        logger.info("Redis cache ready — restoring L2 backend");
        setRedisHealth("healthy");
        if (!_cache || _cache.backend !== "tiered") {
          _cache = new TieredCache(l1, l2);
        }
      });

      setRedisHealth("healthy");
      _cache = new TieredCache(l1, l2);
      logger.info({ backend: backendType }, "Cache backend: tiered (L1 memory + L2 Redis)");
    } catch (err) {
      logger.warn({ err }, "Failed to initialise Redis — falling back to L1-only cache");
      setRedisHealth("unhealthy");
      _cache = new TieredCache(l1);
    }
  } else {
    _cache = new TieredCache(l1);
    setRedisHealth("disabled");
    logger.info("Cache backend: L1 memory LRU (REDIS_URL not set)");
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

/**
 * Gracefully close the active cache backend (e.g. Redis socket) on shutdown.
 */
export async function closeCache(): Promise<void> {
  if (_cache instanceof RedisCache) {
    await _cache.close();
  }
  _redisClient = null;
  _cache = null;
  setRedisHealth("disabled");
}

/**
 * Scan and delete all keys belonging to a given schema version.
 * Used by the `cache:flush-version` CLI to purge obsolete namespaces.
 */
export async function flushCacheVersion(version: string): Promise<number> {
  if (!_redisClient) {
    logger.warn("flushCacheVersion called without an active Redis client");
    return 0;
  }
  const redis = new RedisCache(_redisClient);
  return redis.flushVersion(version);
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

/**
 * Build a schema-versioned cache key: `sfe:${CACHE_SCHEMA_VERSION}:sim:<hash>`.
 * Bumping CACHE_SCHEMA_VERSION isolates new entries from legacy shapes.
 */
export function buildVersionedCacheKey(data: Record<string, unknown>): string {
  return cacheKeyPrefix(`sim:${buildCacheKey(data)}`);
}