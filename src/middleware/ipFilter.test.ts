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
    delete process.env.IP_DENYLIST;
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
  describe("IPv6 and edge cases", () => {
    const allowed = (ip: string): boolean => {
      const next = jest.fn();
      middleware(makeReq(ip), makeRes(), next);
      return next.mock.calls.length === 1;
    };

    it("matches IPv6 CIDR ranges on the allowlist", () => {
      process.env.IP_ALLOWLIST = "2001:db8::/32";
      load();
      expect(allowed("2001:db8:1::5")).toBe(true);
      expect(allowed("2001:db9::1")).toBe(false);
    });

    it("matches non-byte-aligned IPv6 prefixes", () => {
      process.env.IP_BLOCKLIST = "2001:db8::/33";
      load();
      expect(allowed("2001:db8:7fff::1")).toBe(false);
      expect(allowed("2001:db8:8000::1")).toBe(true);
    });

    it("supports mixed IPv4/IPv6 comma-separated lists with spaces", () => {
      process.env.IP_ALLOWLIST = " 10.0.0.0/8 , 2001:db8::/32 ,";
      load();
      expect(allowed("10.9.9.9")).toBe(true);
      expect(allowed("2001:db8::1")).toBe(true);
      expect(allowed("11.0.0.1")).toBe(false);
    });

    it("treats bare IPs as single hosts", () => {
      process.env.IP_BLOCKLIST = "1.2.3.4,::1";
      load();
      expect(allowed("1.2.3.4")).toBe(false);
      expect(allowed("1.2.3.5")).toBe(true);
      expect(allowed("::1")).toBe(false);
    });

    it("matches IPv4-mapped IPv6 clients against IPv4 ranges", () => {
      process.env.IP_BLOCKLIST = "10.0.0.0/8";
      load();
      expect(allowed("::ffff:10.1.2.3")).toBe(false);
      expect(allowed("::ffff:8.8.8.8")).toBe(true);
    });

    it("handles /8 /16 and /31 boundaries", () => {
      process.env.IP_ALLOWLIST = "172.16.0.0/16,192.0.2.0/31";
      load();
      expect(allowed("172.16.255.255")).toBe(true);
      expect(allowed("172.17.0.0")).toBe(false);
      expect(allowed("192.0.2.1")).toBe(true);
      expect(allowed("192.0.2.2")).toBe(false);
    });

    it("supports IP_DENYLIST as an alias of IP_BLOCKLIST", () => {
      process.env.IP_DENYLIST = "10.0.0.0/8";
      load();
      expect(allowed("10.0.0.1")).toBe(false);
      expect(allowed("11.0.0.1")).toBe(true);
    });

    it("lets the blocklist override the allowlist", () => {
      process.env.IP_ALLOWLIST = "10.0.0.0/8";
      process.env.IP_BLOCKLIST = "10.1.0.0/16";
      load();
      expect(allowed("10.1.2.3")).toBe(false);
      expect(allowed("10.2.2.3")).toBe(true);
    });
  });

  describe("invalid formats", () => {
    it.each([
      "10.0.0.0/33",
      "10.0.0.0/-1",
      "10.0.0.0/abc",
      "10.0.0.0/8/8",
      "999.1.1.1",
      "not-an-ip",
      "2001:db8::/129",
    ])("throws on invalid entry %s", (entry) => {
      process.env.IP_ALLOWLIST = entry;
      expect(load).toThrow(/Invalid IP_ALLOWLIST entry/);
    });

    it("denies requests with an unparseable client IP when an allowlist is set", () => {
      process.env.IP_ALLOWLIST = "10.0.0.0/8";
      load();
      const next = jest.fn();
      middleware(makeReq("garbage"), makeRes(), next);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("reverse proxy client IP", () => {
    const express = require("express") as typeof import("express");
    const http = require("http") as typeof import("http");

    const request = async (
      trustProxy: number,
      xff: string,
    ): Promise<number> => {
      process.env.IP_ALLOWLIST = "203.0.113.0/24";
      load();
      const app = express();
      app.set("trust proxy", trustProxy);
      app.use(middleware);
      app.get("/", (_req, res) => {
        res.sendStatus(200);
      });
      const server = http.createServer(app);
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const { port } = server.address() as import("net").AddressInfo;
      try {
        return await new Promise<number>((resolve, reject) => {
          http
            .get(
              { port, host: "127.0.0.1", headers: { "x-forwarded-for": xff } },
              (res) => {
                res.resume();
                resolve(res.statusCode ?? 0);
              },
            )
            .on("error", reject);
        });
      } finally {
        server.close();
      }
    };

    it("uses the X-Forwarded-For client IP when one proxy is trusted", async () => {
      expect(await request(1, "203.0.113.7")).toBe(200);
      expect(await request(1, "198.51.100.7")).toBe(403);
    });

    it("ignores a spoofed X-Forwarded-For prefix beyond the trusted hops", async () => {
      expect(await request(1, "203.0.113.7, 198.51.100.7")).toBe(403);
    });

    it("ignores X-Forwarded-For when no proxy is trusted", async () => {
      expect(await request(0, "203.0.113.7")).toBe(403);
    });
  });
});
