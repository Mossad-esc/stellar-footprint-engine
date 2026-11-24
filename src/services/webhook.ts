import { createHmac, randomUUID } from "crypto";

import { SimulateResult } from "./simulator";

export interface WebhookJob {
  jobId: string;
  webhookUrl: string;
  status: "pending" | "delivered" | "failed" | "dead_letter";
  deliveryStatus: "pending" | "delivered" | "failed" | "dead_letter";
  createdAt: string;
  completedAt?: string;
  attempts: number;
  maxRetries: number;
  errorMessage?: string;
  nextRetryAt?: string;
  /** Original simulation result, retained for dead-letter redelivery. */
  result?: SimulateResult;
}

export class InvalidWebhookUrlError extends Error {
  constructor(url: string) {
    super(`Webhook URL must use HTTPS: ${url}`);
    this.name = "InvalidWebhookUrlError";
  }
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const allowLocalHttp =
      process.env.NODE_ENV === "test" &&
      parsed.protocol === "http:" &&
      LOOPBACK_HOSTS.has(parsed.hostname);

    return (
      (parsed.protocol === "https:" || allowLocalHttp) &&
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

const MAX_WEBHOOK_JOBS = 1000;
const DEFAULT_MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [1_000, 5_000, 30_000];

const jobs = new Map<string, WebhookJob>();
const pendingTimers = new Map<string, NodeJS.Timeout>();

export function createJob(webhookUrl: string): string {
  if (!isValidHttpsUrl(webhookUrl)) {
    throw new InvalidWebhookUrlError(webhookUrl);
  }

  if (jobs.size >= MAX_WEBHOOK_JOBS) {
    const oldestKey = jobs.keys().next().value;
    if (oldestKey) {
      jobs.delete(oldestKey);
    }
  }

  const jobId = randomUUID();
  jobs.set(jobId, {
    jobId,
    webhookUrl,
    status: "pending",
    deliveryStatus: "pending",
    createdAt: new Date().toISOString(),
    attempts: 0,
    maxRetries: DEFAULT_MAX_RETRIES,
  });
  return jobId;
}

export function getJob(jobId: string): WebhookJob | undefined {
  return jobs.get(jobId);
}

export function failJob(jobId: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "failed";
  job.deliveryStatus = "failed";
  job.completedAt = new Date().toISOString();
}

export function clearPendingTimer(jobId: string): void {
  const timer = pendingTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    pendingTimers.delete(jobId);
  }
}

function backoffDelayFor(retryIndex: number): number {
  return BACKOFF_DELAYS_MS[Math.min(retryIndex, BACKOFF_DELAYS_MS.length - 1)];
}

/**
 * Sign a payload with HMAC-SHA256 using WEBHOOK_SECRET env var.
 * The signed message is `${timestamp}.${payload}`, following the
 * timestamped signature scheme used by Stripe/GitHub webhooks.
 * Returns hex digest, or empty string if no secret is configured.
 */
function signPayload(payload: string, timestamp: number): string {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return "";
  return createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
}

/**
 * Deliver a webhook with HMAC-SHA256 signature header and exponential backoff
 * retries (1s, 5s, 30s). Resolves when the job reaches a terminal state
 * (delivered or dead_letter).
 */
export async function deliverWebhook(
  jobId: string,
  result: SimulateResult,
  retries = DEFAULT_MAX_RETRIES,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.result = result;

  const payload = JSON.stringify({ jobId, ...result });
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signPayload(payload, timestamp);
  const maxAttempts = retries + 1;

  return new Promise<void>((resolve) => {
    const runAttempt = (attemptNum: number): void => {
      const current = jobs.get(jobId);
      if (!current) {
        resolve();
        return;
      }
      current.attempts = attemptNum;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (signature) {
        headers["X-Signature-SHA256"] = `t=${timestamp},v1=${signature}`;
      }

      fetch(current.webhookUrl, {
        method: "POST",
        headers,
        body: payload,
      })
        .then((res) => {
          if (res.ok) {
            current.status = "delivered";
            current.deliveryStatus = "delivered";
            current.completedAt = new Date().toISOString();
            current.errorMessage = undefined;
            current.nextRetryAt = undefined;
            clearPendingTimer(jobId);
            resolve();
            return;
          }

          if (attemptNum <= retries) {
            const delay = backoffDelayFor(attemptNum - 1);
            current.nextRetryAt = new Date(Date.now() + delay).toISOString();
            clearPendingTimer(jobId);
            const timer = setTimeout(() => {
              pendingTimers.delete(jobId);
              runAttempt(attemptNum + 1);
            }, delay);
            pendingTimers.set(jobId, timer);
            return;
          }

          current.status = "dead_letter";
          current.deliveryStatus = "dead_letter";
          current.completedAt = new Date().toISOString();
          current.errorMessage = "All retry attempts exhausted";
          current.nextRetryAt = undefined;
          clearPendingTimer(jobId);
          resolve();
        })
        .catch(() => {
          if (attemptNum <= retries) {
            const delay = backoffDelayFor(attemptNum - 1);
            current.nextRetryAt = new Date(Date.now() + delay).toISOString();
            clearPendingTimer(jobId);
            const timer = setTimeout(() => {
              pendingTimers.delete(jobId);
              runAttempt(attemptNum + 1);
            }, delay);
            pendingTimers.set(jobId, timer);
            return;
          }

          current.status = "dead_letter";
          current.deliveryStatus = "dead_letter";
          current.completedAt = new Date().toISOString();
          current.errorMessage = "All retry attempts exhausted";
          current.nextRetryAt = undefined;
          clearPendingTimer(jobId);
          resolve();
        });
    };

    runAttempt(1);
  });
}

/**
 * Manually trigger redelivery of a dead-lettered webhook job.
 * Returns true if the job was found and reset for redelivery.
 */
export async function retryDeadLetter(
  jobId: string,
  result?: SimulateResult,
): Promise<boolean> {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (job.deliveryStatus !== "dead_letter") return false;

  clearPendingTimer(jobId);

  job.status = "pending";
  job.deliveryStatus = "pending";
  job.completedAt = undefined;
  job.errorMessage = undefined;
  job.attempts = 0;
  job.nextRetryAt = undefined;

  if (result) {
    void deliverWebhook(jobId, result);
  } else if (job.result) {
    void deliverWebhook(jobId, job.result);
  }
  return true;
}

export function getPendingTimers(): string[] {
  return [...pendingTimers.keys()];
}
