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
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  CORS_ORIGIN: z.string().default(""),
  CORS_ALLOW_CREDENTIALS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export interface ParsedCorsOrigins {
  /** Exact origins, e.g. "https://app.example.com" */
  exactOrigins: string[];
  /** Compiled regexes for wildcard-subdomain patterns, e.g. https://*.stellar.org */
  patterns: RegExp[];
  /** Whether credentials (cookies / authorization headers) are allowed */
  allowCredentials: boolean;
}

/**
 * Escape a string for safe inclusion in a RegExp.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a wildcard-subdomain pattern (e.g. "https://*.stellar.org") into a
 * strict regex that only matches a single valid hostname label in place of the
 * wildcard. The wildcard never matches empty labels, dots, slashes or ports.
 */
export function compileOriginPattern(pattern: string): RegExp {
  const wildcardToken = "\u0000WILDCARD\u0000";
  const withToken = pattern.replace("*", wildcardToken);
  const escaped = escapeRegExp(withToken).replace(
    escapeRegExp(wildcardToken),
    "[a-z0-9](?:[a-z0-9-]*[a-z0-9])?",
  );
  return new RegExp(`^${escaped}$`, "i");
}

/**
 * Parse the CORS_ALLOWED_ORIGINS (or legacy CORS_ORIGIN) env value into exact
 * origins and compiled wildcard-subdomain regex patterns.
 */
export function parseCorsOrigins(
  rawOrigins: string,
  allowCredentials: boolean,
): ParsedCorsOrigins {
  const entries = rawOrigins
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const exactOrigins: string[] = [];
  const patterns: RegExp[] = [];

  for (const entry of entries) {
    if (entry === "*") {
      if (allowCredentials) {
        logger.warn(
          "CORS: wildcard '*' origin is not allowed when credentials are enabled; ignoring entry",
        );
        continue;
      }
      // Wildcard without credentials: allow any origin via a permissive pattern.
      exactOrigins.push("*");
      continue;
    }

    if (entry.includes("*")) {
      patterns.push(compileOriginPattern(entry));
      continue;
    }

    exactOrigins.push(entry.replace(/\/+$/, ""));
  }

  return { exactOrigins, patterns, allowCredentials };
}

/**
 * Resolve the effective CORS configuration from a validated env config.
 * Falls back to the legacy CORS_ORIGIN variable when CORS_ALLOWED_ORIGINS is unset.
 */
export function getCorsConfig(config: EnvConfig): ParsedCorsOrigins {
  const rawOrigins =
    config.CORS_ALLOWED_ORIGINS.trim().length > 0
      ? config.CORS_ALLOWED_ORIGINS
      : config.CORS_ORIGIN;
  return parseCorsOrigins(rawOrigins, config.CORS_ALLOW_CREDENTIALS);
}

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