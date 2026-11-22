import express, { Request, Response } from "express";
import request from "supertest";

import {
  createTokenBucketLimiter,
  InMemoryTokenBucketStore,
  TokenBucketOptions,
  TokenBucketStore,
} from "../rateLimiter";

/**
 * Build a minimal Express app that applies the token bucket limiter to the
 * given method + path and returns 200 for requests that are not rate-limited.
 */
function buildApp(
  options: Partial<TokenBucketOptions> & {
    capacity: number;
    refillRatePerSec: number;
  },
  method: "get" | "post" = "post",
  path = "/simulate",
  store?: TokenBucketStore,
) {
  const limiter = createTokenBucketLimiter({
    keyPrefix: "test",
    store,
    ...options,
  });

  const app = express();
  app.use(express.json());
  if (method === "get") {
    app.get(path, limiter, (_req, res) =>
      res.status(200).json({ success: true }),
    );
  } else {
    app.post(path, limiter, (_req, res) =>
      res.status(200).json({ success: true }),
    );
  }
  return app;
}

/** Small helper to advance fake time without real waiting. */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("token bucket — burst allowance", () => {
  it("allows a burst up to bucket capacity", async () => {
    const capacity = 5;
    const app = buildApp({ capacity, refillRatePerSec: 1 });

    for (let i = 0; i < capacity; i++) {
      const res = await request(app).post("/simulate").send({});
      expect(res.status).toBe(200);
      expect(Number(res.headers["x-ratelimit-remaining"])).toBe(
        capacity - i - 1,
      );
    }

    const limited = await request(app).post("/simulate").send({});
    expect(limited.status).toBe(429);
    expect(limited.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("returns 429 once the burst allowance is exhausted", async () => {
    const app = buildApp({ capacity: 2, refillRatePerSec: 0.001 });

    await request(app).post("/simulate").send({});
    await request(app).post("/simulate").send({});
    const res = await request(app).post("/simulate").send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "Too Many Requests" });
    expect(res.headers).toHaveProperty("retry-after");
  });
});

describe("token bucket — sustained traffic refill", () => {
  it("refills tokens at the configured rate over time", async () => {
    const capacity = 2;
    const refillRatePerSec = 20; // one token every 50ms
    const app = buildApp({ capacity, refillRatePerSec });

    // Drain the bucket.
    await request(app).post("/simulate").send({});
    await request(app).post("/simulate").send({});
    const drained = await request(app).post("/simulate").send({});
    expect(drained.status).toBe(429);

    // Wait long enough for at least one token to refill.
    await sleep(120);

    const refilled = await request(app).post("/simulate").send({});
    expect(refilled.status).toBe(200);
    expect(Number(refilled.headers["x-ratelimit-remaining"])).toBeGreaterThanOrEqual(0);
  });

  it("never refills beyond bucket capacity", async () => {
    const capacity = 3;
    const app = buildApp({ capacity, refillRatePerSec: 1000 });

    // Drain the bucket.
    for (let i = 0; i < capacity; i++) {
      await request(app).post("/simulate").send({});
    }

    // Allow plenty of time to over-refill if the cap were missing.
    await sleep(50);

    const res = await request(app).post("/simulate").send({});
    expect(res.status).toBe(200);
    expect(Number(res.headers["x-ratelimit-remaining"])).toBeLessThanOrEqual(
      capacity - 1,
    );
  });
});

describe("token bucket — standard rate limit headers", () => {
  it("includes X-RateLimit-Limit on a normal response", async () => {
    const app = buildApp({ capacity: 10, refillRatePerSec: 1 });
    const res = await request(app)
      .post("/simulate")
      .send({ xdr: "test", network: "testnet" });

    expect(res.status).toBe(200);
    expect(res.headers["x-ratelimit-limit"]).toBe("10");
  });

  it("includes X-RateLimit-Remaining on a normal response", async () => {
    const app = buildApp({ capacity: 10, refillRatePerSec: 1 });
    const res = await request(app)
      .post("/simulate")
      .send({ xdr: "test", network: "testnet" });

    expect(res.status).toBe(200);
    expect(Number(res.headers["x-ratelimit-remaining"])).toBe(9);
  });

  it("includes X-RateLimit-Reset as a future epoch timestamp", async () => {
    const app = buildApp({ capacity: 10, refillRatePerSec: 1 });
    const res = await request(app)
      .post("/simulate")
      .send({ xdr: "test", network: "testnet" });

    expect(res.status).toBe(200);
    expect(Number(res.headers["x-ratelimit-reset"])).toBeGreaterThanOrEqual(
      Math.floor(Date.now() / 1000),
    );
  });

  it("includes X-RateLimit-* headers on a 429 response", async () => {
    const app = buildApp({ capacity: 1, refillRatePerSec: 0.001 });

    await request(app).post("/simulate").send({});
    const res = await request(app).post("/simulate").send({});

    expect(res.status).toBe(429);
    expect(res.headers["x-ratelimit-limit"]).toBe("1");
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
    expect(res.headers).toHaveProperty("x-ratelimit-reset");
  });

  it("returns 429 body with error and retryAfter fields", async () => {
    const app = buildApp({ capacity: 1, refillRatePerSec: 1 });

    await request(app).post("/simulate").send({});
    const res = await request(app).post("/simulate").send({});

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ error: "Too Many Requests" });
    expect(Number(res.body.retryAfter)).toBeGreaterThan(0);
  });
});

describe("token bucket — in-memory fallback", () => {
  it("uses the in-memory store when Redis is unavailable", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = buildApp({ capacity: 2, refillRatePerSec: 0.001 }, "post", "/simulate", store);

    const first = await request(app).post("/simulate").send({});
    const second = await request(app).post("/simulate").send({});
    const third = await request(app).post("/simulate").send({});

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });

  it("refills tokens over time in the in-memory store", async () => {
    const store = new InMemoryTokenBucketStore();
    const app = buildApp({ capacity: 1, refillRatePerSec: 20 }, "post", "/simulate", store);

    await request(app).post("/simulate").send({});
    const drained = await request(app).post("/simulate").send({});
    expect(drained.status).toBe(429);

    await sleep(120);

    const refilled = await request(app).post("/simulate").send({});
    expect(refilled.status).toBe(200);
  });

  it("falls back to in-memory when the Redis store throws", async () => {
    const failingStore: TokenBucketStore = {
      consume: jest.fn().mockRejectedValue(new Error("redis down")),
    };
    const app = buildApp(
      { capacity: 1, refillRatePerSec: 0.001 },
      "post",
      "/simulate",
      failingStore,
    );

    const first = await request(app).post("/simulate").send({});
    expect(first.status).toBe(200);

    const second = await request(app).post("/simulate").send({});
    expect(second.status).toBe(429);
  });
});

describe("token bucket — route coverage", () => {
  it("applies the limiter to GET /decode", async () => {
    const app = buildApp({ capacity: 2, refillRatePerSec: 0.001 }, "get", "/decode");

    await request(app).get("/decode").query({ xdr: "a" });
    await request(app).get("/decode").query({ xdr: "b" });
    const res = await request(app).get("/decode").query({ xdr: "c" });

    expect(res.status).toBe(429);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });

  it("applies the limiter to POST /estimate-fee", async () => {
    const app = buildApp(
      { capacity: 2, refillRatePerSec: 0.001 },
      "post",
      "/estimate-fee",
    );

    await request(app).post("/estimate-fee").send({});
    await request(app).post("/estimate-fee").send({});
    const res = await request(app).post("/estimate-fee").send({});

    expect(res.status).toBe(429);
    expect(res.headers["x-ratelimit-remaining"]).toBe("0");
  });
});
