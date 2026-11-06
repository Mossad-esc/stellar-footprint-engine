import { createHash, timingSafeEqual } from "crypto";

import { Request, Response, NextFunction } from "express";

import { ErrorCode, HTTP_STATUS } from "../constants";

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

function isKeyValid(candidate: string, configuredKeys: string[]): boolean {
  const candidateDigest = sha256(candidate);
  let matched = false;

  for (const key of configuredKeys) {
    const keyDigest = sha256(key);
    if (timingSafeEqual(candidateDigest, keyDigest)) {
      matched = true;
    }
  }

  return matched;
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
  const rawKeys = process.env.API_KEYS;

  // If no API_KEYS configured, auth is disabled — allow all requests
  if (!rawKeys || rawKeys.trim() === "") {
    return next();
  }

  const validKeys = rawKeys
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  if (validKeys.length === 0) {
    return next();
  }

  // Health and public OpenAPI spec endpoints are exempt
  if (req.path.startsWith("/health") || req.path === "/openapi.json") {
    return next();
  }

  const token = extractApiKey(req);
  if (!token || !isKeyValid(token, validKeys)) {
    res.setHeader("WWW-Authenticate", "Bearer");
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: "Unauthorized: missing or invalid API key",
      code: ErrorCode.UNAUTHORIZED,
    });
    return;
  }

  next();
}
