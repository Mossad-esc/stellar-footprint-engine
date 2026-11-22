import { createHmac } from "crypto";

import { verifySignature } from "../../middleware/hmacVerify";
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

  it("delivers signed webhook payload with X-Signature-SHA256 when WEBHOOK_SECRET is set", async () => {
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

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(expectedBody);
    expect(init.headers["Content-Type"]).toBe("application/json");

    const signatureHeader = init.headers["X-Signature-SHA256"];
    expect(typeof signatureHeader).toBe("string");

    const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader);
    expect(match).not.toBeNull();

    const timestamp = Number(match![1]);
    const signature = match![2];
    expect(Number.isFinite(timestamp)).toBe(true);

    const expectedSig = createHmac("sha256", "super-secret")
      .update(`${timestamp}.${expectedBody}`)
      .digest("hex");
    expect(signature).toBe(expectedSig);
  });

  it("omits X-Signature-SHA256 when WEBHOOK_SECRET is not set", async () => {
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch as unknown as typeof fetch;

    const jobId = createJob("https://example.com/hook");
    await deliverWebhook(jobId, MOCK_SIMULATE_RESULT);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["X-Signature-SHA256"]).toBeUndefined();
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

describe("verifySignature", () => {
  const SECRET = "super-secret";
  const PAYLOAD = JSON.stringify({ hello: "world" });

  function sign(timestamp: number, payload: string, secret = SECRET): string {
    const sig = createHmac("sha256", secret)
      .update(`${timestamp}.${payload}`)
      .digest("hex");
    return `t=${timestamp},v1=${sig}`;
  }

  it("accepts a valid signature", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(timestamp, PAYLOAD);

    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(true);
  });

  it("rejects a tampered payload", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(timestamp, PAYLOAD);

    expect(verifySignature(`${PAYLOAD} `, header, SECRET)).toBe(false);
  });

  it("rejects a signature computed with a different secret", () => {
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(timestamp, PAYLOAD, "wrong-secret");

    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  it("rejects a stale timestamp outside the tolerance window", () => {
    const staleTimestamp = Math.floor(Date.now() / 1000) - 3600;
    const header = sign(staleTimestamp, PAYLOAD);

    expect(verifySignature(PAYLOAD, header, SECRET)).toBe(false);
  });

  it("rejects malformed signature headers", () => {
    expect(verifySignature(PAYLOAD, "", SECRET)).toBe(false);
    expect(verifySignature(PAYLOAD, "garbage", SECRET)).toBe(false);
    expect(verifySignature(PAYLOAD, "t=abc,v1=def", SECRET)).toBe(false);
  });
});
