import { createHmac } from "crypto";

import {
  createJob,
  deliverWebhook,
  failJob,
  getJob,
  InvalidWebhookUrlError,
} from "../webhook";

const MOCK_SIMULATE_RESULT = {
  success: true,
  footprint: { readOnly: [], readWrite: [] },
  contracts: [],
  contractType: "unknown" as const,
  ttl: {},
  optimized: false,
  rawFootprint: { readOnly: [], readWrite: [] },
  cost: { cpuInsns: "100", memBytes: "200" },
};

describe("webhook service", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.WEBHOOK_SECRET;
  });

  it("creates a job for a valid HTTPS webhook URL", () => {
    const jobId = createJob("https://example.com/webhook");

    expect(typeof jobId).toBe("string");
    const job = getJob(jobId);
    expect(job).toBeDefined();
    expect(job?.webhookUrl).toBe("https://example.com/webhook");
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(0);
    expect(job?.createdAt).toBeDefined();
  });

  it("rejects non-HTTPS webhook URLs", () => {
    expect(() => createJob("http://example.com/webhook")).toThrow(
      InvalidWebhookUrlError,
    );
  });

  it("rejects invalid webhook URLs", () => {
    expect(() => createJob("not-a-url")).toThrow(InvalidWebhookUrlError);
  });

  it("rejects HTTPS URLs with embedded credentials", () => {
    expect(() => createJob("https://user:secret@example.com/webhook")).toThrow(
      InvalidWebhookUrlError,
    );
  });

  it("delivers signed webhook payload with X-Webhook-Signature when WEBHOOK_SECRET is set", async () => {
    process.env.WEBHOOK_SECRET = "super-secret";
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;

    const jobId = createJob("https://example.com/hook");
    await deliverWebhook(jobId, MOCK_SIMULATE_RESULT);

    const job = getJob(jobId);
    expect(job?.status).toBe("delivered");
    expect(job?.attempts).toBe(1);
    expect(job?.completedAt).toBeDefined();

    const expectedBody = JSON.stringify({ jobId, ...MOCK_SIMULATE_RESULT });
    const expectedSig = createHmac("sha256", "super-secret")
      .update(expectedBody)
      .digest("hex");

    expect(mockFetch).toHaveBeenCalledWith("https://example.com/hook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": `sha256=${expectedSig}`,
      },
      body: expectedBody,
    });
  });

  it("retries failed deliveries and marks job failed when retries are exhausted", async () => {
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ ok: false, status: 502 });
    global.fetch = mockFetch as unknown as typeof fetch;

    const jobId = createJob("https://example.com/hook");
    await deliverWebhook(jobId, MOCK_SIMULATE_RESULT, 2);

    const job = getJob(jobId);
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(job?.status).toBe("failed");
    expect(job?.attempts).toBe(2);
    expect(job?.completedAt).toBeDefined();
  });

  it("marks a pending job as failed via failJob", () => {
    const jobId = createJob("https://example.com/hook");
    failJob(jobId);
    expect(getJob(jobId)?.status).toBe("failed");
    expect(getJob(jobId)?.completedAt).toBeDefined();
  });
});
