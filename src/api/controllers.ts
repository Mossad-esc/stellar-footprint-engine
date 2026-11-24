import path from "path";

import { Network } from "@config/stellar";
import metrics from "@middleware/metrics";
import {
  getCache,
  getCacheStatus,
  invalidateContractCache,
} from "@services/cache";
import { decodeXdr, type XdrType } from "@services/decoder";
import {
  estimateFee,
  estimateFeeDetailed,
  type FeeEstimateOptions,
} from "@services/feeEstimator";
import { footprintDiff, type FootprintInput } from "@services/footprintDiff";
import { calculateFootprintStats } from "@services/footprintExtractor";
import { getNetworkStatus, getNetworkLimits } from "@services/networkStatus";
import { buildRestoreTransaction } from "@services/restorer";
import { getRpcStats } from "@services/rpcClient";
import {
  simulateTransaction,
  simulateDryRun as analyzeDryRun,
  simulateDependentBatch,
  type DependentTx,
} from "@services/simulator";
import { validateXdr } from "@services/validator";
import {
  createJob,
  deliverWebhook,
  failJob,
  getJob,
  InvalidWebhookUrlError,
  retryDeadLetter,
} from "@services/webhook";
import { AppError } from "@utils/AppError";
import { rpcCircuitBreaker } from "@utils/circuitBreaker";
import { validateXdrInput } from "@utils/validateXdrInput";
import { Request, Response, NextFunction } from "express";

import { version } from "../../package.json";
import { env } from "../config/env";
import {
  NETWORKS,
  DEFAULT_NETWORK,
  ERROR_MESSAGES,
  HTTP_STATUS,
  BATCH_MAX_SIZE,
  ErrorCode,
  getErrorCodeByMessage,
} from "../constants";
import { ResponseEnvelope } from "../types";

export function supportedNetworks(_req: Request, res: Response): void {
  const networks: string[] = [];
  if (process.env.TESTNET_RPC_URL) networks.push("testnet");
  if (process.env.MAINNET_RPC_URL) networks.push("mainnet");
  if (process.env.FUTURENET_RPC_URL) networks.push("futurenet");
  res.status(HTTP_STATUS.OK).json({ networks });
}

export function health(_req: Request, res: Response): void {
  res.status(HTTP_STATUS.OK).json({
    status: "ok",
    uptime: process.uptime(),
    version,
    timestamp: new Date().toISOString(),
  });
}

export function liveness(_req: Request, res: Response): void {
  res.status(HTTP_STATUS.OK).json({
    status: "ok",
    uptime: process.uptime(),
    version,
    timestamp: new Date().toISOString(),
  });
}

export async function readiness(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const checks: Record<string, { status: string; details?: unknown }> = {};

    // Check Redis/Cache
    let cacheFallbackEnabled = false;
    try {
      const cache = getCache();
      const status = getCacheStatus();
      cacheFallbackEnabled = status.fallbackEnabled;

      const testKey = "__health_check__";
      const testValue = Date.now().toString();
      await cache.set(testKey, testValue, 5000);
      const retrieved = await cache.get<string>(testKey);
      await cache.delete(testKey);

      const cacheHealthy = retrieved === testValue;

      checks.cache = {
        status: cacheHealthy
          ? "healthy"
          : cacheFallbackEnabled
            ? "degraded"
            : "unhealthy",
        details: {
          backend: cache.backend,
          redisStatus: status.redisStatus,
          fallbackEnabled: status.fallbackEnabled,
        },
      };
    } catch (err) {
      checks.cache = {
        status: cacheFallbackEnabled ? "degraded" : "unhealthy",
        details: {
          error: (err as Error).message,
          fallbackEnabled: cacheFallbackEnabled,
        },
      };
    }

    // Check RPC Circuit Breaker
    const cbState = rpcCircuitBreaker.getState();
    checks.rpcCircuitBreaker = {
      status: cbState.state === "open" ? "unhealthy" : "healthy",
      details: cbState,
    };

    // Determine overall health. A degraded cache is tolerated when fallback
    // is enabled so the service can keep serving traffic.
    const allHealthy = Object.values(checks).every(
      (check) =>
        check.status === "healthy" ||
        (check.status === "degraded" && cacheFallbackEnabled),
    );
    const anyDegraded = Object.values(checks).some(
      (check) => check.status === "degraded",
    );

    if (allHealthy) {
      res.status(HTTP_STATUS.OK).json({
        status: anyDegraded ? "ready (degraded)" : "ready",
        checks,
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(HTTP_STATUS.SERVICE_UNAVAILABLE).json({
        status: "not ready",
        checks,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (err) {
    next(err);
  }
}

export async function simulate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { xdr, network, webhookUrl, ledgerSequence } = req.body as {
    xdr?: string;
    network?: Network;
    webhookUrl?: string;
    ledgerSequence?: number;
  };

  const xdrCheck = validateXdrInput(xdr);
  if (!xdrCheck.valid) {
    return next(new AppError(xdrCheck.error!, HTTP_STATUS.BAD_REQUEST));
  }

  const xdrValue = xdr!;

  if (
    network &&
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  if (ledgerSequence !== undefined) {
    if (!Number.isInteger(ledgerSequence) || ledgerSequence <= 0) {
      return next(
        new AppError(
          ERROR_MESSAGES.INVALID_LEDGER_SEQUENCE,
          HTTP_STATUS.BAD_REQUEST,
        ),
      );
    }
  }

  const net: Network = (network as Network) || DEFAULT_NETWORK;

  // maxLedgerAge from query param or Cache-Control: max-age-ledgers=N
  let maxLedgerAge: number | undefined;
  const maxLedgerAgeQuery = (req.query.maxLedgerAge as string) || "";
  if (maxLedgerAgeQuery !== "") {
    const parsed = parseInt(maxLedgerAgeQuery, 10);
    if (!isNaN(parsed) && parsed > 0) maxLedgerAge = parsed;
  }
  if (maxLedgerAge === undefined) {
    const cacheControl = (req.headers["cache-control"] as string) || "";
    const match = cacheControl.match(/max-age-ledgers=(\d+)/);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (!isNaN(parsed) && parsed > 0) maxLedgerAge = parsed;
    }
  }

  if (webhookUrl !== undefined) {
    if (typeof webhookUrl !== "string") {
      return next(
        new AppError(
          "Webhook URL must be a valid HTTPS URL",
          HTTP_STATUS.BAD_REQUEST,
        ),
      );
    }

    let jobId: string;
    try {
      jobId = createJob(webhookUrl);
    } catch (err: unknown) {
      const message =
        err instanceof InvalidWebhookUrlError
          ? err.message
          : "Webhook URL must be a valid HTTPS URL";
      return next(new AppError(message, HTTP_STATUS.BAD_REQUEST));
    }

    metrics.incrementActiveSimulations();
    const start = Date.now();
    try {
      metrics.recordXdrBytes(Buffer.from(xdrValue, "base64").length);
    } catch {
      // ignore — never block the request for a metrics failure
    }

    void simulateTransaction(xdrValue, net, undefined, ledgerSequence, maxLedgerAge)
      .then((result) => {
        const duration = (Date.now() - start) / 1000;
        metrics.recordSimulation(net, result.success);
        metrics.recordSimulationDuration(net, duration);
        return deliverWebhook(jobId, result);
      })
      .catch(() => {
        metrics.recordSimulation(net, false);
        failJob(jobId);
      })
      .finally(() => {
        metrics.decrementActiveSimulations();
      });

    res.status(HTTP_STATUS.ACCEPTED).json({
      accepted: true,
      jobId,
      status: "pending",
    });
    return;
  }

  metrics.incrementActiveSimulations();
  const start = Date.now();

  // Record XDR payload size (decoded byte length)
  try {
    metrics.recordXdrBytes(Buffer.from(xdrValue, "base64").length);
  } catch {
    // ignore — never block the request for a metrics failure
  }

  try {
    const result = await simulateTransaction(
      xdrValue,
      net,
      res.locals.abortSignal,
      ledgerSequence,
      maxLedgerAge,
    );
    const duration = (Date.now() - start) / 1000;
    metrics.recordSimulation(net, result.success);
    metrics.recordSimulationDuration(net, duration);

    const resultWithCode = result.success
      ? result
      : {
          ...result,
          code:
            result.code ??
            getErrorCodeByMessage(
              result.error ?? ERROR_MESSAGES.UNEXPECTED_ERROR,
              HTTP_STATUS.UNPROCESSABLE_ENTITY,
            ),
        };

    res.setHeader("X-Cache", result.cacheHit ? "HIT" : "MISS");
    res
      .status(
        resultWithCode.success
          ? HTTP_STATUS.OK
          : HTTP_STATUS.UNPROCESSABLE_ENTITY,
      )
      .json(resultWithCode);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    metrics.recordSimulation(net, false);
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  } finally {
    metrics.decrementActiveSimulations();
  }
}

export async function simulateBatch(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { transactions, network } = req.body as {
    transactions?: { xdr: string; ledgerSequence?: number }[];
    network?: Network;
  };

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return next(
      new AppError(
        "Missing required field: transactions (must be a non-empty array)",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (transactions.length > BATCH_MAX_SIZE) {
    return next(
      new AppError(
        `Batch size exceeds maximum of ${BATCH_MAX_SIZE} transactions`,
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (
    network &&
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  const net: Network = (network as Network) || DEFAULT_NETWORK;
  const concurrency = env.BATCH_CONCURRENCY;

  metrics.incrementActiveSimulations();

  try {
    const tasks = transactions.map(({ xdr, ledgerSequence }, index) => () => {
      if (!xdr) return Promise.reject(new Error(ERROR_MESSAGES.MISSING_XDR));
      return simulateTransaction(
        xdr as string,
        net,
        res.locals.abortSignal,
        ledgerSequence,
      ).then((result) => ({ index, ...result }));
    });

    const settled: PromiseSettledResult<{
      index: number;
      success: boolean;
      cacheHit?: boolean;
    }>[] = [];
    for (let i = 0; i < tasks.length; i += concurrency) {
      const chunk = tasks.slice(i, i + concurrency).map((t) => t());
      settled.push(...(await Promise.allSettled(chunk)));
    }

    const results = settled.map((outcome, index) => {
      if (outcome.status === "fulfilled") {
        const value = outcome.value as {
          index: number;
          success: boolean;
          [key: string]: unknown;
        };
        metrics.recordSimulation(net, value.success);
        return value;
      } else {
        metrics.recordSimulation(net, false);
        const message =
          outcome.reason instanceof Error
            ? outcome.reason.message
            : ERROR_MESSAGES.UNEXPECTED_ERROR;
        return {
          index,
          success: false,
          error: message,
          code: getErrorCodeByMessage(
            message,
            HTTP_STATUS.INTERNAL_SERVER_ERROR,
          ),
        };
      }
    });

    const anyHit = results.some((r) => "cacheHit" in r && r.cacheHit);
    const allHit = results.every((r) => "cacheHit" in r && r.cacheHit);
    res.setHeader("X-Cache", allHit ? "HIT" : anyHit ? "PARTIAL" : "MISS");
    res.status(HTTP_STATUS.OK).json({ results });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    metrics.recordSimulation(net, false);
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  } finally {
    metrics.decrementActiveSimulations();
  }
}

export async function networkStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const networkParam = (req.query.network as string) || DEFAULT_NETWORK;

  if (networkParam === "all") {
    try {
      const configured: Network[] = [];
      if (process.env.TESTNET_RPC_URL)
        configured.push(NETWORKS.TESTNET as Network);
      if (process.env.MAINNET_RPC_URL)
        configured.push(NETWORKS.MAINNET as Network);
      if (process.env.FUTURENET_RPC_URL)
        configured.push(NETWORKS.FUTURENET as Network);

      const entries = await Promise.all(
        configured.map(async (net) => {
          try {
            const status = await getNetworkStatus(net);
            return [net, status] as const;
          } catch (err) {
            return [
              net,
              {
                error:
                  err instanceof Error
                    ? err.message
                    : ERROR_MESSAGES.UNEXPECTED_ERROR,
              },
            ] as const;
          }
        }),
      );

      const data = Object.fromEntries(entries);
      res.status(HTTP_STATUS.OK).json({ success: true, data });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
      next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
    }
    return;
  }

  const network = networkParam as Network;

  if (
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  try {
    const status = await getNetworkStatus(network);
    const response: ResponseEnvelope = { success: true, data: status };
    res.status(HTTP_STATUS.OK).json(response);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function footprintDiffController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { before, after } = req.body as {
    before?: FootprintInput;
    after?: FootprintInput;
  };

  if (!before || !after) {
    return next(
      new AppError(
        "Missing required fields: before and after",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (!Array.isArray(before.readOnly) || !Array.isArray(before.readWrite)) {
    return next(
      new AppError(
        "Invalid before footprint: readOnly and readWrite must be arrays",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (!Array.isArray(after.readOnly) || !Array.isArray(after.readWrite)) {
    return next(
      new AppError(
        "Invalid after footprint: readOnly and readWrite must be arrays",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  try {
    const diff = footprintDiff(before, after);
    if (req.query.format === "markdown") {
      res
        .status(HTTP_STATUS.OK)
        .type("text/markdown")
        .send(formatDiffAsMarkdown(diff));
      return;
    }
    const response: ResponseEnvelope = {
      success: true,
      data: diff,
    };
    res.status(HTTP_STATUS.OK).json(response);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function validate(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { xdr, network } = req.body as {
    xdr?: string;
    network?: string;
  };

  if (!xdr || typeof xdr !== "string" || xdr.trim() === "") {
    return next(
      new AppError(ERROR_MESSAGES.MISSING_XDR, HTTP_STATUS.BAD_REQUEST),
    );
  }

  if (
    network &&
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  const net: Network = (network as Network) || DEFAULT_NETWORK;

  try {
    const result = validateXdr(xdr, net);
    const response: ResponseEnvelope = {
      success: true,
      data: {
        ...result,
        network: net,
      },
    };
    res.status(HTTP_STATUS.OK).json(response);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function restore(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { xdr, network } = req.body as { xdr?: string; network?: string };

  const xdrCheck = validateXdrInput(xdr);
  if (!xdrCheck.valid) {
    return next(new AppError(xdrCheck.error!, HTTP_STATUS.BAD_REQUEST));
  }

  if (
    network &&
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  const net: Network = (network as Network) || DEFAULT_NETWORK;

  try {
    const result = await buildRestoreTransaction(xdr!, net);
    const response: ResponseEnvelope = { success: true, data: result };
    res.status(HTTP_STATUS.OK).json(response);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function invalidateCache(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const cache = getCache();
    await cache.flush();
    res
      .status(HTTP_STATUS.OK)
      .json({ message: "Cache invalidated", backend: cache.backend });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function invalidateContractCacheController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { contractId } = req.params as { contractId?: string };
    if (!contractId || contractId.trim() === "") {
      return next(
        new AppError(
          "Missing required parameter: contractId",
          HTTP_STATUS.BAD_REQUEST,
        ),
      );
    }

    if (!isValidContractId(contractId)) {
      return next(
        new AppError(
          "Invalid contract ID: must be a valid Stellar contract StrKey",
          HTTP_STATUS.BAD_REQUEST,
        ),
      );
    }

    const count = await invalidateContractCache(contractId);
    res.status(HTTP_STATUS.OK).json({
      success: true,
      purgedKeysCount: count,
    });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

/**
 * Validate a Stellar contract ID (StrKey, "C..." format).
 * Uses the Stellar SDK when available and falls back to a structural check.
 */
function isValidContractId(contractId: string): boolean {
  try {
    const StellarSdk = require("@stellar/stellar-sdk") as {
      StrKey?: { isValidContract: (value: string) => boolean };
    };
    if (StellarSdk?.StrKey?.isValidContract) {
      return StellarSdk.StrKey.isValidContract(contractId);
    }
  } catch {
    // fall through to structural validation
  }
  return /^C[A-Z2-7]{55}$/.test(contractId);
}

export async function estimateFeeController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const {
    cpuInsns,
    memBytes,
    network,
    operationType,
    footprint,
    xdr,
    extendTo,
  } = req.body as {
    cpuInsns?: string;
    memBytes?: string;
    network?: Network;
  } & FeeEstimateOptions;

  if (
    operationType !== undefined &&
    !["invoke", "restore", "extend"].includes(operationType)
  ) {
    return next(
      new AppError(
        "operationType must be invoke, restore or extend",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  const maintenance = operationType === "restore" || operationType === "extend";
  if (!maintenance && (!cpuInsns || !memBytes)) {
    return next(
      new AppError(
        "Missing required fields: cpuInsns and memBytes",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  if (
    [cpuInsns, memBytes].some(
      (value) =>
        value !== undefined &&
        (typeof value !== "string" || !/^\d+$/.test(value)),
    )
  ) {
    return next(
      new AppError(
        "cpuInsns and memBytes must be non-negative integer strings",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  if (
    network &&
    ![NETWORKS.MAINNET, NETWORKS.TESTNET, NETWORKS.FUTURENET].includes(network)
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }
  const net: Network = network || DEFAULT_NETWORK;
  if (maintenance && !xdr && !footprint) {
    return next(
      new AppError(
        "Restoration and extension estimates require xdr or footprint",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  if (
    extendTo !== undefined &&
    (!Number.isInteger(extendTo) || extendTo < 0 || extendTo > 0xffffffff)
  ) {
    return next(
      new AppError(
        "extendTo must be an unsigned 32-bit integer",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  if (operationType === "extend" && !xdr && extendTo === undefined) {
    return next(
      new AppError(
        "Extension estimates require extendTo",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }
  if (footprint) {
    try {
      if (
        !Array.isArray(footprint.readOnly) ||
        !Array.isArray(footprint.readWrite) ||
        [...footprint.readOnly, ...footprint.readWrite].some(
          (key) => typeof key !== "string",
        )
      )
        throw new Error("Invalid footprint");
      calculateFootprintStats(footprint.readOnly, footprint.readWrite);
      if (
        maintenance &&
        (operationType === "restore"
          ? footprint.readOnly.length > 0
          : footprint.readWrite.length > 0)
      ) {
        throw new Error(
          "Restoration requires only readWrite keys; extension requires only readOnly keys",
        );
      }
    } catch {
      return next(
        new AppError(
          "Invalid footprint for selected operation",
          HTTP_STATUS.BAD_REQUEST,
        ),
      );
    }
  }
  if (xdr !== undefined) {
    const check = validateXdrInput(xdr);
    if (!check.valid)
      return next(
        new AppError(check.error ?? "Invalid XDR", HTTP_STATUS.BAD_REQUEST),
      );
    if (maintenance) {
      try {
        const parsed = StellarSdk.TransactionBuilder.fromXDR(
          xdr,
          NETWORK_PASSPHRASES[net],
        );
        const inner =
          parsed instanceof StellarSdk.FeeBumpTransaction
            ? parsed.innerTransaction
            : parsed;
        const expected =
          operationType === "restore"
            ? "restoreFootprint"
            : "extendFootprintTtl";
        if (
          inner.operations.length !== 1 ||
          inner.operations[0].type !== expected
        )
          throw new Error("Mismatched operation");
      } catch {
        return next(
          new AppError(
            "XDR must contain exactly one operation matching operationType",
            HTTP_STATUS.BAD_REQUEST,
          ),
        );
      }
    }
  }
  try {
    const options: FeeEstimateOptions = {
      operationType,
      footprint,
      xdr,
      extendTo,
    };
    const result = await estimateFee(
      cpuInsns ?? "0",
      memBytes ?? "0",
      net,
      options,
    );
    res.status(HTTP_STATUS.OK).json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export function decode(req: Request, res: Response, next: NextFunction): void {
  const { xdr, type = "transaction" } = req.query as {
    xdr?: string;
    type?: string;
  };

  const xdrCheck = validateXdrInput(xdr);
  if (!xdrCheck.valid) {
    return next(new AppError(xdrCheck.error!, HTTP_STATUS.BAD_REQUEST));
  }

  const validTypes: XdrType[] = [
    "transaction",
    "operation",
    "ledger_key",
    "auth_entry",
  ];
  if (!validTypes.includes(type as XdrType)) {
    return next(
      new AppError(
        `Invalid type. Supported types: ${validTypes.join(", ")}`,
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  const result = decodeXdr(xdr!, type as XdrType);

  if (!result.success) {
    return next(
      new AppError(
        result.error ?? "Failed to decode XDR",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  res.status(HTTP_STATUS.OK).json(result);
}

export async function costBreakdownController(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { cpuInsns, memBytes, network } = req.query as {
    cpuInsns?: string;
    memBytes?: string;
    network?: string;
  };

  if (!cpuInsns || !memBytes) {
    return next(
      new AppError(
        "Missing required query parameters: cpuInsns and memBytes",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (!/^\d+$/.test(cpuInsns) || !/^\d+$/.test(memBytes)) {
    return next(
      new AppError(
        "cpuInsns and memBytes must be non-negative integer strings",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  if (
    network &&
    network !== NETWORKS.MAINNET &&
    network !== NETWORKS.TESTNET &&
    network !== NETWORKS.FUTURENET
  ) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }

  const net: Network = (network as Network) || DEFAULT_NETWORK;

  try {
    const result = await estimateFeeDetailed(cpuInsns, memBytes, net);
    res.status(HTTP_STATUS.OK).json(result);
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export function openApiSpec(req: Request, res: Response): void {
  const fs = require("fs") as typeof import("fs");
  const YAML = require("yaml") as { parse: (s: string) => unknown };
  const specPath = path.join(__dirname, "..", "..", "openapi.yaml");
  if (!fs.existsSync(specPath)) {
    res.status(404).json({
      success: false,
      error: "OpenAPI spec not found",
      code: ErrorCode.OPENAPI_SPEC_NOT_FOUND,
    });
    return;
  }
  res.json(YAML.parse(fs.readFileSync(specPath, "utf8")));
}

// ---------------------------------------------------------------------------
// #333 — Dry-run: parse XDR locally, no RPC call
// ---------------------------------------------------------------------------

export function simulateDryRun(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { xdr, network } = req.body as { xdr?: string; network?: string };

  const xdrCheck = validateXdrInput(xdr);
  if (!xdrCheck.valid) {
    return next(new AppError(xdrCheck.error!, HTTP_STATUS.BAD_REQUEST));
  }

  const net = (network as Network) || DEFAULT_NETWORK;
  if (![NETWORKS.TESTNET, NETWORKS.MAINNET, NETWORKS.FUTURENET].includes(net)) {
    return next(
      new AppError(ERROR_MESSAGES.INVALID_NETWORK, HTTP_STATUS.BAD_REQUEST),
    );
  }
  try {
    res.status(HTTP_STATUS.OK).json(analyzeDryRun(xdr!, net));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to parse XDR";
    next(new AppError(message, HTTP_STATUS.BAD_REQUEST));
  }
}

// ---------------------------------------------------------------------------
// #331 — Simulation history per IP (in-memory, last 100, with TTL)
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  timestamp: string;
  network: string;
  success: boolean;
  readOnlyCount: number;
  readWriteCount: number;
}

const HISTORY_MAX = 100;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

// ip -> array of entries (newest last)
const historyStore = new Map<
  string,
  { entry: HistoryEntry; expiresAt: number }[]
>();

export function recordHistory(ip: string, entry: HistoryEntry): void {
  let list = historyStore.get(ip) ?? [];
  // Evict expired
  const now = Date.now();
  list = list.filter((e) => e.expiresAt > now);
  list.push({ entry, expiresAt: now + HISTORY_TTL_MS });
  if (list.length > HISTORY_MAX) list.shift();
  historyStore.set(ip, list);
}

export function getSimulateHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const ip =
      (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";

    const limitRaw = req.query.limit as string | undefined;
    const offsetRaw = req.query.offset as string | undefined;
    const status = req.query.status as string | undefined;

    const limit = limitRaw === undefined ? 20 : parseInt(limitRaw, 10);
    const offset = offsetRaw === undefined ? 0 : parseInt(offsetRaw, 10);

    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      return next(new AppError("Invalid limit", HTTP_STATUS.BAD_REQUEST));
    }
    if (Number.isNaN(offset) || offset < 0) {
      return next(new AppError("Invalid offset", HTTP_STATUS.BAD_REQUEST));
    }
    if (status !== undefined && status !== "success" && status !== "failed") {
      return next(new AppError("Invalid status", HTTP_STATUS.BAD_REQUEST));
    }

    const now = Date.now();
    let raw = (historyStore.get(ip) ?? []).filter((e) => e.expiresAt > now);
    let entries = raw.map((e) => e.entry).reverse();
    if (status === "success") entries = entries.filter((e) => e.success);
    if (status === "failed") entries = entries.filter((e) => !e.success);

    const total = entries.length;
    const data = entries.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    const page = Math.floor(offset / limit) + 1;

    res.status(HTTP_STATUS.OK).json({ page, limit, total, hasMore, data });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

export async function rpcGateway(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { jsonrpc, id, method, params } = req.body ?? {};
  if (jsonrpc !== "2.0" || id === undefined) {
    res.status(400).json({ jsonrpc: "2.0", id: id ?? null, error: { code: -32600, message: "Invalid Request" } });
    return;
  }
  try {
    if (method === "simulateTransaction") {
      const [xdr, network] = params ?? [];
      const result = await simulateTransaction(xdr, network || "testnet");
      res.json({ jsonrpc: "2.0", id, result });
      return;
    }
    if (method === "estimateFee") {
      res.json({ jsonrpc: "2.0", id, result: {} });
      return;
    }
    if (method === "decodeXdr") {
      const [xdr, type] = params ?? [];
      const result = decodeXdr(xdr, (type as any) || "transaction");
      res.json({ jsonrpc: "2.0", id, result });
      return;
    }
    res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  } catch (err) {
    res.status(400).json({ jsonrpc: "2.0", id, error: { code: -32602, message: (err as Error).message } });
  }
}
// ---------------------------------------------------------------------------
// Issue #24 — Server-Sent Events endpoint for real-time batch simulation status
// ---------------------------------------------------------------------------

const SSE_PING_INTERVAL_MS = 15_000;

export async function simulateBatchStream(
  req: Request,
  res: Response,
): Promise<void> {
  // Parse XDRs from query parameter: comma-separated string or JSON array.
  const rawXdrs = req.query.xdrs as string | undefined;
  let xdrs: string[] = [];

  if (rawXdrs) {
    try {
      const parsed = JSON.parse(rawXdrs);
      if (Array.isArray(parsed)) {
        xdrs = parsed.map(String);
      } else {
        xdrs = rawXdrs
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
    } catch {
      xdrs = rawXdrs
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }

  const networkParam = (req.query.network as string) || DEFAULT_NETWORK;
  const network: Network = (networkParam as Network) || DEFAULT_NETWORK;

  // Set SSE headers before writing any data.
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (event: string, data: unknown): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Keep-alive ping every 15 seconds.
  const pingInterval = setInterval(() => {
    res.write(": ping\n\n");
  }, SSE_PING_INTERVAL_MS);

  const cleanup = (): void => {
    clearInterval(pingInterval);
  };

  req.on("close", cleanup);

  const total = xdrs.length;

  if (total === 0) {
    send("complete", { total: 0, message: "No XDRs provided" });
    cleanup();
    res.end();
    return;
  }

  for (let index = 0; index < total; index++) {
    const xdr = xdrs[index];

    // Emit progress before simulating.
    send("progress", { index, total, status: "simulating" });

    try {
      const result = await simulateTransaction(
        xdr,
        network,
        res.locals.abortSignal,
      );

      send("result", {
        index,
        success: result.success,
        footprint: result.success ? result.footprint : null,
        cost: result.success ? result.cost : null,
        error: result.success ? undefined : result.error,
      });
    } catch (err: unknown) {
      send("result", {
        index,
        success: false,
        footprint: null,
        cost: null,
        error:
          err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR,
      });
    }
  }

  send("complete", { total, message: "Batch simulation finished" });
  cleanup();
  res.end();
}

export function getSimulationJob(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { jobId } = req.params as { jobId?: string };

  if (!jobId) {
    return next(new AppError("Webhook job not found", HTTP_STATUS.NOT_FOUND));
  }

  const job = getJob(jobId);
  if (!job) {
    return next(new AppError("Webhook job not found", HTTP_STATUS.NOT_FOUND));
  }

  const response: ResponseEnvelope = {
    success: true,
    data: job,
  };
  res.status(HTTP_STATUS.OK).json(response);
}

// ---------------------------------------------------------------------------
// #40 — GET /rpc/status — Live RPC pool stats and circuit breaker state
// ---------------------------------------------------------------------------

export function rpcStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  try {
    const adminKey = process.env.ADMIN_API_KEY;
    if (adminKey) {
      const provided =
        (req.headers["x-admin-key"] as string | undefined) ||
        (req.headers["authorization"] as string | undefined)?.replace(
          "Bearer ",
          "",
        );
      if (provided !== adminKey) {
        return next(new AppError("Unauthorized", HTTP_STATUS.UNAUTHORIZED));
      }
    }
    const stats = getRpcStats();
    res.status(HTTP_STATUS.OK).json({ success: true, data: stats });
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : ERROR_MESSAGES.UNEXPECTED_ERROR;
    next(new AppError(message, HTTP_STATUS.INTERNAL_SERVER_ERROR));
  }
}

// ---------------------------------------------------------------------------
// POST /simulate/jobs/:jobId/retry — manually redeliver a dead-lettered webhook
// ---------------------------------------------------------------------------

export async function retrySimulationJob(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { jobId } = req.params as { jobId?: string };

  if (!jobId) {
    return next(new AppError("Webhook job not found", HTTP_STATUS.NOT_FOUND));
  }

  const job = getJob(jobId);
  if (!job) {
    return next(new AppError("Webhook job not found", HTTP_STATUS.NOT_FOUND));
  }

  const retried = await retryDeadLetter(jobId);
  if (!retried) {
    return next(
      new AppError(
        "Only dead-lettered jobs can be retried",
        HTTP_STATUS.BAD_REQUEST,
      ),
    );
  }

  res.status(HTTP_STATUS.OK).json({
    success: true,
    data: {
      jobId,
      status: "pending",
      deliveryStatus: "pending",
      message: "Webhook redelivery scheduled",
    },
  });
}
