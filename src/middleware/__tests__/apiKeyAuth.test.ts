import { Request, Response, NextFunction } from "express";

import { ErrorCode } from "../../constants";
import { apiKeyAuth } from "../apiKeyAuth";

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
});
