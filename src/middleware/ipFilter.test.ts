import type { NextFunction, Request, Response } from "express";

const makeReq = (ip: string): Request =>
  ({ ip, socket: { remoteAddress: ip } }) as unknown as Request;

const makeRes = (): Response => {
  const res = {} as Response;
  (res as unknown as Record<string, unknown>).status = jest
    .fn()
    .mockReturnValue(res);
  (res as unknown as Record<string, unknown>).json = jest
    .fn()
    .mockReturnValue(res);
  return res;
};

describe("ipFilterMiddleware", () => {
  let middleware: (req: Request, res: Response, next: NextFunction) => void;

  const load = () => {
    jest.resetModules();
    middleware = require("./ipFilter").ipFilterMiddleware;
  };

  beforeEach(() => {
    delete process.env.IP_ALLOWLIST;
    delete process.env.IP_BLOCKLIST;
  });

  describe("no allowlist or blocklist configured", () => {
    beforeEach(load);

    it("allows all traffic", () => {
      const next = jest.fn();
      middleware(makeReq("1.2.3.4"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("allows private-range IPs", () => {
      const next = jest.fn();
      middleware(makeReq("192.168.0.1"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("blocked IP returns 403", () => {
    beforeEach(() => {
      process.env.IP_BLOCKLIST = "10.0.0.0/8";
      load();
    });

    it("returns 403 for an IP inside the blocklist CIDR", () => {
      const res = makeRes();
      const next = jest.fn();
      middleware(makeReq("10.1.2.3"), res, next);
      expect(
        (res as unknown as Record<string, jest.Mock>).status,
      ).toHaveBeenCalledWith(403);
      expect(
        (res as unknown as Record<string, jest.Mock>).json,
      ).toHaveBeenCalledWith({
        success: false,
        error: "Forbidden",
        code: "FORBIDDEN",
      });
      expect(next).not.toHaveBeenCalled();
    });

    it("allows an IP that is outside the blocklist CIDR", () => {
      const next = jest.fn();
      middleware(makeReq("172.16.0.1"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("allowed IP passes through", () => {
    beforeEach(() => {
      process.env.IP_ALLOWLIST = "10.0.0.0/8";
      load();
    });

    it("passes through an IP that is inside the allowlist CIDR", () => {
      const next = jest.fn();
      middleware(makeReq("10.5.6.7"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("blocks an IP that is not in the allowlist", () => {
      const res = makeRes();
      const next = jest.fn();
      middleware(makeReq("192.168.1.1"), res, next);
      expect(
        (res as unknown as Record<string, jest.Mock>).status,
      ).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("CIDR range matching", () => {
    it("correctly includes and excludes IPs at /24 subnet boundaries", () => {
      process.env.IP_ALLOWLIST = "192.168.1.0/24";
      load();

      const nextIn = jest.fn();
      const nextOut = jest.fn();

      middleware(makeReq("192.168.1.200"), makeRes(), nextIn);
      expect(nextIn).toHaveBeenCalledTimes(1);

      middleware(makeReq("192.168.2.1"), makeRes(), nextOut);
      expect(nextOut).not.toHaveBeenCalled();
    });

    it("correctly matches a /32 single-host CIDR on the blocklist", () => {
      process.env.IP_BLOCKLIST = "203.0.113.42/32";
      load();

      const nextBlocked = jest.fn();
      const nextAllowed = jest.fn();

      middleware(makeReq("203.0.113.42"), makeRes(), nextBlocked);
      expect(nextBlocked).not.toHaveBeenCalled();

      middleware(makeReq("203.0.113.43"), makeRes(), nextAllowed);
      expect(nextAllowed).toHaveBeenCalledTimes(1);
    });

    it("blocks all IPs when blocklist contains 0.0.0.0/0", () => {
      process.env.IP_BLOCKLIST = "0.0.0.0/0";
      load();
      const next = jest.fn();
      middleware(makeReq("8.8.8.8"), makeRes(), next);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
