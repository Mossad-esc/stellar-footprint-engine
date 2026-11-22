import { isIPv4, isIPv6 } from "net";

import { Request, Response, NextFunction } from "express";

import { ErrorCode } from "../constants";

function ipToInt(ip: string): number {
  return (
    ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0
  );
}

function ipv6ToBuffer(ip: string): Buffer {
  // Expand :: shorthand
  const halves = ip.split("::");
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  const buf = Buffer.alloc(16);
  groups.forEach((g, i) => buf.writeUInt16BE(parseInt(g || "0", 16), i * 2));
  return buf;
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  // Strip IPv4-mapped IPv6 prefix (e.g. ::ffff:192.168.1.1)
  if (trimmed.toLowerCase().startsWith("::ffff:") && isIPv4(trimmed.slice(7))) {
    return trimmed.slice(7);
  }
  return trimmed;
}

function parseCidrEntry(entry: string): { range: string; prefix: number } | null {
  const parts = entry.split("/");
  if (parts.length > 2) return null;
  const range = normalizeIp(parts[0] || "");
  const isV4 = isIPv4(range);
  const isV6 = isIPv6(range);
  if (!isV4 && !isV6) return null;

  const maxPrefix = isV4 ? 32 : 128;
  let prefix = maxPrefix;
  if (parts.length === 2) {
    if (!/^\d+$/.test(parts[1])) return null;
    prefix = parseInt(parts[1], 10);
    if (prefix < 0 || prefix > maxPrefix) return null;
  }
  return { range, prefix };
}

function matchesCidr(ip: string, cidr: string): boolean {
  const parsed = parseCidrEntry(cidr);
  if (!parsed) return false;
  const { range, prefix } = parsed;

  if (isIPv4(ip) && isIPv4(range)) {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
  }

  if (isIPv6(ip) && isIPv6(range)) {
    const ipBuf = ipv6ToBuffer(ip);
    const rangeBuf = ipv6ToBuffer(range);
    const fullBytes = Math.floor(prefix / 8);
    const remainBits = prefix % 8;
    for (let i = 0; i < fullBytes; i++) {
      if (ipBuf[i] !== rangeBuf[i]) return false;
    }
    if (remainBits > 0) {
      const mask = 0xff & (0xff << (8 - remainBits));
      if ((ipBuf[fullBytes] & mask) !== (rangeBuf[fullBytes] & mask))
        return false;
    }
    return true;
  }

  return false;
}

function parseCidrs(env: string | undefined): string[] {
  if (!env) return [];
  return env
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => parseCidrEntry(s) !== null);
}

const allowlist = parseCidrs(process.env.IP_ALLOWLIST);
const blocklist = [
  ...parseCidrs(process.env.IP_DENYLIST),
  ...parseCidrs(process.env.IP_BLOCKLIST),
];

const trustedProxyCount = (() => {
  const raw = process.env.TRUSTED_PROXY_COUNT;
  if (!raw) return 0;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
})();

function matchesAny(ip: string, cidrs: string[]): boolean {
  return cidrs.some((cidr) => matchesCidr(ip, cidr));
}

function getClientIp(req: Request): string {
  if (trustedProxyCount > 0) {
    const header = req.headers["x-forwarded-for"];
    const raw = Array.isArray(header) ? header.join(",") : header;
    if (raw) {
      const chain = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Take the (count+1)-th from the right: the first untrusted hop.
      const idx = chain.length - 1 - trustedProxyCount;
      if (idx >= 0 && idx < chain.length) {
        return normalizeIp(chain[idx]);
      }
    }
  }
  return normalizeIp(req.ip || req.socket.remoteAddress || "");
}

export function ipFilterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ip = getClientIp(req);

  if (blocklist.length > 0 && matchesAny(ip, blocklist)) {
    res.status(403).json({
      success: false,
      error: "Forbidden",
      code: ErrorCode.FORBIDDEN,
    });
    return;
  }

  if (allowlist.length > 0 && !matchesAny(ip, allowlist)) {
    res.status(403).json({
      success: false,
      error: "Forbidden",
      code: ErrorCode.FORBIDDEN,
    });
    return;
  }

  next();
}
