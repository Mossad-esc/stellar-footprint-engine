# ADR 004: Async Webhook System Architecture

## Status

Accepted

## Context

Simulating complex Soroban transactions against Stellar RPC can occasionally take longer than a client's synchronous HTTP timeout or block frontend UX when processing transactions asynchronously. To support non-blocking simulation workflows, clients need the ability to submit a simulation request with a callback URL (`webhookUrl`), receive an immediate `202 Accepted` response with a `jobId`, and be notified via HTTP `POST` once simulation completes—while also being able to poll job status (`GET /api/v1/jobs/:jobId`) if needed.

We needed a lightweight, secure, and reliable asynchronous webhook delivery mechanism (`src/services/webhook.ts`) that fits the service's zero-external-dependency baseline without requiring a separate message broker.

## Decision

We will implement an in-process asynchronous job tracker and webhook delivery service in `src/services/webhook.ts`, integrated with the simulation controller (`src/api/controllers.ts`).

### Architecture & Lifecycle

1. **Job Creation (`createJob(webhookUrl)`)**:
   - Validates `webhookUrl` using `isValidHttpsUrl`.
   - Rejects non-HTTPS URLs (except loopback `http://` hosts `127.0.0.1`, `localhost`, `::1`, `[::1]` when `NODE_ENV === "test"`), URLs without a hostname, and URLs containing embedded `username` or `password` credentials, throwing `InvalidWebhookUrlError`.
   - Generates a UUID v4 `jobId` via `crypto.randomUUID()` and stores a `WebhookJob` record (`status: "pending"`, `createdAt`, `attempts: 0`) in an in-memory `Map<string, WebhookJob>`.
   - Caps the in-memory store at `MAX_WEBHOOK_JOBS = 1000`, evicting the oldest entry (FIFO) when the limit is reached to prevent unbounded memory growth.
2. **Async Execution**:
   - The controller returns `202 Accepted` with `{ jobId }` immediately and triggers simulation + `deliverWebhook(jobId, result)` asynchronously.
   - If simulation fails before delivery, `failJob(jobId)` transitions the job to `status: "failed"` with `completedAt`.
3. **Job Status Lookup (`getJob(jobId)`)**:
   - Exposes current job state (`pending`, `delivered`, `failed`), timestamps, and attempt count.

## Delivery Guarantees

- **At-Least-Once Delivery (within retry budget)**: `deliverWebhook(jobId, result, retries = 3)` attempts to `POST` the JSON payload `{ jobId, ...result }` up to `retries` times (default `3`).
- A delivery succeeds as soon as the receiver responds with an HTTP `2xx` status (`res.ok`).
- On non-2xx responses or network/fetch errors, `deliverWebhook` retries until `retries` attempts are exhausted, after which `job.status` is set to `"failed"` and `completedAt` is recorded.
- **Consumer Idempotency**: Because network timeouts after a receiver has processed a request can trigger a retry, webhook consumers **must** treat `jobId` as an idempotency key and deduplicate duplicate deliveries.
- **Process-Local Scope**: Because jobs are stored in an in-memory `Map` (max `1000` entries), pending jobs are not persisted across process restarts or shared across horizontally scaled instances.

## Security

1. **HTTPS-Only Enforcement**:
   - Production webhook URLs must use the `https:` scheme (`InvalidWebhookUrlError` otherwise).
   - Embedded URL credentials (`https://user:pass@host`) are explicitly rejected.
   - Local `http://` is permitted strictly for loopback addresses during automated testing (`NODE_ENV === "test"`).
2. **HMAC-SHA256 Payload Signing**:
   - When `process.env.WEBHOOK_SECRET` is configured, `signPayload(payload)` computes an HMAC-SHA256 hex digest over the raw JSON payload string.
   - The digest is sent in the `X-Webhook-Signature` header formatted as `sha256=<hex_digest>`.
   - Receivers should compute the HMAC-SHA256 of the raw request body using the shared secret and compare it against the header using a constant-time comparison (`crypto.timingSafeEqual`).

## Consequences

### Positive

- **Zero External Infrastructure**: Works out of the box with no message broker (RabbitMQ, SQS, BullMQ) required.
- **Non-Blocking Client UX**: Clients receive an immediate `jobId` without holding open long HTTP connections.
- **Verifiable & Secure**: HTTPS enforcement and `X-Webhook-Signature` HMAC-SHA256 signing protect payload integrity and authenticity.
- **Bounded Memory**: `MAX_WEBHOOK_JOBS = 1000` prevents memory leaks under sustained traffic.

### Negative

- **No Cross-Instance Persistence**: Job state lives in process memory; a server restart loses in-flight jobs, and polling `GET /api/v1/jobs/:jobId` behind a multi-instance load balancer requires sticky sessions or a shared store.
- **Immediate Retries Without Backoff**: Retries currently execute sequentially in a loop without exponential backoff, which may not recover from multi-minute downstream outages.
- **No Dead-Letter Queue (DLQ)**: Permanently failed deliveries are marked `status: "failed"` in memory and are not replayed automatically.

## Alternatives Considered

1. **Synchronous Simulation Only**: Rejected because slow RPC calls or batch workloads can exceed client/proxy timeouts.
2. **External Job Queue (BullMQ + Redis)**: Rejected for the initial design to avoid making Redis mandatory for webhook support; can be introduced later behind the same `createJob` / `getJob` / `deliverWebhook` interface if multi-instance persistence is needed.
3. **Fire-and-Forget Without Retries**: Rejected because transient network blips would silently drop notifications without giving consumers a chance to receive the result.
