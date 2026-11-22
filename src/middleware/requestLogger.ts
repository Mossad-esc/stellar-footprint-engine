import { Request, Response, NextFunction } from "express";

import { logger } from "../utils/logger";

const isDebug = process.env.LOG_LEVEL === "debug";

export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const requestId = res.locals["requestId"] as string | undefined;

  /**
   * Stamp the child logger with request-scoped fields that satisfy ECS / Datadog
   * HTTP log format:
   *   - http.request.id  → correlates every log line within one request
   *   - http.request.method / url.path → standard HTTP dimensions
   *   - network.client.ip              → caller IP for security analysis
   */
  const reqLogger = logger.child({
    "http.request.id": requestId,
    "http.request.method": req.method,
    "url.path": req.path,
    "network.client.ip": req.ip,
  });

  if (isDebug && req.body && Object.keys(req.body as object).length > 0) {
    const logged: Record<string, unknown> = { ...(req.body as object) };
    // Avoid logging full XDR blobs — they are large and low-value in traces.
    if (typeof logged["xdr"] === "string" && logged["xdr"].length > 50) {
      logged["xdr"] = `${logged["xdr"].slice(0, 50)}...`;
    }
    reqLogger.debug(logged, `${req.method} ${req.path}`);
  }

  res.on("finish", () => {
    /**
     * ECS HTTP response fields:
     *   - http.response.status_code  → standard numeric status
     *   - event.duration             → response time in nanoseconds (ECS standard unit)
     *
     * res.locals.responseTime is set by the responseTimeMiddleware that runs
     * before requestLogger and stores elapsed milliseconds as a number.
     */
    const responseTimeMs = res.locals["responseTime"] as number | undefined;

    reqLogger.info(
      {
        "http.response.status_code": res.statusCode,
        ...(responseTimeMs !== undefined
          ? { "event.duration": Math.round(responseTimeMs * 1_000_000) }
          : {}),
      },
      `${req.method} ${req.path} ${res.statusCode}`,
    );
  });

  next();
}
