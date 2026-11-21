import pino from "pino";

const LOG_LEVEL = process.env.LOG_LEVEL ?? "info";

const STELLAR_SECRET_KEY_REGEX = /S[A-Z0-9]{55}/g;

export function scrubStellarSecretKeys(obj: unknown): unknown {
  if (typeof obj === "string") {
    return obj.replace(STELLAR_SECRET_KEY_REGEX, "[REDACTED]");
  }
  if (Array.isArray(obj)) {
    return obj.map(scrubStellarSecretKeys);
  }
  if (obj && typeof obj === "object" && obj !== null) {
    if (
      obj instanceof Date ||
      obj instanceof RegExp ||
      obj instanceof Error ||
      Buffer.isBuffer(obj)
    ) {
      if (obj instanceof Error) {
        const scrubbedErr = Object.create(Object.getPrototypeOf(obj));
        Object.assign(scrubbedErr, obj);
        if (obj.message) scrubbedErr.message = scrubStellarSecretKeys(obj.message);
        if (obj.stack) scrubbedErr.stack = scrubStellarSecretKeys(obj.stack);
        return scrubbedErr;
      }
      return obj;
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = scrubStellarSecretKeys(value);
    }
    return result;
  }
  return obj;
}

export const logger = pino({
  level: LOG_LEVEL,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  redact: {
    paths: [
      "req.headers.authorization",
      'req.headers["authorization"]',
      'req.headers[\'authorization\']',
      "req.headers[\"x-api-key\"]",
      'req.headers[\'x-api-key\']',
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
      return method.apply(this, scrubbedArgs as [any, ...any[]]);
    },
  },
});
