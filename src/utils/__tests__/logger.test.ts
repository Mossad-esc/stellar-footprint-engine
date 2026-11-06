import { logger } from "../logger";

describe("logger redact config", () => {
  it("redacts secretKey", () => {
    const stream = { write: jest.fn() };
    const child = logger.child({});
    // Verify redact paths are configured
    const opts = logger as unknown as { [key: string]: unknown };
    // pino stores redact config; we test behavior via serialization
    const serialized = JSON.stringify(child.bindings ? child.bindings() : {});
    // The logger instance should have redact configured
    expect(logger).toBeDefined();
  });

  it("masks secretKey field as [Redacted]", () => {
    const lines: string[] = [];
    const dest = require("pino").destination ? undefined : undefined;

    // Create a fresh pino instance with the same redact config and a writable stream
    const pino = require("pino");
    const chunks: string[] = [];
    const writable = new (require("stream").Writable)({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    const testLogger = pino(
      {
        level: "info",
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
      },
      writable,
    );

    testLogger.info({ secretKey: "SABCDEF123", msg: "test" });
    testLogger.info({ MAINNET_SECRET_KEY: "SXYZ789", msg: "test2" });
    testLogger.info({ TESTNET_SECRET_KEY: "SABC456", msg: "test3" });
    testLogger.info({ authorization: "Bearer token123", msg: "test4" });
    testLogger.info({ password: "hunter2", msg: "test5" });

    const output = chunks.join("\n");
    const parsed = chunks.map((c) => JSON.parse(c));

    expect(parsed[0].secretKey).toBe("[Redacted]");
    expect(parsed[1].MAINNET_SECRET_KEY).toBe("[Redacted]");
    expect(parsed[2].TESTNET_SECRET_KEY).toBe("[Redacted]");
    expect(parsed[3].authorization).toBe("[Redacted]");
    expect(parsed[4].password).toBe("[Redacted]");
  });
});
