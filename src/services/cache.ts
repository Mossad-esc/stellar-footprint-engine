import { createHash } from "crypto";
import * as v8 from "v8";

import metrics from "../middleware/metrics";
import { logger } from "../utils/logger";
import { env } from "../config/env";

// ioredis is lazy-loaded only when REDIS_URL is present to avoid the ~40ms
// module-parse cost during cold starts where Redis is not configured.
type RedisClient = import("ioredis").default;

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
  readonly backend: "redis" | "memory";
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
// Redis cache adapter
// ---------------------------------------------------------------------------

class RedisCache implements CacheService {
  readonly backend = "redis" as const;
  readonly staleWhileRevalidate: boolean;

  private readonly swrMs: number;
  private readonly tagPrefix = "tag:contract:";

  constructor(
    private readonly client: RedisClient,
    swrMs = CACHE_SWR_MS,
  ) {
    this.swrMs = swrMs;
    this.staleWhileRevalidate = swrMs > 0;
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
    return JSON.parse(raw) as T;
  }

  async getWithMeta<T>(
    key: string,
  ): Promise<{ value: T; isStale: boolean } | null> {
    const start = Date.now();
    const [raw, ttlMs] = await Promise.all([
      this.client.get(key),
      this.client.pttl(key),
    ]);
    metrics.recordCacheLatency("get", "redis", (Date.now() - start) / 1000);
    if (raw === null) {
      metrics.recordCacheOperation("redis", "get", "miss");
      return null;
    }
    const value = JSON.parse(raw) as T;
    const isStale =
      this.staleWhileRevalidate && ttlMs >= 0 && ttlMs < this.swrMs;
    metrics.recordCacheOperation("redis", "get", isStale ? "hit" : "hit");
    return { value, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const start = Date.now();
    // PX = millisecond precision TTL
    await this.client.set(key, JSON.stringify(value), "PX", ttlMs);
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

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

// ---------------------------------------------------------------------------
// Factory — builds the right backend, falls back to memory on Redis failure
// ---------------------------------------------------------------------------

let _cache: CacheService | null = null;
let _reconnectTimer: NodeJS.Timeout | null = null;
let _reconnectAttempts = 0;

export function getCache(): CacheService {
  if (_cache) return _cache;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      const Redis = require("ioredis") as typeof import("ioredis").default;
      const client = new Redis(redisUrl, {
        connectTimeout: 2000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: false,
        retryStrategy: (times: number) => {
          if (times > 10) return null; // Stop retrying after 10 attempts
          const delay = Math.min(times * 100, 3000); // Exponential backoff capped at 3s
          return delay;
        },
      });

      const scheduleFallback = () => {
        logger.warn({ url: redisUrl }, "Redis unavailable — falling back to in-memory cache");
        if (_cache && _cache.backend === "redis") {
          _cache = new AsyncLruMemoryCache();
        }
      };

      client.on("error", (err: Error) => {
        logger.warn({ err: err.message }, "Redis error — falling back to in-memory cache");
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
        // The retryStrategy handles reconnection; we just log
      });

      // Auto-recover: when the client reconnects after an outage, restore the
      // Redis backend so subsequent writes go to Redis instead of memory.
      // The "ready" event fires after the initial connect and after every
      // successful reconnection (ioredis handles reconnection automatically).
      client.on("ready", () => {
        logger.info("Redis cache ready — restoring Redis backend");
        _cache = new RedisCache(client);
      });

      _cache = new RedisCache(client);
      logger.info({ url: redisUrl }, "Cache backend: Redis");
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

/**
 * Gracefully close the active cache backend (e.g. Redis socket) on shutdown.
 */
export async function closeCache(): Promise<void> {
  if (_cache instanceof RedisCache) {
    await _cache.close();
  }
  _cache = null;
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