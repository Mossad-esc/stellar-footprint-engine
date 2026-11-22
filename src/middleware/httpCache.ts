import crypto from "crypto";

import { Request, Response, NextFunction } from "express";

/**
 * #341 — HTTP caching headers middleware for successful simulation responses.
 *
 * - Sets ETag (SHA-256 of response body) on every response.
 * - Sets Cache-Control: public, max-age=60 on 200 responses.
 * - Returns 304 Not Modified when the client's If-None-Match matches the ETag.
 */
export function httpCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown): Response {
    const statusCode = res.statusCode;

    if (statusCode === 200) {
      const payload = JSON.stringify(body);
      const etag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=60");

      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch === etag) {
        res.removeHeader("Content-Type");
        res.removeHeader("Content-Length");
        res.status(304).end();
        return res;
      }
    }

    return originalJson(body);
  };

  next();
}

/**
 * #39 — Static cache middleware for slow-changing endpoints such as
 * GET /openapi.json and GET /simulate/supported-networks.
 *
 * - Sets ETag (SHA-256 of response body) on 200 responses.
 * - Sets Cache-Control: public, max-age=3600 on 200 responses.
 * - Returns 304 Not Modified when the client's If-None-Match matches the ETag.
 */
export function staticCacheMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const originalJson = res.json.bind(res);

  res.json = function (body: unknown): Response {
    const statusCode = res.statusCode;

    if (statusCode === 200) {
      const payload = JSON.stringify(body);
      const etag = `"${crypto.createHash("sha256").update(payload).digest("hex")}"`;

      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "public, max-age=3600");

      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch === etag) {
        res.removeHeader("Content-Type");
        res.removeHeader("Content-Length");
        res.status(304).end();
        return res;
      }
    }

    return originalJson(body);
  };

  next();
}
