import pino from "pino";

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
      "secretKey",
      "MAINNET_SECRET_KEY",
      "TESTNET_SECRET_KEY",
      "authorization",
      "password",
    ],
    censor: "[Redacted]",
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
