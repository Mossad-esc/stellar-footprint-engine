import pino from "pino";

const STELLAR_SECRET_KEY_REGEX = /\bS[A-Z0-9]{55,}\b/g;

/**
 * Recursively scrubs Stellar secret keys (StrKey S...) from strings, Errors,
 * arrays, and plain objects before logging.
 */
export function scrubStellarSecretKeys<T>(
  input: T,
  seen: WeakSet<object> = new WeakSet(),
): T {
  if (typeof input === "string") {
    return input.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED]") as T;
  }
  if (input === null || typeof input !== "object") {
    return input;
  }
  if (seen.has(input)) {
    return input;
  }
  seen.add(input);

  if (input instanceof Error) {
    const scrubbedErr = new Error(
      input.message.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED]"),
    );
    scrubbedErr.name = input.name;
    if (input.stack) {
      scrubbedErr.stack = input.stack.replace(
        STELLAR_SECRET_KEY_REGEX,
        "[REDACTED]",
      );
    }
    return scrubbedErr as T;
  }

  if (Array.isArray(input)) {
    return input.map((item) => scrubStellarSecretKeys(item, seen)) as T;
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    out[k] = scrubStellarSecretKeys(v, seen);
  }
  return out as T;
}

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";
const isProduction = process.env.NODE_ENV === "production";

/**
 * Standard metadata injected into every log record.
 *
 * In production these fields satisfy ECS (Elastic Common Schema) and
 * Datadog log pipeline requirements:
 *   - service / version / env  → unified service tagging
 *   - commit                   → correlate logs to a specific build
 *
 * Timestamps are always emitted as ISO 8601 UTC (e.g. 2026-11-21T14:30:00.000Z)
 * via pino.stdTimeFunctions.isoTime so both ECS and Datadog ingest them without
 * a custom date parser.
 *
 * In development the logger pretty-prints to stdout so the terminal remains
 * human-readable.  In production it emits strict single-line JSON — one log
 * event per line — which is what CloudWatch and Datadog log agents expect.
 */

const baseFields = {
  service: "stellar-footprint-service",
  version: process.env.npm_package_version ?? "unknown",
  env: process.env.NODE_ENV ?? "development",
  commit: process.env.GIT_COMMIT ?? "unknown",
};

const productionOptions: pino.LoggerOptions = {
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  base: baseFields,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["authorization"]',
      "req.headers['authorization']",
      'req.headers["x-api-key"]',
      "req.headers['x-api-key']",
      "req.body.secretKey",
      "secretKey",
      "MAINNET_SECRET_KEY",
      "TESTNET_SECRET_KEY",
      "authorization",
      "x-api-key",
      "password",
    ],
    censor: "[REDACTED]",
  },
  hooks: {
    logMethod(inputArgs, method) {
      const scrubbedArgs = inputArgs.map((arg) => scrubStellarSecretKeys(arg));
      return method.apply(this, scrubbedArgs as Parameters<typeof method>);
    },
  },
};

const developmentOptions: pino.LoggerOptions = {
  ...productionOptions,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname,service,version,env,commit",
    },
  },
};

export const logger = isProduction
  ? pino(productionOptions)
  : pino(developmentOptions);
