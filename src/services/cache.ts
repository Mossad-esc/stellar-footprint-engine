import { createHash } from "crypto";

import metrics from "../middleware/metrics";
import { logger } from "../utils/logger";

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
// Redis cache adapter
// ---------------------------------------------------------------------------

class RedisCache implements CacheService {
  readonly backend = "redis" as const;
  readonly staleWhileRevalidate: boolean;

  private readonly swrMs: number;

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
    if (raw === null) return null;
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
    if (raw === null) return null;
    const value = JSON.parse(raw) as T;
    const isStale =
      this.staleWhileRevalidate && ttlMs >= 0 && ttlMs < this.swrMs;
    return { value, isStale };
  }

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const start = Date.now();
    // PX = millisecond precision TTL
    await this.client.set(key, JSON.stringify(value), "PX", ttlMs);
    metrics.recordCacheLatency("set", "redis", (Date.now() - start) / 1000);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  async flush(): Promise<void> {
    await this.client.flushdb();
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

export function getCache(): CacheService {
  if (_cache) return _cache;

  const redisUrl = process.env.REDIS_URL;

  if (redisUrl) {
    try {
      const Redis = require("ioredis") as typeof import("ioredis").default;
      const client = new Redis(redisUrl, {
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: false,
      });

      client.on("error", (err: Error) => {
        logger.warn(
          { err: err.message },
          "Redis error — falling back to in-memory cache",
        );
        _cache = new AsyncLruMemoryCache();
      });

      client.on("connect", () => {
        logger.info("Redis cache connected");
      });

      client.on("reconnecting", () => {
        logger.warn("Redis reconnecting…");
      });

      _cache = new RedisCache(client);
      logger.info({ url: redisUrl }, "Cache backend: Redis");
    } catch (err) {
      logger.warn(
        { err },
        "Failed to initialise Redis — falling back to in-memory cache",
      );
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
