/**
 * #341 — ETag / Cache-Control / 304 caching headers tests
 * #39  — staticCacheMiddleware tests
 */
import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

import { httpCacheMiddleware, staticCacheMiddleware } from "../httpCache";

function makeReqRes(ifNoneMatch?: string) {
  const headers: Record<string, string | undefined> = {
    "if-none-match": ifNoneMatch,
  };
  const resHeaders: Record<string, string> = {};
  let statusCode = 200;

  const res = {
    statusCode,
    setHeader: jest.fn((k: string, v: string) => {
      resHeaders[k.toLowerCase()] = v;
    }),
    removeHeader: jest.fn(),
    status: jest.fn().mockImplementation((code: number) => {
      statusCode = code;
      res.statusCode = code;
      return res;
    }),
    end: jest.fn(),
    json: jest.fn().mockReturnThis(),
    _headers: resHeaders,
    get statusCodeValue() {
      return statusCode;
    },
  } as unknown as Response & { _headers: Record<string, string> };

  const req = {
    headers,
  } as unknown as Request;

  return { req, res, resHeaders };
}

describe("httpCacheMiddleware (#341)", () => {
  it("sets ETag and Cache-Control on 200 responses", () => {
    const { req, res, resHeaders } = makeReqRes();
    const next: NextFunction = jest.fn();

    httpCacheMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();

    // Simulate the controller calling res.json
    const body = { success: true, data: "test" };
    res.json(body);

    const payload = JSON.stringify(body);
    const expectedEtag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

    expect(resHeaders["etag"]).toBe(expectedEtag);
    expect(resHeaders["cache-control"]).toBe("public, max-age=60");
  });

  it("returns 304 when If-None-Match matches ETag", () => {
    const body = { success: true, data: "cached" };
    const payload = JSON.stringify(body);
    const etag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

    const { req, res } = makeReqRes(etag);
    const originalJsonMock = res.json;
    const next: NextFunction = jest.fn();

    httpCacheMiddleware(req, res, next);
    res.json(body);

    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.end).toHaveBeenCalled();
    // json should NOT have been called with the body (we short-circuit)
    expect(originalJsonMock).not.toHaveBeenCalled();
  });

  it("does not set Cache-Control on non-200 responses", () => {
    const { req, res, resHeaders } = makeReqRes();
    const next: NextFunction = jest.fn();

    res.statusCode = 400;
    httpCacheMiddleware(req, res, next);
    res.json({ error: "bad request" });

    expect(resHeaders["cache-control"]).toBeUndefined();
    expect(resHeaders["etag"]).toBeUndefined();
  });
});

describe("staticCacheMiddleware (#39)", () => {
  it("sets ETag and Cache-Control: public, max-age=3600 on 200 responses", () => {
    const { req, res, resHeaders } = makeReqRes();
    const next: NextFunction = jest.fn();

    staticCacheMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();

    const body = { networks: ["testnet", "mainnet"] };
    res.json(body);

    const payload = JSON.stringify(body);
    const expectedEtag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

    expect(resHeaders["etag"]).toBe(expectedEtag);
    expect(resHeaders["cache-control"]).toBe("public, max-age=3600");
  });

  it("returns 304 when If-None-Match matches ETag", () => {
    const body = { networks: ["testnet"] };
    const payload = JSON.stringify(body);
    const etag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

    const { req, res } = makeReqRes(etag);
    const originalJsonMock = res.json;
    const next: NextFunction = jest.fn();

    staticCacheMiddleware(req, res, next);
    res.json(body);

    expect(res.status).toHaveBeenCalledWith(304);
    expect(res.end).toHaveBeenCalled();
    expect(originalJsonMock).not.toHaveBeenCalled();
  });

  it("does not set cache headers on non-200 responses", () => {
    const { req, res, resHeaders } = makeReqRes();
    const next: NextFunction = jest.fn();

    res.statusCode = 500;
    staticCacheMiddleware(req, res, next);
    res.json({ error: "server error" });

    expect(resHeaders["cache-control"]).toBeUndefined();
    expect(resHeaders["etag"]).toBeUndefined();
  });
});
