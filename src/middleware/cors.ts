import cors from "cors";
import type { CorsOptions } from "cors";
import type { RequestHandler } from "express";

const PREFLIGHT_MAX_AGE_SECONDS = 86400;

// One or more valid DNS labels followed by a dot (e.g. "app.", "a.b.")
const SUBDOMAIN_LABELS = "(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compiles a single allow-list entry into an anchored regex.
 * Supported forms:
 *  - exact origin:        https://app.example.com
 *  - wildcard subdomain:  https://*.stellar.org  (or "*.stellar.org", https only)
 * A bare "*" is never accepted.
 */
export function compileOriginPattern(entry: string): RegExp | null {
  const trimmed = entry.trim().toLowerCase();
  if (!trimmed || trimmed === "*") return null;

  const match = /^(?:(https?):\/\/)?(\*\.)?([a-z0-9.-]+(?::\d{1,5})?)$/.exec(
    trimmed,
  );
  if (!match) return null;

  const [, scheme, wildcard, host] = match;
  const schemePart = scheme ? escapeRegex(scheme) : "https";
  const hostPart = escapeRegex(host);
  const prefix = wildcard ? SUBDOMAIN_LABELS : "";
  return new RegExp(`^${schemePart}://${prefix}${hostPart}$`);
}

export function parseAllowedOrigins(raw: string | undefined): RegExp[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map(compileOriginPattern)
    .filter((p): p is RegExp => p !== null);
}

export function buildCorsOptions(raw: string | undefined): CorsOptions {
  const patterns = parseAllowedOrigins(raw);
  return {
    origin(origin, callback) {
      // Non-browser / same-origin requests carry no Origin header
      if (!origin) return callback(null, false);
      // The cors middleware appends "Vary: Origin" for function origins
      callback(
        null,
        patterns.some((p) => p.test(origin.toLowerCase())),
      );
    },
    credentials: true,
    maxAge: PREFLIGHT_MAX_AGE_SECONDS,
  };
}

/** CORS middleware that always varies on Origin, even for rejected origins. */
export function corsMiddleware(raw: string | undefined): RequestHandler {
  const handler = cors(buildCorsOptions(raw));
  return (req, res, next) => {
    res.vary("Origin");
    handler(req, res, next);
  };
}
