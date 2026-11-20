import { Request, Response, NextFunction } from "express";

import { ErrorCode } from "../../constants";
import { AppError } from "../../utils/AppError";
import { errorHandler } from "../errorHandler";

function makeRes(requestId?: string) {
  const headers: Record<string, string> = {};
  return {
    set: jest.fn((k: string, v: string) => {
      headers[k] = v;
    }),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
    locals: { requestId },
    _headers: headers,
  } as unknown as Response & { _headers: Record<string, string> };
}

function makeReq(acceptLanguage?: string, accept?: string): Request {
  return {
    headers: {
      "accept-language": acceptLanguage,
      ...(accept !== undefined ? { accept } : {}),
    },
    path: "/test",
  } as unknown as Request;
}

const next: NextFunction = jest.fn();

describe("errorHandler", () => {
  it("returns 503 with Retry-After for circuit open errors", () => {
    const err = Object.assign(new Error("Circuit breaker is open"), {
      circuitOpen: true as const,
      retryAfter: 15,
    });
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.set).toHaveBeenCalledWith("Retry-After", "15");
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        code: ErrorCode.CIRCUIT_OPEN,
      }),
    );
  });

  it("translates circuit open message to Spanish", () => {
    const err = Object.assign(new Error("Circuit breaker is open"), {
      circuitOpen: true as const,
      retryAfter: 10,
    });
    const res = makeRes();
    errorHandler(err, makeReq("es"), res, next);

    expect(res.status).toHaveBeenCalledWith(503);
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error).toContain("temporalmente");
  });

  it("returns AppError status and message", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: "Missing required field: xdr",
        code: ErrorCode.MISSING_XDR,
      }),
    );
  });

  it("translates known AppError message to Spanish", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes();
    errorHandler(err, makeReq("es"), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.error).toBe("Campo requerido faltante: xdr");
  });

  it("returns 500 for generic errors", () => {
    const err = new Error("Something broke");
    const res = makeRes();
    errorHandler(err, makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: ErrorCode.INTERNAL_SERVER_ERROR,
        error: "Something broke",
      }),
    );
  });

  it("includes requestId in error response body when set (#340)", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes("test-request-id-123");
    errorHandler(err, makeReq(), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.requestId).toBe("test-request-id-123");
  });

  it("omits requestId when not set (#340)", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes(undefined);
    errorHandler(err, makeReq(), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.requestId).toBeUndefined();
  });

  it("includes requestId in circuit-open error response (#340)", () => {
    const err = Object.assign(new Error("Circuit breaker is open"), {
      circuitOpen: true as const,
      retryAfter: 10,
    });
    const res = makeRes("req-abc-456");
    errorHandler(err, makeReq(), res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.requestId).toBe("req-abc-456");
  });

  // ---------------------------------------------------------------------------
  // #41 — RFC 7807 problem+json
  // ---------------------------------------------------------------------------

  it("returns RFC 7807 problem+json when Accept header requests it", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes();
    const req = {
      headers: { accept: "application/problem+json" },
      path: "/simulate",
    } as unknown as Request;
    errorHandler(err, req, res, next);

    expect(res.set).toHaveBeenCalledWith(
      "Content-Type",
      "application/problem+json",
    );
    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.type).toBe(
      "https://docs.stellarfootprint.org/errors/MISSING_XDR",
    );
    expect(body.title).toBe("Missing XDR");
    expect(body.status).toBe(400);
    expect(body.detail).toBe("Missing required field: xdr");
    expect(body.instance).toBe("/simulate");
  });

  it("returns standard ResponseEnvelope for default application/json", () => {
    const err = new AppError("Missing required field: xdr", 400);
    const res = makeRes();
    const req = makeReq(); // no special Accept header
    errorHandler(err, req, res, next);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.type).toBeUndefined();
  });
});
