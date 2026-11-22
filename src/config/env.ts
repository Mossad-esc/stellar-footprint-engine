import { z } from "zod";

import { logger } from "../utils/logger";

export const EnvSchema = z.object({
  MAINNET_RPC_URL: z
    .string()
    .url()
    .default("https://mainnet.stellar.validationcloud.io/v1/placeholder"),
  TESTNET_RPC_URL: z
    .string()
    .url()
    .default("https://soroban-testnet.stellar.org"),
  FUTURENET_RPC_URL: z
    .string()
    .url()
    .default("https://rpc-futurenet.stellar.org:443"),
  MAINNET_SECRET_KEY: z.string().default(""),
  TESTNET_SECRET_KEY: z.string().default(""),
  FUTURENET_SECRET_KEY: z.string().default(""),
  NETWORK: z.enum(["mainnet", "testnet", "futurenet"]).default("testnet"),
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  SIMULATE_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  COMPRESSION_THRESHOLD: z.coerce.number().int().nonnegative().default(1024),
  RPC_POOL_TTL_MS: z.coerce.number().int().positive().default(300000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  CACHE_MAX_SIZE: z.coerce.number().int().positive().default(500),
  CACHE_HEAP_SAFETY_THRESHOLD: z.coerce.number().min(0.5).max(0.95).default(0.85),
  CACHE_EMERGENCY_TRIM_RATIO: z.coerce.number().min(0.1).max(0.5).default(0.25),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  DECODE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  DECODE_RATE_LIMIT_WINDOW_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(60000),
  FEE_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
  FEE_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  BATCH_CONCURRENCY: z.coerce.number().int().positive().default(5),
  BATCH_MAX_SIZE: z.coerce.number().int().positive().default(10),
  API_KEYS_CONFIG: z.string().default(""),
  API_KEYS: z.string().default(""),
  WEBHOOK_SECRET: z.string().default(""),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function validateEnv(raw: NodeJS.ProcessEnv): EnvConfig {
  const result = EnvSchema.safeParse(raw);

  if (result.success) {
    return result.data;
  }

  // In production, log and exit on any validation failure
  if (raw["NODE_ENV"] === "production") {
    const lines = result.error.issues.map(
      (issue) => `  ${String(issue.path[0])}: ${issue.message}`,
    );
    logger.error(["Environment validation failed:", ...lines].join("\n"));
    process.exit(1);
  }

  // In dev/test, warn and use defaults
  logger.warn(
    "Environment validation warnings (using defaults for invalid values)",
  );
  const stripped = { ...raw };
  for (const issue of result.error.issues) {
    delete stripped[issue.path[0] as string];
  }
  return EnvSchema.parse(stripped);
}

export const env: EnvConfig = validateEnv(process.env);

/**
 * Parse the configured API keys into a Map of key -> scopes.
 *
 * Primary source is `API_KEYS_CONFIG`, a JSON object mapping each API key to
 * an array of scopes, e.g.:
 *   {"key-abc": ["simulate:read", "simulate:batch"], "key-admin": ["admin:cache"]}
 *
 * Legacy `API_KEYS` (comma-separated list of keys) is supported as a fallback
 * and yields unscoped keys (empty scope array).
 */
export function parseApiKeysConfig(
  config: EnvConfig = env,
): Map<string, string[]> {
  const keys = new Map<string, string[]>();

  const rawConfig = config.API_KEYS_CONFIG?.trim();
  if (rawConfig) {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [key, scopes] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (!key) continue;
          const scopeList = Array.isArray(scopes)
            ? scopes.filter((s): s is string => typeof s === "string")
            : typeof scopes === "string"
              ? scopes
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [];
          keys.set(key, scopeList);
        }
      } else {
        logger.warn(
          "API_KEYS_CONFIG must be a JSON object mapping keys to scope arrays",
        );
      }
    } catch (err) {
      logger.warn(
        `Failed to parse API_KEYS_CONFIG: ${(err as Error).message}`,
      );
    }
  }

  const legacyKeys = config.API_KEYS?.trim();
  if (legacyKeys) {
    for (const key of legacyKeys.split(",")) {
      const trimmed = key.trim();
      if (trimmed && !keys.has(trimmed)) {
        keys.set(trimmed, []);
      }
    }
  }

  return keys;
}