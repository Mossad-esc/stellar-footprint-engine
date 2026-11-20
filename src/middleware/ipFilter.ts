import { BlockList, isIPv4, isIPv6 } from "net";

import { Request, Response, NextFunction } from "express";

import { ErrorCode } from "../constants";

type IpFamily = "ipv4" | "ipv6";

/**
 * Parses a comma-separated list of IPs / CIDR ranges into a BlockList.
 * Bare addresses are treated as single-host ranges (/32 or /128).
 * Throws on malformed entries so a typo never silently weakens the filter.
 */
export function buildIpList(
  value: string | undefined,
  name = "IP list",
): BlockList | null {
  const entries = (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;

  const list = new BlockList();
  for (const entry of entries) {
    const [address, prefixStr, ...rest] = entry.split("/");
    const family: IpFamily | null = isIPv4(address)
      ? "ipv4"
      : isIPv6(address)
        ? "ipv6"
        : null;
    const maxPrefix = family === "ipv4" ? 32 : 128;
    const prefix =
      prefixStr === undefined
        ? maxPrefix
        : /^\d{1,3}$/.test(prefixStr)
          ? Number(prefixStr)
          : NaN;

    if (!family || rest.length > 0 || !(prefix >= 0 && prefix <= maxPrefix)) {
      throw new Error(`Invalid ${name} entry: "${entry}"`);
    }
    list.addSubnet(address, prefix, family);
  }
  return list;
}

function matches(list: BlockList, ip: string): boolean {
  if (isIPv4(ip)) return list.check(ip, "ipv4");
  if (isIPv6(ip)) return list.check(ip, "ipv6");
  return false;
}

// IP_DENYLIST is accepted as an alias of IP_BLOCKLIST.
const allowlist = buildIpList(process.env.IP_ALLOWLIST, "IP_ALLOWLIST");
const blocklist = buildIpList(
  [process.env.IP_BLOCKLIST, process.env.IP_DENYLIST].filter(Boolean).join(","),
  "IP_BLOCKLIST/IP_DENYLIST",
);

function forbid(res: Response): void {
  res.status(403).json({
    success: false,
    error: "Forbidden",
    code: ErrorCode.FORBIDDEN,
  });
}

/**
 * Filters requests by client IP. The client IP is taken from `req.ip`, which
 * Express derives from X-Forwarded-For only for hops covered by the `trust
 * proxy` setting (see TRUSTED_PROXY_COUNT in index.ts), so spoofed headers
 * from untrusted clients are ignored.
 */
export function ipFilterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ip = req.ip || req.socket.remoteAddress || "";

  if (blocklist && matches(blocklist, ip)) {
    forbid(res);
    return;
  }

  if (allowlist && !matches(allowlist, ip)) {
    forbid(res);
    return;
  }

  next();
}
