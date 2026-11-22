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
    delete process.env.TRUSTED_PROXY_COUNT;
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

    it("includes the network and broadcast addresses of a /24", () => {
      process.env.IP_ALLOWLIST = "192.168.1.0/24";
      load();

      const nextNetwork = jest.fn();
      const nextBroadcast = jest.fn();

      middleware(makeReq("192.168.1.0"), makeRes(), nextNetwork);
      expect(nextNetwork).toHaveBeenCalledTimes(1);

      middleware(makeReq("192.168.1.255"), makeRes(), nextBroadcast);
      expect(nextBroadcast).toHaveBeenCalledTimes(1);
    });

    it("matches the exact host of a /32 on the allowlist", () => {
      process.env.IP_ALLOWLIST = "198.51.100.7/32";
      load();

      const nextIn = jest.fn();
      const nextOut = jest.fn();

      middleware(makeReq("198.51.100.7"), makeRes(), nextIn);
      expect(nextIn).toHaveBeenCalledTimes(1);

      middleware(makeReq("198.51.100.6"), makeRes(), nextOut);
      expect(nextOut).not.toHaveBeenCalled();
    });
  });

  describe("IPv6 CIDR matching", () => {
    it("allows an IPv6 address inside an allowlist CIDR", () => {
      process.env.IP_ALLOWLIST = "2001:db8::/32";
      load();

      const nextIn = jest.fn();
      const nextOut = jest.fn();

      middleware(makeReq("2001:db8:abcd::1"), makeRes(), nextIn);
      expect(nextIn).toHaveBeenCalledTimes(1);

      middleware(makeReq("2001:db9::1"), makeRes(), nextOut);
      expect(nextOut).not.toHaveBeenCalled();
    });

    it("blocks an IPv6 address inside a denylist CIDR", () => {
      process.env.IP_DENYLIST = "2001:db8::/32";
      load();

      const nextBlocked = jest.fn();
      const nextAllowed = jest.fn();

      middleware(makeReq("2001:db8::42"), makeRes(), nextBlocked);
      expect(nextBlocked).not.toHaveBeenCalled();

      middleware(makeReq("2001:db9::42"), makeRes(), nextAllowed);
      expect(nextAllowed).toHaveBeenCalledTimes(1);
    });

    it("matches an IPv4-mapped IPv6 address against an IPv4 CIDR", () => {
      process.env.IP_DENYLIST = "10.0.0.0/8";
      load();

      const next = jest.fn();
      middleware(makeReq("::ffff:10.1.2.3"), makeRes(), next);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("invalid CIDR formats", () => {
    it("ignores invalid entries in the allowlist", () => {
      process.env.IP_ALLOWLIST = "not-an-ip, 10.0.0.0/8, 999.999.999.999/24";
      load();

      const nextIn = jest.fn();
      const nextOut = jest.fn();

      middleware(makeReq("10.1.1.1"), makeRes(), nextIn);
      expect(nextIn).toHaveBeenCalledTimes(1);

      middleware(makeReq("8.8.8.8"), makeRes(), nextOut);
      expect(nextOut).not.toHaveBeenCalled();
    });

    it("ignores invalid entries in the denylist", () => {
      process.env.IP_DENYLIST = "garbage, 2001:db8::/129";
      load();

      const next = jest.fn();
      middleware(makeReq("8.8.8.8"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("allows all traffic when every configured entry is invalid", () => {
      process.env.IP_ALLOWLIST = "nope, also-nope";
      load();

      const next = jest.fn();
      middleware(makeReq("1.2.3.4"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("comma-separated mixed lists", () => {
    it("supports mixed IPv4 and IPv6 entries in the allowlist", () => {
      process.env.IP_ALLOWLIST = "10.0.0.0/8, 2001:db8::/32, 192.168.1.0/24";
      load();

      const nextV4 = jest.fn();
      const nextV6 = jest.fn();
      const nextOut = jest.fn();

      middleware(makeReq("10.9.9.9"), makeRes(), nextV4);
      expect(nextV4).toHaveBeenCalledTimes(1);

      middleware(makeReq("2001:db8::5"), makeRes(), nextV6);
      expect(nextV6).toHaveBeenCalledTimes(1);

      middleware(makeReq("172.16.0.1"), makeRes(), nextOut);
      expect(nextOut).not.toHaveBeenCalled();
    });

    it("supports mixed entries in the denylist", () => {
      process.env.IP_DENYLIST = "10.0.0.0/8, 2001:db8::/32";
      load();

      const nextV4 = jest.fn();
      const nextV6 = jest.fn();
      const nextAllowed = jest.fn();

      middleware(makeReq("10.0.0.1"), makeRes(), nextV4);
      expect(nextV4).not.toHaveBeenCalled();

      middleware(makeReq("2001:db8::1"), makeRes(), nextV6);
      expect(nextV6).not.toHaveBeenCalled();

      middleware(makeReq("8.8.8.8"), makeRes(), nextAllowed);
      expect(nextAllowed).toHaveBeenCalledTimes(1);
    });
  });

  describe("IP_DENYLIST env var", () => {
    beforeEach(() => {
      process.env.IP_DENYLIST = "203.0.113.0/24";
      load();
    });

    it("blocks an IP inside the denylist CIDR", () => {
      const res = makeRes();
      const next = jest.fn();
      middleware(makeReq("203.0.113.10"), res, next);
      expect(
        (res as unknown as Record<string, jest.Mock>).status,
      ).toHaveBeenCalledWith(403);
      expect(next).not.toHaveBeenCalled();
    });

    it("allows an IP outside the denylist CIDR", () => {
      const next = jest.fn();
      middleware(makeReq("203.0.114.10"), makeRes(), next);
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe("X-Forwarded-For handling with TRUSTED_PROXY_COUNT", () => {
    const makeProxyReq = (
      socketIp: string,
      forwardedFor: string,
    ): Request =>
      ({
        ip: socketIp,
        socket: { remoteAddress: socketIp },
        headers: { "x-forwarded-for": forwardedFor },
      }) as unknown as Request;

    it("uses the leftmost client IP when a single trusted proxy is configured", () => {
      process.env.TRUSTED_PROXY_COUNT = "1";
      process.env.IP_DENYLIST = "10.0.0.0/8";
      load();

      const next = jest.fn();
      middleware(makeProxyReq("127.0.0.1", "10.1.2.3, 127.0.0.1"), makeRes(), next);
      expect(next).not.toHaveBeenCalled();
    });

    it("ignores spoofed leftmost entries beyond the trusted proxy count", () => {
      process.env.TRUSTED_PROXY_COUNT = "1";
      process.env.IP_DENYLIST = "10.0.0.0/8";
      load();

      const next = jest.fn();
      middleware(
        makeProxyReq("127.0.0.1", "10.1.2.3, 203.0.113.5, 127.0.0.1"),
        makeRes(),
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
    });

    it("falls back to the socket address when no forwarded header is present", () => {
      process.env.TRUSTED_PROXY_COUNT = "1";
      process.env.IP_DENYLIST = "10.0.0.0/8";
      load();

      const next = jest.fn();
      middleware(makeReq("10.5.5.5"), makeRes(), next);
      expect(next).not.toHaveBeenCalled();
    });
  });
});
