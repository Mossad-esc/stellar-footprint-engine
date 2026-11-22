import Redis from "ioredis";

import { logger } from "../utils/logger";

export interface IpRecord {
  count: number;
  windowStart: number;
  blockedUntil?: number;
}

export interface CounterStore {
  get(key: string): Promise<IpRecord | null>;
  set(key: string, record: IpRecord, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
}

class InMemoryCounterStore implements CounterStore {
  private readonly store = new Map<string, IpRecord>();

  async get(key: string): Promise<IpRecord | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, record: IpRecord, _ttlMs: number): Promise<void> {
    this.store.set(key, record);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class RedisCounterStore implements CounterStore {
  private readonly prefix = "bf:";

  constructor(private readonly client: Redis) {}

  private prefixed(key: string): string {
    return this.prefix + key;
  }

  async get(key: string): Promise<IpRecord | null> {
    const raw = await this.client.get(this.prefixed(key));
    if (raw === null) return null;
    return JSON.parse(raw) as IpRecord;
  }

  async set(key: string, record: IpRecord, ttlMs: number): Promise<void> {
    await this.client.set(
      this.prefixed(key),
      JSON.stringify(record),
      "PX",
      ttlMs,
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefixed(key));
  }

  async close(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}

let _store: CounterStore | null = null;

export function getCounterStore(): CounterStore {
  if (_store) return _store;

  const redisUrl = process.env.BRUTE_FORCE_REDIS_URL || process.env.REDIS_URL;

  if (redisUrl) {
    try {
      const client = new Redis(redisUrl, {
        connectTimeout: 3000,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
        lazyConnect: false,
      });

      client.on("error", (err: Error) => {
        logger.warn(
          { err: err.message },
          "Redis counter store error — falling back to in-memory",
        );
        _store = new InMemoryCounterStore();
      });

      client.on("connect", () => {
        logger.info("Redis counter store connected");
      });

      client.on("reconnecting", () => {
        logger.warn("Redis counter store reconnecting…");
      });

      _store = new RedisCounterStore(client);
      logger.info("Counter store backend: Redis");
    } catch (err) {
      logger.warn(
        { err },
        "Failed to initialise Redis counter store — falling back to in-memory",
      );
      _store = new InMemoryCounterStore();
    }
  } else {
    _store = new InMemoryCounterStore();
    logger.info(
      "Counter store backend: in-memory (BRUTE_FORCE_REDIS_URL / REDIS_URL not set)",
    );
  }

  return _store;
}

/**
 * Gracefully close the active counter store Redis client on shutdown.
 */
export async function closeCounterStore(): Promise<void> {
  if (_store instanceof RedisCounterStore) {
    await _store.close();
  }
  _store = null;
}
