import { Request, Response, NextFunction } from "express";

import { ErrorCode } from "../../constants";
import { apiKeyAuth, requireScope } from "../apiKeyAuth";

function makeReq(
  path: string,
  headers: Record<string, string | undefined> = {},
): Request {
  return {
    path,
    headers,
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string> = {};
  const res = {
    setHeader: jest.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    _headers: headers,
  };
  return res as unknown as Response & { _headers: Record<string, string> };
}

describe("apiKeyAuth middleware", () => {
  const originalKeys = process.env.API_KEYS;

  afterEach(() => {
    if (originalKeys === undefined) {
      delete process.env.API_KEYS;
    } else {
      process.env.API_KEYS = originalKeys;
    }
  });

  it("allows requests when API_KEYS is unset or blank", () => {
    delete process.env.API_KEYS;
    const next: NextFunction = jest.fn();
    apiKeyAuth(makeReq("/simulate"), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);

    process.env.API_KEYS = "   ,  ";
    const next2: NextFunction = jest.fn();
    apiKeyAuth(makeReq("/simulate"), makeRes(), next2);
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it("exempts /health, /health/ready, and /openapi.json even when API_KEYS is set", () => {
    process.env.API_KEYS = "secret-key-1";

    for (const path of [
      "/health",
      "/health/live",
      "/health/ready",
      "/openapi.json",
    ]) {
      const next: NextFunction = jest.fn();
      apiKeyAuth(makeReq(path), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects missing credentials with 401, WWW-Authenticate, and UNAUTHORIZED code", () => {
    process.env.API_KEYS = "secret-key-1";
    const res = makeRes();
    const next: NextFunction = jest.fn();

    apiKeyAuth(makeReq("/simulate"), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._headers["www-authenticate"]).toBe("Bearer");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: "Unauthorized: missing or invalid API key",
      code: ErrorCode.UNAUTHORIZED,
    });
  });

  it("rejects non-Bearer authorization schemes and invalid keys", () => {
    process.env.API_KEYS = "secret-key-1, secret-key-2";

    const resBasic = makeRes();
    const nextBasic: NextFunction = jest.fn();
    apiKeyAuth(
      makeReq("/simulate", { authorization: "Basic c2VjcmV0LWtleS0x" }),
      resBasic,
      nextBasic,
    );
    expect(nextBasic).not.toHaveBeenCalled();
    expect(resBasic.status).toHaveBeenCalledWith(401);

    const resWrong = makeRes();
    const nextWrong: NextFunction = jest.fn();
    apiKeyAuth(
      makeReq("/simulate", { authorization: "Bearer wrong-key" }),
      resWrong,
      nextWrong,
    );
    expect(nextWrong).not.toHaveBeenCalled();
    expect(resWrong.status).toHaveBeenCalledWith(401);
  });

  it("accepts case-insensitive Bearer tokens across rotated keys", () => {
    process.env.API_KEYS = "primary-key, rotated-secondary-key";

    const next1: NextFunction = jest.fn();
    apiKeyAuth(
      makeReq("/simulate", { authorization: "Bearer primary-key" }),
      makeRes(),
      next1,
    );
    expect(next1).toHaveBeenCalledTimes(1);

    const next2: NextFunction = jest.fn();
    apiKeyAuth(
      makeReq("/simulate", { authorization: "bearer rotated-secondary-key" }),
      makeRes(),
      next2,
    );
    expect(next2).toHaveBeenCalledTimes(1);
  });

  it("accepts X-API-Key header for service-to-service clients", () => {
    process.env.API_KEYS = "service-key-abc";
    const next: NextFunction = jest.fn();

    apiKeyAuth(
      makeReq("/simulate", { "x-api-key": "service-key-abc" }),
      makeRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  describe("scoped API keys", () => {
    const originalConfig = process.env.API_KEYS_CONFIG;

    afterEach(() => {
      if (originalConfig === undefined) {
        delete process.env.API_KEYS_CONFIG;
      } else {
        process.env.API_KEYS_CONFIG = originalConfig;
      }
    });

    function setScopedKeys() {
      delete process.env.API_KEYS;
      process.env.API_KEYS_CONFIG = JSON.stringify({
        "sim-key": ["simulate:read", "simulate:batch"],
        "admin-key": ["admin:cache", "admin:metrics"],
        "readonly-key": ["simulate:read"],
      });
    }

    it("attaches scopes to the request for a valid scoped key", () => {
      setScopedKeys();
      const req = makeReq("/simulate", { authorization: "Bearer sim-key" });
      const next: NextFunction = jest.fn();

      apiKeyAuth(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect((req as unknown as { apiKeyScopes?: string[] }).apiKeyScopes).toEqual(
        ["simulate:read", "simulate:batch"],
      );
    });

    it("passes requireScope when the key holds the required scope", () => {
      setScopedKeys();
      const req = makeReq("/simulate", { authorization: "Bearer sim-key" });
      const next: NextFunction = jest.fn();
      const scopeNext: NextFunction = jest.fn();

      apiKeyAuth(req, makeRes(), next);
      requireScope("simulate:batch")(req, makeRes(), scopeNext);

      expect(next).toHaveBeenCalledTimes(1);
      expect(scopeNext).toHaveBeenCalledTimes(1);
    });

    it("returns 403 FORBIDDEN when the key lacks the required scope", () => {
      setScopedKeys();
      const req = makeReq("/cache", { authorization: "Bearer readonly-key" });
      const res = makeRes();
      const next: NextFunction = jest.fn();
      const scopeNext: NextFunction = jest.fn();

      apiKeyAuth(req, makeRes(), next);
      requireScope("admin:cache")(req, res, scopeNext);

      expect(next).toHaveBeenCalledTimes(1);
      expect(scopeNext).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Forbidden: missing required scope 'admin:cache'",
        code: ErrorCode.FORBIDDEN,
      });
    });

    it("rejects an invalid key with 401 even when scoped keys are configured", () => {
      setScopedKeys();
      const res = makeRes();
      const next: NextFunction = jest.fn();

      apiKeyAuth(
        makeReq("/simulate", { authorization: "Bearer unknown-key" }),
        res,
        next,
      );

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: "Unauthorized: missing or invalid API key",
        code: ErrorCode.UNAUTHORIZED,
      });
    });

    it("grants admin scopes only to admin keys", () => {
      setScopedKeys();
      const adminReq = makeReq("/cache", {
        authorization: "Bearer admin-key",
      });
      const adminNext: NextFunction = jest.fn();
      apiKeyAuth(adminReq, makeRes(), jest.fn());
      requireScope("admin:cache")(adminReq, makeRes(), adminNext);
      expect(adminNext).toHaveBeenCalledTimes(1);

      const simReq = makeReq("/cache", { authorization: "Bearer sim-key" });
      const simRes = makeRes();
      const simNext: NextFunction = jest.fn();
      apiKeyAuth(simReq, makeRes(), jest.fn());
      requireScope("admin:cache")(simReq, simRes, simNext);
      expect(simNext).not.toHaveBeenCalled();
      expect(simRes.status).toHaveBeenCalledWith(403);
    });

    it("still accepts legacy API_KEYS and treats them as unscoped", () => {
      delete process.env.API_KEYS_CONFIG;
      process.env.API_KEYS = "legacy-key";
      const req = makeReq("/simulate", { authorization: "Bearer legacy-key" });
      const next: NextFunction = jest.fn();

      apiKeyAuth(req, makeRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(
        (req as unknown as { apiKeyScopes?: string[] }).apiKeyScopes,
      ).toBeUndefined();
    });
  });
});
