import type { NextFunction, Request, Response } from "express";

import { ErrorCode } from "../constants";

/**
 * Token Bucket rate limiter.
 *
 * Each client (keyed by IP by default) owns a bucket with a maximum capacity
 * (burst allowance) and a steady refill rate. Tokens are refilled
 * continuously based on elapsed time, so bursts up to `capacity` are allowed
 * while the long-term rate is bounded by `refillRatePerSec`.
 *
 * State is kept in Redis and updated atomically via a Lua script. If Redis is
 * unavailable, the limiter transparently falls back to an in-memory bucket.
 */

export interface TokenBucketConfig {
  /** Maximum number of tokens (max burst). */
  capacity: number;
  /** Tokens added per second. */
  refillRatePerSec: number;
  /** Optional key prefix to namespace buckets per tier. */
  keyPrefix?: string;
}

export interface TokenBucketResult {
  allowed: boolean;
  /** Remaining tokens after this request (floored). */
  remaining: number;
  /** Bucket capacity. */
  limit: number;
  /** Epoch seconds when the bucket will be full again. */
  resetAt: number;
  /** Seconds until at least one token is available (0 when allowed). */
  retryAfter: number;
}

interface RedisLike {
  eval(
    script: string,
    numKeys: number,
    ...args: (string | number)[]
  ): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Redis client resolution
// ---------------------------------------------------------------------------

let cachedRedis: RedisLike | null | undefined;

function resolveRedis(): RedisLike | null {
  if (cachedRedis !== undefined) {
    return cachedRedis;
  }
  try {
    // Lazily require to avoid a hard dependency / circular imports.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("../config/redis");
    const candidate =
      mod?.redisClient ?? mod?.redis ?? mod?.default ?? mod?.client ?? null;
    cachedRedis =
      candidate && typeof candidate.eval === "function" ? candidate : null;
  } catch {
    cachedRedis = null;
  }
  return cachedRedis;
}

/** Test hook: override the resolved Redis client (pass null to force fallback). */
export function __setRedisClientForTests(client: RedisLike | null): void {
  cachedRedis = client;
}

// ---------------------------------------------------------------------------
// Lua script: atomic refill + consume
// ---------------------------------------------------------------------------

const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillRate = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local cost = tonumber(ARGV[4])
local ttlMs = tonumber(ARGV[5])

local data = redis.call('HMGET', key, 'tokens', 'timestamp')
local tokens = tonumber(data[1])
local lastMs = tonumber(data[2])

if tokens == nil or lastMs == nil then
  tokens = capacity
  lastMs = nowMs
end

local elapsedMs = nowMs - lastMs
if elapsedMs < 0 then
  elapsedMs = 0
end

tokens = tokens + (elapsedMs / 1000.0) * refillRate
if tokens > capacity then
  tokens = capacity
end

local allowed = 0
if tokens >= cost then
  tokens = tokens - cost
  allowed = 1
end

redis.call('HMSET', key, 'tokens', tokens, 'timestamp', nowMs)
redis.call('PEXPIRE', key, ttlMs)

return { allowed, tostring(tokens) }
`;

// ---------------------------------------------------------------------------
// In-memory fallback
// ---------------------------------------------------------------------------

interface MemoryBucket {
  tokens: number;
  lastMs: number;
}

const memoryBuckets = new Map<string, MemoryBucket>();

/** Test hook: clear in-memory buckets. */
export function __resetMemoryBucketsForTests(): void {
  memoryBuckets.clear();
}

function consumeMemory(
  key: string,
  config: TokenBucketConfig,
  nowMs: number,
  cost: number,
): TokenBucketResult {
  const { capacity, refillRatePerSec } = config;
  let bucket = memoryBuckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastMs: nowMs };
    memoryBuckets.set(key, bucket);
  }

  const elapsedMs = Math.max(0, nowMs - bucket.lastMs);
  bucket.tokens = Math.min(
    capacity,
    bucket.tokens + (elapsedMs / 1000) * refillRatePerSec,
  );
  bucket.lastMs = nowMs;

  let allowed = false;
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    allowed = true;
  }

  return buildResult(allowed, bucket.tokens, config, nowMs);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResult(
  allowed: boolean,
  tokens: number,
  config: TokenBucketConfig,
  nowMs: number,
): TokenBucketResult {
  const { capacity, refillRatePerSec } = config;
  const remaining = Math.max(0, Math.floor(tokens));

  // Time until the bucket is full again.
  const missing = Math.max(0, capacity - tokens);
  const secondsToFull =
    refillRatePerSec > 0 ? missing / refillRatePerSec : Number.POSITIVE_INFINITY;
  const resetAt = Number.isFinite(secondsToFull)
    ? Math.ceil(nowMs / 1000 + secondsToFull)
    : Math.ceil(nowMs / 1000);

  let retryAfter = 0;
  if (!allowed) {
    const missingForOne = Math.max(0, 1 - tokens);
    retryAfter =
      refillRatePerSec > 0
        ? Math.max(1, Math.ceil(missingForOne / refillRatePerSec))
        : 1;
  }

  return { allowed, remaining, limit: capacity, resetAt, retryAfter };
}

function bucketKey(config: TokenBucketConfig, req: Request): string {
  const prefix = config.keyPrefix ?? "ratelimit:tb";
  const ip =
    (req.ip && req.ip.length > 0 && req.ip) ||
    req.socket?.remoteAddress ||
    "unknown";
  return `${prefix}:${ip}`;
}

function ttlMsFor(config: TokenBucketConfig): number {
  // Keep state long enough for a full refill from empty.
  const refillMs =
    config.refillRatePerSec > 0
      ? (config.capacity / config.refillRatePerSec) * 1000
      : 60_000;
  return Math.max(60_000, Math.ceil(refillMs) + 60_000);
}

/**
 * Consume a token from the bucket identified by `key`.
 * Uses Redis when available, otherwise the in-memory fallback.
 */
export async function consumeToken(
  key: string,
  config: TokenBucketConfig,
  cost = 1,
  nowMs: number = Date.now(),
): Promise<TokenBucketResult> {
  const redis = resolveRedis();
  if (redis) {
    try {
      const raw = await redis.eval(
        TOKEN_BUCKET_LUA,
        1,
        key,
        config.capacity,
        config.refillRatePerSec,
        nowMs,
        cost,
        ttlMsFor(config),
      );
      if (Array.isArray(raw) && raw.length >= 2) {
        const allowed = Number(raw[0]) === 1;
        const tokens = Number(raw[1]);
        return buildResult(allowed, tokens, config, nowMs);
      }
    } catch {
      // Fall through to in-memory on any Redis error.
    }
  }
  return consumeMemory(key, config, nowMs, cost);
}

function setHeaders(res: Response, result: TokenBucketResult): void {
  res.setHeader("X-RateLimit-Limit", String(result.limit));
  res.setHeader("X-RateLimit-Remaining", String(result.remaining));
  res.setHeader("X-RateLimit-Reset", String(result.resetAt));
}

function sendRateLimited(res: Response, result: TokenBucketResult): void {
  const retryAfter = result.retryAfter > 0 ? result.retryAfter : 1;
  res.setHeader("Retry-After", String(retryAfter));
  res.status(429).json({
    success: false,
    error: "Too Many Requests",
    code: ErrorCode.RATE_LIMIT_EXCEEDED,
    message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
    retryAfter,
  });
}

/**
 * Create an Express middleware enforcing a token bucket for the given tier.
 */
export function createTokenBucketLimiter(config: TokenBucketConfig) {
  return async function tokenBucketLimiter(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const key = bucketKey(config, req);
    let result: TokenBucketResult;
    try {
      result = await consumeToken(key, config);
    } catch {
      // Never block traffic due to limiter failures.
      next();
      return;
    }

    setHeaders(res, result);

    if (!result.allowed) {
      sendRateLimited(res, result);
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const parsed = parseInt(process.env[name] || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envFloat(name: string, fallback: number): number {
  const parsed = parseFloat(process.env[name] || "");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const DEFAULT_CAPACITY = envInt("RATE_LIMIT_CAPACITY", 60);
const DEFAULT_REFILL_RATE = envFloat("RATE_LIMIT_REFILL_RATE_PER_SEC", 1);

export const simulateRateLimiter = createTokenBucketLimiter({
  capacity: envInt("RATE_LIMIT_SIMULATE_CAPACITY", DEFAULT_CAPACITY),
  refillRatePerSec: envFloat(
    "RATE_LIMIT_SIMULATE_REFILL_RATE_PER_SEC",
    DEFAULT_REFILL_RATE,
  ),
  keyPrefix: "ratelimit:tb:simulate",
});

export const decodeRateLimiter = createTokenBucketLimiter({
  capacity: envInt("RATE_LIMIT_DECODE_CAPACITY", DEFAULT_CAPACITY),
  refillRatePerSec: envFloat(
    "RATE_LIMIT_DECODE_REFILL_RATE_PER_SEC",
    DEFAULT_REFILL_RATE,
  ),
  keyPrefix: "ratelimit:tb:decode",
});

export const feeRateLimiter = createTokenBucketLimiter({
  capacity: envInt("RATE_LIMIT_FEE_CAPACITY", DEFAULT_CAPACITY),
  refillRatePerSec: envFloat(
    "RATE_LIMIT_FEE_REFILL_RATE_PER_SEC",
    DEFAULT_REFILL_RATE,
  ),
  keyPrefix: "ratelimit:tb:fee",
});
