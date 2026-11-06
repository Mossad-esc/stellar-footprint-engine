import { createHmac, randomUUID } from "crypto";

import { SimulateResult } from "./simulator";

export interface WebhookJob {
  jobId: string;
  webhookUrl: string;
  status: "pending" | "delivered" | "failed";
  createdAt: string;
  completedAt?: string;
  attempts: number;
}

export class InvalidWebhookUrlError extends Error {
  constructor(url: string) {
    super(`Webhook URL must use HTTPS: ${url}`);
    this.name = "InvalidWebhookUrlError";
  }
}

function isValidHttpsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      !!parsed.hostname &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

const MAX_WEBHOOK_JOBS = 1000;
const jobs = new Map<string, WebhookJob>();

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
    createdAt: new Date().toISOString(),
    attempts: 0,
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
  job.completedAt = new Date().toISOString();
}

/**
 * Sign a payload with HMAC-SHA256 using WEBHOOK_SECRET env var.
 * Returns hex digest, or empty string if no secret is configured.
 */
function signPayload(payload: string): string {
  const secret = process.env.WEBHOOK_SECRET;
  if (!secret) return "";
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Deliver a webhook with HMAC-SHA256 signature header and up to `retries` attempts.
 */
export async function deliverWebhook(
  jobId: string,
  result: SimulateResult,
  retries = 3,
): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;

  const payload = JSON.stringify({ jobId, ...result });
  const signature = signPayload(payload);

  for (let attempt = 1; attempt <= retries; attempt++) {
    job.attempts = attempt;
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (signature) {
        headers["X-Webhook-Signature"] = `sha256=${signature}`;
      }

      const res = await fetch(job.webhookUrl, {
        method: "POST",
        headers,
        body: payload,
      });

      if (res.ok) {
        job.status = "delivered";
        job.completedAt = new Date().toISOString();
        return;
      }
    } catch {
      // retry on network errors
    }
  }

  job.status = "failed";
  job.completedAt = new Date().toISOString();
}
