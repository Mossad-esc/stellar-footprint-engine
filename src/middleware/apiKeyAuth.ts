import { createHash, timingSafeEqual } from "crypto";

import { Request, Response, NextFunction } from "express";

import { ErrorCode, HTTP_STATUS } from "../constants";

export interface ScopedApiKey {
  key: string;
  scopes: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiKeyScopes?: string[];
    }
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function extractApiKey(req: Request): string | null {
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string") {
    const match = /^Bearer\s+(\S+)$/i.exec(authHeader.trim());
    if (match) {
      return match[1];
    }
  }

  const headerKey = req.headers["x-api-key"];
  if (typeof headerKey === "string" && headerKey.trim() !== "") {
    return headerKey.trim();
  }

  return null;
}

function findMatchingKey(
  candidate: string,
  configuredKeys: ScopedApiKey[],
): ScopedApiKey | null {
  const candidateDigest = sha256(candidate);
  let matched: ScopedApiKey | null = null;

  for (const entry of configuredKeys) {
    const keyDigest = sha256(entry.key);
    if (timingSafeEqual(candidateDigest, keyDigest)) {
      matched = entry;
    }
  }

  return matched;
}

/**
 * Resolve the configured scoped API keys.
 * Prefers API_KEYS_CONFIG (JSON map of key -> scopes array, or array of
 * { key, scopes } objects). Falls back to legacy comma-separated API_KEYS,
 * whose keys are granted the wildcard scope "*".
 */
export function resolveConfiguredKeys(): ScopedApiKey[] {
  const rawConfig = process.env.API_KEYS_CONFIG;
  if (rawConfig && rawConfig.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(rawConfig);
      const entries: ScopedApiKey[] = [];

      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === "object" &&
            typeof (item as { key?: unknown }).key === "string"
          ) {
            const scopes = (item as { scopes?: unknown }).scopes;
            entries.push({
              key: (item as { key: string }).key,
              scopes: Array.isArray(scopes)
                ? scopes.filter((s): s is string => typeof s === "string")
                : [],
            });
          }
        }
      } else if (parsed && typeof parsed === "object") {
        for (const [key, scopes] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          entries.push({
            key,
            scopes: Array.isArray(scopes)
              ? scopes.filter((s): s is string => typeof s === "string")
              : [],
          });
        }
      }

      if (entries.length > 0) {
        return entries;
      }
    } catch {
      // Fall through to legacy API_KEYS on malformed config
    }
  }

  const rawKeys = process.env.API_KEYS;
  if (!rawKeys || rawKeys.trim() === "") {
    return [];
  }

  return rawKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((key) => ({ key, scopes: ["*"] }));
}

/**
 * API key authentication middleware.
 * If API_KEYS env var is set (comma-separated), all /api/v1/* routes
 * require a valid `Authorization: Bearer <key>` or `X-API-Key: <key>` header.
 * Health and OpenAPI discovery routes are exempt.
 */
export function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const validKeys = resolveConfiguredKeys();

  // If no keys configured, auth is disabled — allow all requests
  if (validKeys.length === 0) {
    return next();
  }

  // Health and public OpenAPI spec endpoints are exempt
  if (req.path.startsWith("/health") || req.path === "/openapi.json") {
    return next();
  }

  const token = extractApiKey(req);
  const matched = token ? findMatchingKey(token, validKeys) : null;

  if (!matched) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: "Unauthorized: missing or invalid API key",
      code: ErrorCode.UNAUTHORIZED,
    });
    return;
  }

  req.apiKeyScopes = matched.scopes;
  next();
}

/**
 * Middleware factory enforcing that the authenticated API key carries the
 * required scope. Must run after `apiKeyAuth`.
 * Returns 403 Forbidden with a descriptive envelope when the scope is missing.
 */
export function requireScope(scope: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const scopes = req.apiKeyScopes;

    // Auth disabled (no keys configured) — allow through
    if (!scopes) {
      return next();
    }

    if (scopes.includes("*") || scopes.includes(scope)) {
      return next();
    }

    res.status(HTTP_STATUS.FORBIDDEN).json({
      success: false,
      error: `Forbidden: API key lacks required scope '${scope}'`,
      code: ErrorCode.FORBIDDEN,
      requiredScope: scope,
    });
  };
}
