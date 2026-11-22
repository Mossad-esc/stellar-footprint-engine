import { Request, Response, NextFunction } from "express";
import { getCache } from "../services/cache";

const inProgress = new Set<string>();

export function idempotencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers["idempotency-key"] as string | undefined;
  if (!key || req.method !== "POST") {
    next();
    return;
  }
  const clientId = (req.ip || "unknown").replace(/[^a-zA-Z0-9]/g, "");
  const cacheKey = `idempotency:${clientId}:${key}`;

  (async () => {
    const cache = getCache();
    const cached = await cache.get<any>(cacheKey);
    if (cached) {
      res.setHeader("Idempotency-Replayed", "true");
      res.status(cached.status ?? 200).json(cached.body);
      return;
    }
    if (inProgress.has(cacheKey)) {
      res.status(409).json({ error: "Request in progress" });
      return;
    }
    inProgress.add(cacheKey);

    const originalJson = res.json.bind(res);
    res.json = (body: any) => {
      const status = res.statusCode;
      void cache.set(cacheKey, { status, body }, 5 * 60 * 1000);
      inProgress.delete(cacheKey);
      return originalJson(body);
    };
    next();
  })().catch(() => next());
}
EOF