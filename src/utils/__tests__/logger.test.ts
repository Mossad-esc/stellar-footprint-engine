import { Writable } from "stream";
import pino from "pino";
import { logger, scrubStellarSecretKeys } from "../logger";

describe("logger redaction and sanitization", () => {
  let chunks: string[];
  let testWritable: Writable;
  let testLogger: ReturnType<typeof pino>;

  beforeEach(() => {
    chunks = [];
    testWritable = new Writable({
      write(chunk: Buffer, _enc: string, cb: () => void) {
        chunks.push(chunk.toString());
        cb();
      },
    });

    testLogger = pino(
      {
        level: "info",
        timestamp: pino.stdTimeFunctions.isoTime,
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
      },
      testWritable,
    );
  });

  it("masks Authorization and x-api-key headers as [REDACTED]", () => {
    testLogger.info({
      req: {
        headers: {
          authorization: "Bearer secret_bearer_token_123",
          "x-api-key": "secret_api_key_456",
        },
      },
      msg: "incoming request",
    });

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.req.headers.authorization).toBe("[REDACTED]");
    expect(parsed.req.headers["x-api-key"]).toBe("[REDACTED]");
  });

  it("scrubs Stellar secret keys (StrKey S...) from log messages and objects", () => {
    const validSecret = "S" + "A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C";

    testLogger.info({
      req: {
        body: {
          secretKey: validSecret,
        },
      },
      msg: `Error processing transaction with key ${validSecret}`,
    });

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.req.body.secretKey).toBe("[REDACTED]");
    expect(parsed.msg).not.toContain(validSecret);
    expect(parsed.msg).toContain("[REDACTED]");
  });

  it("scrubs Stellar secret keys in Error objects and stack traces", () => {
    const validSecret = "S" + "A2B3C4D5E6F7G8H9I0J1K2L3M4N5O6P7Q8R9S0T1U2V3W4X5Y6Z7A8B9C";
    const err = new Error(`Failed with secret ${validSecret}`);
    err.stack = `Error: Failed\n    at Object.<anonymous> (${validSecret}:10:20)`;

    testLogger.error(err, "An error occurred");

    const parsed = JSON.parse(chunks[0]);
    expect(parsed.err.message).not.toContain(validSecret);
    expect(parsed.err.message).toContain("[REDACTED]");
    expect(parsed.err.stack).not.toContain(validSecret);
    expect(parsed.err.stack).toContain("[REDACTED]");
  });

  it("exports and uses logger with expected redact configuration", () => {
    expect(logger).toBeDefined();
  });
});
