import { jest } from "@jest/globals";
import express, { Express } from "express";
import request from "supertest";

import * as cacheModule from "../../services/cache";
import { rpcCircuitBreaker } from "../../utils/circuitBreaker";
import router from "../routes";

// Mock dependencies
jest.mock("../../services/cache");
jest.mock("../../utils/circuitBreaker");

describe("Health Endpoints", () => {
  let app: Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api", router);
    // Add error handler
    app.use(
      (
        err: Error,
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => {
        res.status(500).json({ error: err.message });
      },
    );
    jest.clearAllMocks();
  });

  describe("GET /api/health", () => {
    it("should return 200 with status ok (backward compatibility)", async () => {
      const response = await request(app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        version: expect.any(String),
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      });
    });
  });

  describe("GET /api/health/live", () => {
    it("should return 200 if process is running", async () => {
      const response = await request(app).get("/api/health/live");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        version: expect.any(String),
        uptime: expect.any(Number),
        timestamp: expect.any(String),
      });
    });

    it("should not check external dependencies", async () => {
      const getCacheSpy = jest.spyOn(cacheModule, "getCache");

      await request(app).get("/api/health/live");

      expect(getCacheSpy).not.toHaveBeenCalled();
    });
  });

  describe("GET /api/health/ready", () => {
    it("should return 200 when all checks pass", async () => {
      // Mock cache as healthy - store the value and return it
      let storedValue: string | null = null;
      const mockCache = {
        backend: "redis" as const,
        get: jest.fn().mockImplementation(() => Promise.resolve(storedValue)),
        set: jest.fn().mockImplementation((_key: string, value: string) => {
          storedValue = value;
          return Promise.resolve();
        }),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);

      // Mock circuit breaker as healthy
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "closed",
        failures: 0,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ready",
        checks: {
          cache: {
            status: "healthy",
            details: { backend: "redis" },
          },
          rpcCircuitBreaker: {
            status: "healthy",
            details: { state: "closed", failures: 0 },
          },
        },
        timestamp: expect.any(String),
      });
    });

    it("should return 503 when cache is unhealthy", async () => {
      // Mock cache as unhealthy
      const mockCache = {
        backend: "redis" as const,
        get: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        set: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);

      // Mock circuit breaker as healthy
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "closed",
        failures: 0,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "not ready",
        checks: {
          cache: {
            status: "unhealthy",
            details: { error: "Redis connection failed" },
          },
          rpcCircuitBreaker: {
            status: "healthy",
          },
        },
      });
    });

    it("should return 503 when circuit breaker is open", async () => {
      // Mock cache as healthy
      let storedValue: string | null = null;
      const mockCache = {
        backend: "memory" as const,
        get: jest.fn().mockImplementation(() => Promise.resolve(storedValue)),
        set: jest.fn().mockImplementation((_key: string, value: string) => {
          storedValue = value;
          return Promise.resolve();
        }),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);

      // Mock circuit breaker as open
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "open",
        failures: 5,
        retryAfter: 25,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "not ready",
        checks: {
          cache: {
            status: "healthy",
          },
          rpcCircuitBreaker: {
            status: "unhealthy",
            details: { state: "open", failures: 5, retryAfter: 25 },
          },
        },
      });
    });

    it("should return 503 when both checks fail", async () => {
      // Mock cache as unhealthy
      const mockCache = {
        backend: "redis" as const,
        get: jest.fn().mockRejectedValue(new Error("Connection timeout")),
        set: jest.fn().mockRejectedValue(new Error("Connection timeout")),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);

      // Mock circuit breaker as open
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "open",
        failures: 10,
        retryAfter: 30,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "not ready",
        checks: {
          cache: {
            status: "unhealthy",
          },
          rpcCircuitBreaker: {
            status: "unhealthy",
          },
        },
      });
    });

    it("should return 200 with degraded cache status when Redis is unhealthy but fallback is enabled", async () => {
      // Mock cache as unhealthy (Redis down) but fallback enabled
      const mockCache = {
        backend: "memory" as const,
        get: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        set: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);
      jest.spyOn(cacheModule, "isCacheFallbackEnabled").mockReturnValue(true);

      // Mock circuit breaker as healthy
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "closed",
        failures: 0,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ready",
        checks: {
          cache: {
            status: "degraded",
            details: { error: "Redis connection failed" },
          },
          rpcCircuitBreaker: {
            status: "healthy",
          },
        },
      });
    });

    it("should return 503 when Redis is unhealthy and fallback is disabled", async () => {
      // Mock cache as unhealthy (Redis down) with fallback disabled
      const mockCache = {
        backend: "redis" as const,
        get: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        set: jest.fn().mockRejectedValue(new Error("Redis connection failed")),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);
      jest.spyOn(cacheModule, "isCacheFallbackEnabled").mockReturnValue(false);

      // Mock circuit breaker as healthy
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "closed",
        failures: 0,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(503);
      expect(response.body).toMatchObject({
        status: "not ready",
        checks: {
          cache: {
            status: "unhealthy",
            details: { error: "Redis connection failed" },
          },
          rpcCircuitBreaker: {
            status: "healthy",
          },
        },
      });
    });

    it("should consider half-open circuit breaker as healthy", async () => {
      // Mock cache as healthy
      let storedValue: string | null = null;
      const mockCache = {
        backend: "memory" as const,
        get: jest.fn().mockImplementation(() => Promise.resolve(storedValue)),
        set: jest.fn().mockImplementation((_key: string, value: string) => {
          storedValue = value;
          return Promise.resolve();
        }),
        delete: jest.fn().mockResolvedValue(undefined),
        flush: jest.fn().mockResolvedValue(undefined),
      };
      jest.spyOn(cacheModule, "getCache").mockReturnValue(mockCache);

      // Mock circuit breaker as half-open
      (rpcCircuitBreaker.getState as jest.Mock).mockReturnValue({
        state: "half-open",
        failures: 3,
      });

      const response = await request(app).get("/api/health/ready");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ready",
        checks: {
          cache: {
            status: "healthy",
          },
          rpcCircuitBreaker: {
            status: "healthy",
            details: { state: "half-open", failures: 3 },
          },
        },
      });
    });
  });
});
