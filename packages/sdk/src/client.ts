import { StellarFootprintError } from "./errors";
import type {
  BatchSimulateOptions,
  BatchSimulateResult,
  BatchTransactionInput,
  DecodeResult,
  DiffFootprintsOptions,
  EstimateFeeOptions,
  EstimateFeeRequest,
  FeeEstimate,
  FootprintDiffResult,
  FootprintInput,
  ResponseEnvelope,
  SimulateOptions,
  SimulateResult,
  StellarFootprintClientConfig,
  XdrType,
} from "./types";

const DEFAULT_BASE_URL = "http://localhost:3000/api/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 250;

function normalizeBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.replace(/\/+$/, "");
  try {
    const parsed = new URL(trimmed);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      return `${trimmed}/api/v1`;
    }
  } catch {
    // Allow relative base URLs such as "/api/v1" in browser apps
  }
  return trimmed;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function isFootprintInput(value: unknown): value is FootprintInput {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as FootprintInput).readOnly) &&
    Array.isArray((value as FootprintInput).readWrite)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class StellarFootprintClient {
  private readonly baseURL: string;
  private readonly timeout: number;
  private readonly retries: number;
  private readonly retryDelayMs: number;
  private readonly apiKey?: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly fetchImpl: typeof globalThis.fetch;

  constructor(config: StellarFootprintClientConfig = {}) {
    this.baseURL = normalizeBaseUrl(config.baseURL ?? DEFAULT_BASE_URL);
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT_MS;
    this.retries = Math.max(0, config.retries ?? DEFAULT_RETRIES);
    this.retryDelayMs = Math.max(0, config.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS);
    this.apiKey = config.apiKey;
    this.defaultHeaders = config.headers ?? {};

    const resolvedFetch = config.fetch ?? globalThis.fetch;
    if (typeof resolvedFetch !== "function") {
      throw new StellarFootprintError(
        "No fetch implementation available. Provide config.fetch or run in Node.js >= 18 / a modern browser.",
      );
    }
    this.fetchImpl = resolvedFetch.bind(globalThis);
  }

  /**
   * Simulate a Soroban transaction XDR and extract its ledger footprint,
   * resource cost, auth entries, events, and TTL metadata.
   */
  public async simulate(
    xdr: string,
    options: SimulateOptions = {},
  ): Promise<SimulateResult> {
    if (!xdr || typeof xdr !== "string") {
      throw new StellarFootprintError("Transaction XDR must be a non-empty string");
    }

    return this.request<SimulateResult>("/simulate", {
      method: "POST",
      body: {
        xdr,
        ...(options.network !== undefined ? { network: options.network } : {}),
        ...(options.webhookUrl !== undefined
          ? { webhookUrl: options.webhookUrl }
          : {}),
        ...(options.ledgerSequence !== undefined
          ? { ledgerSequence: options.ledgerSequence }
          : {}),
      },
    });
  }

  /**
   * Simulate multiple Soroban transactions in a single batch request.
   */
  public async simulateBatch(
    xdrs: Array<string | BatchTransactionInput>,
    options: BatchSimulateOptions = {},
  ): Promise<BatchSimulateResult> {
    if (!Array.isArray(xdrs) || xdrs.length === 0) {
      throw new StellarFootprintError(
        "xdrs must be a non-empty array of XDR strings or transaction objects",
      );
    }

    const transactions: BatchTransactionInput[] = xdrs.map((item) =>
      typeof item === "string" ? { xdr: item } : item,
    );

    return this.request<BatchSimulateResult>("/simulate/batch", {
      method: "POST",
      body: {
        transactions,
        ...(options.network !== undefined ? { network: options.network } : {}),
      },
    });
  }

  /**
   * Estimate transaction fees from an XDR or explicit resource/footprint options.
   */
  public async estimateFee(
    xdr: string,
    options?: EstimateFeeOptions,
  ): Promise<FeeEstimate>;
  public async estimateFee(request: EstimateFeeRequest): Promise<FeeEstimate>;
  public async estimateFee(
    xdrOrRequest: string | EstimateFeeRequest,
    options: EstimateFeeOptions = {},
  ): Promise<FeeEstimate> {
    const payload: EstimateFeeRequest =
      typeof xdrOrRequest === "string"
        ? { xdr: xdrOrRequest, ...options }
        : xdrOrRequest;

    return this.request<FeeEstimate>("/estimate-fee", {
      method: "POST",
      body: payload,
    });
  }

  /**
   * Compare two footprints (either raw FootprintInput objects or transaction XDRs
   * which are simulated first to extract their footprints).
   */
  public async diffFootprints(
    xdrA: string | FootprintInput,
    xdrB: string | FootprintInput,
    options: DiffFootprintsOptions = {},
  ): Promise<FootprintDiffResult> {
    const [before, after] = await Promise.all([
      this.resolveFootprintInput(xdrA, options),
      this.resolveFootprintInput(xdrB, options),
    ]);

    const query = options.format === "markdown" ? "?format=markdown" : "";
    const response = await this.request<
      ResponseEnvelope<FootprintDiffResult> | FootprintDiffResult
    >(`/footprint/diff${query}`, {
      method: "POST",
      body: { before, after },
    });

    if (
      typeof response === "object" &&
      response !== null &&
      "data" in response &&
      response.data !== undefined
    ) {
      return response.data;
    }

    return response as FootprintDiffResult;
  }

  /**
   * Decode a base64 XDR string into a structured JSON representation.
   */
  public async decode(
    xdr: string,
    type: XdrType = "transaction",
  ): Promise<DecodeResult> {
    if (!xdr || typeof xdr !== "string") {
      throw new StellarFootprintError("XDR must be a non-empty string");
    }

    const params = new URLSearchParams({ xdr, type });
    return this.request<DecodeResult>(`/decode?${params.toString()}`, {
      method: "GET",
    });
  }

  private async resolveFootprintInput(
    input: string | FootprintInput,
    options: DiffFootprintsOptions,
  ): Promise<FootprintInput> {
    if (isFootprintInput(input)) {
      return input;
    }

    const sim = await this.simulate(input, { network: options.network });
    if (sim.rawFootprint) {
      return sim.rawFootprint;
    }

    if (sim.footprint) {
      return {
        readOnly: sim.footprint.readOnly.map((entry) =>
          typeof entry === "string" ? entry : entry.xdr,
        ),
        readWrite: sim.footprint.readWrite.map((entry) =>
          typeof entry === "string" ? entry : entry.xdr,
        ),
      };
    }

    throw new StellarFootprintError(
      sim.error ?? "Unable to extract footprint from transaction XDR",
      { code: sim.code, details: sim },
    );
  }

  private async request<T>(
    path: string,
    init: { method: "GET" | "POST" | "DELETE"; body?: unknown },
  ): Promise<T> {
    const url = `${this.baseURL}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...this.defaultHeaders,
    };

    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    let bodyString: string | undefined;
    if (init.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyString = JSON.stringify(init.body);
    }

    let lastError: unknown;

    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await this.fetchImpl(url, {
          method: init.method,
          headers,
          body: bodyString,
          signal: controller.signal,
        });

        clearTimeout(timer);

        const contentType = response.headers.get("content-type") ?? "";
        const payload = contentType.includes("application/json")
          ? ((await response.json()) as Record<string, unknown>)
          : await response.text();

        if (!response.ok) {
          const message =
            typeof payload === "object" &&
            payload !== null &&
            typeof payload.error === "string"
              ? payload.error
              : `Request failed with status ${response.status}`;
          const code =
            typeof payload === "object" &&
            payload !== null &&
            typeof payload.code === "string"
              ? payload.code
              : undefined;

          const err = new StellarFootprintError(message, {
            status: response.status,
            code,
            details: payload,
          });

          if (attempt < this.retries && isRetryableStatus(response.status)) {
            lastError = err;
            await sleep(this.retryDelayMs * Math.pow(2, attempt));
            continue;
          }

          throw err;
        }

        return payload as T;
      } catch (err) {
        clearTimeout(timer);

        if (err instanceof StellarFootprintError) {
          throw err;
        }

        const isAbort =
          err instanceof Error &&
          (err.name === "AbortError" || err.name === "TimeoutError");

        const wrapped = new StellarFootprintError(
          isAbort
            ? `Request timed out after ${this.timeout}ms`
            : err instanceof Error
              ? err.message
              : "Network request failed",
          {
            code: isAbort ? "REQUEST_TIMEOUT" : "NETWORK_ERROR",
            cause: err,
          },
        );

        if (attempt < this.retries) {
          lastError = wrapped;
          await sleep(this.retryDelayMs * Math.pow(2, attempt));
          continue;
        }

        throw wrapped;
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new StellarFootprintError("Request failed after retries");
  }
}
