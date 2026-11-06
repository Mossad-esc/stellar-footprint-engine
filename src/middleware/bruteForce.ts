import { Request, Response, NextFunction } from "express";

import { CounterStore, getCounterStore } from "./counterStore";
import { ErrorCode } from "../constants";

const DELAY_THRESHOLD = parseInt(
  process.env.BRUTE_FORCE_DELAY_THRESHOLD || "10",
);
const BLOCK_THRESHOLD = parseInt(
  process.env.BRUTE_FORCE_BLOCK_THRESHOLD || "20",
);
const WINDOW_MS = parseInt(process.env.BRUTE_FORCE_WINDOW_MS || "60000");
const DELAY_MS = parseInt(process.env.BRUTE_FORCE_DELAY_MS || "5000");
const BLOCK_MS = parseInt(process.env.BRUTE_FORCE_BLOCK_MS || "300000");

const TTL_MS = Math.max(WINDOW_MS, BLOCK_MS) + 5000;
const store: CounterStore = getCounterStore();

export async function recordFailure(ip: string): Promise<void> {
  const now = Date.now();
  const record = await store.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    await store.set(ip, { count: 1, windowStart: now }, TTL_MS);
    return;
  }

  record.count += 1;

  if (record.count >= BLOCK_THRESHOLD) {
    record.blockedUntil = now + BLOCK_MS;
  }

  await store.set(ip, record, TTL_MS);
}

export async function bruteForceMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const record = await store.get(ip);

  if (!record || now - record.windowStart > WINDOW_MS) {
    return next();
  }

  if (record.blockedUntil && now < record.blockedUntil) {
    const retryAfter = Math.ceil((record.blockedUntil - now) / 1000);
    res.status(429).json({
      success: false,
      error: "Too many failed requests. Try again later.",
      code: ErrorCode.RATE_LIMIT_EXCEEDED,
      retryAfter,
    });
    return;
  }

  if (record.count >= DELAY_THRESHOLD) {
    await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  }

  next();
}
