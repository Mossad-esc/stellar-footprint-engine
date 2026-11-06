/**
 * #342 — HMAC-SHA256 webhook signature verification tests
 */
import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

import { hmacVerify, WEBHOOK_SIGNATURE_HEADER } from "../hmacVerify";

const SECRET = "test-webhook-secret";
const BODY = { event: "simulate.complete", id: "abc123" };

function sign(body: object, secret: string): string {
  const raw = Buffer.from(JSON.stringify(body));
  return `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
}

function makeReqRes(signature?: string, body: object = BODY) {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  } as unknown as Response;

  const req = {
    headers: signature ? { [WEBHOOK_SIGNATURE_HEADER]: signature } : {},
    body,
  } as unknown as Request;

  return { req, res };
}

const next: NextFunction = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  process.env.WEBHOOK_VERIFY_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.WEBHOOK_VERIFY_SECRET;
});

describe("hmacVerify (#342)", () => {
  it("calls next() for a valid signature", () => {
    const { req, res } = makeReqRes(sign(BODY, SECRET));
    hmacVerify(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 when signature header is missing", () => {
    const { req, res } = makeReqRes(undefined);
    hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Missing") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid signature", () => {
    const { req, res } = makeReqRes("sha256=invalidsignature");
    hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining("Invalid") }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when secret is not configured", () => {
    delete process.env.WEBHOOK_VERIFY_SECRET;
    const { req, res } = makeReqRes(sign(BODY, SECRET));
    hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.stringContaining("not configured"),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when signature is for a different secret", () => {
    const { req, res } = makeReqRes(sign(BODY, "wrong-secret"));
    hmacVerify(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
