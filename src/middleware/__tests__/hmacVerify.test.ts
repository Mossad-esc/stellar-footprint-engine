/**
 * #342 — HMAC-SHA256 webhook signature verification tests
 */
import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

import {
  hmacVerify,
  WEBHOOK_SIGNATURE_HEADER,
  REQUEST_TIMESTAMP_HEADER,
  REQUEST_NONCE_HEADER,
  NONCE_TTL_SECONDS,
  MAX_TIMESTAMP_DRIFT_SECONDS,
} from "../hmacVerify";

const SECRET = "test-webhook-secret";
const BODY = { event: "simulate.complete", id: "abc123" };

// Mock the Redis client so tests never require a live server.
const mockSet = jest.fn();
jest.mock("../../lib/redis", () => ({
  __esModule: true,
  default: { set: (...args: unknown[]) => mockSet(...args) },
}));

function sign(body: object, secret: string): string {
  const raw = Buffer.from(JSON.stringify(body));
  return `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function makeReqRes(
  signature?: string,
  body: object = BODY,
  extraHeaders: Record<string, string> = {},
) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;

  const headers: Record<string, string> = { ...extraHeaders };
  if (signature) headers[WEBHOOK_SIGNATURE_HEADER] = signature;

  const req = {
    headers,
    body,
  } as unknown as Request;

  return { req, res };
}

function freshHeaders(overrides: Record<string, string> = {}) {
  return {
    [REQUEST_TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)),
    [REQUEST_NONCE_HEADER]: crypto.randomUUID(),
    ...overrides,
  };
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  mockSet.mockResolvedValue("OK");
  process.env.WEBHOOK_VERIFY_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_VERIFY_SECRET;
});

describe("hmacVerify (#342)", () => {
  it("calls next() for a valid signature with fresh timestamp and nonce", async () => {
    const { req, res } = makeReqRes(sign(BODY, SECRET), BODY, freshHeaders());
    await hmacVerify(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when signature header is missing", async () => {
    const { req, res } = makeReqRes(undefined, BODY, freshHeaders());
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Missing") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid signature", async () => {
    const { req, res } = makeReqRes(
      "sha256=invalidsignature",
      BODY,
      freshHeaders(),
    );
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Invalid") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when secret is not configured", async () => {
    delete process.env.WEBHOOK_VERIFY_SECRET;
    const { req, res } = makeReqRes(sign(BODY, SECRET), BODY, freshHeaders());
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("not configured"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is for a different secret", async () => {
    const { req, res } = makeReqRes(
      sign(BODY, "wrong-secret"),
      BODY,
      freshHeaders(),
    );
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe("hmacVerify replay protection (#86)", () => {
  it("returns 401 when timestamp header is missing", async () => {
    const headers = freshHeaders();
    delete (headers as Record<string, string>)[REQUEST_TIMESTAMP_HEADER];
    const { req, res } = makeReqRes(sign(BODY, SECRET), BODY, headers);
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining(REQUEST_TIMESTAMP_HEADER),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when nonce header is missing", async () => {
    const headers = freshHeaders();
    delete (headers as Record<string, string>)[REQUEST_NONCE_HEADER];
    const { req, res } = makeReqRes(sign(BODY, SECRET), BODY, headers);
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining(REQUEST_NONCE_HEADER),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for a stale timestamp (> 300s drift)", async () => {
    const stale = String(
      Math.floor(Date.now() / 1000) - MAX_TIMESTAMP_DRIFT_SECONDS - 1,
    );
    const { req, res } = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_TIMESTAMP_HEADER]: stale }),
    );
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("timestamp") }),
    );
    expect(next).not.toHaveBeenCalled();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("returns 401 for a timestamp too far in the future", async () => {
    const future = String(
      Math.floor(Date.now() / 1000) + MAX_TIMESTAMP_DRIFT_SECONDS + 1,
    );
    const { req, res } = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_TIMESTAMP_HEADER]: future }),
    );
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for a non-numeric timestamp", async () => {
    const { req, res } = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_TIMESTAMP_HEADER]: "not-a-number" }),
    );
    await hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("stores the nonce with SET NX and a 600s TTL", async () => {
    const nonce = crypto.randomUUID();
    const { req, res } = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_NONCE_HEADER]: nonce }),
    );
    await hmacVerify(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(
      expect.stringContaining(nonce),
      expect.anything(),
      "EX",
      NONCE_TTL_SECONDS,
      "NX",
    );
    expect(NONCE_TTL_SECONDS).toBe(600);
  });

  it("returns 401 when the nonce has already been seen (replay)", async () => {
    const nonce = crypto.randomUUID();
    // First request succeeds and claims the nonce.
    mockSet.mockResolvedValueOnce("OK");
    const first = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_NONCE_HEADER]: nonce }),
    );
    await hmacVerify(first.req, first.res, next);
    expect(next).toHaveBeenCalledTimes(1);

    // Second request with the same nonce: SET NX returns null.
    mockSet.mockResolvedValueOnce(null);
    const second = makeReqRes(
      sign(BODY, SECRET),
      BODY,
      freshHeaders({ [REQUEST_NONCE_HEADER]: nonce }),
    );
    await hmacVerify(second.req, second.res, next);
    expect(second.res.status).toHaveBeenCalledWith(401);
    expect(second.res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Replay") }),
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
