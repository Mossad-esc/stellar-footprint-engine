import { Request, Response, NextFunction } from "express";

import { ErrorCode, getErrorCodeByMessage } from "../constants";
import { Translations, getTranslations } from "../i18n";
import { en } from "../i18n/en";
import { ProblemDetails, ResponseEnvelope } from "../types";
import { AppError } from "../utils/AppError";

interface CircuitOpenError extends Error {
  circuitOpen: true;
  retryAfter: number;
}

interface AppErrorLike extends Error {
  statusCode?: number;
  code?: ErrorCode;
}

interface BodyParserError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

const PAYLOAD_TOO_LARGE_MESSAGE = "Payload Too Large";

function isPayloadTooLargeError(err: unknown): err is BodyParserError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as BodyParserError;
  return (
    e.type === "entity.too.large" ||
    e.status === 413 ||
    e.statusCode === 413
  );
}

function isCircuitOpenError(err: unknown): err is CircuitOpenError {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as CircuitOpenError).circuitOpen === true
  );
}

function isAppError(err: unknown): err is AppErrorLike {
  return (
    typeof err === "object" &&
    err !== null &&
    typeof (err as AppErrorLike).message === "string" &&
    typeof (err as AppErrorLike).statusCode === "number"
  );
}

/** Build a reverse map from English message value → translation key */
const enValueToKey = Object.fromEntries(
  Object.entries(en).map(([k, v]) => [v, k]),
) as Record<string, keyof Translations>;

// ---------------------------------------------------------------------------
// #41 — RFC 7807 support
// ---------------------------------------------------------------------------

/** Map from ErrorCode to a short human-readable title. */
const errorCodeTitles: Partial<Record<ErrorCode, string>> = {
  [ErrorCode.MISSING_XDR]: "Missing XDR",
  [ErrorCode.INVALID_NETWORK]: "Invalid Network",
  [ErrorCode.RPC_URL_NOT_CONFIGURED]: "RPC URL Not Configured",
  [ErrorCode.CIRCUIT_OPEN]: "Circuit Breaker Open",
  [ErrorCode.RATE_LIMIT_EXCEEDED]: "Rate Limit Exceeded",
  [ErrorCode.REQUEST_TIMEOUT]: "Request Timeout",
  [ErrorCode.INTERNAL_SERVER_ERROR]: "Internal Server Error",
  [ErrorCode.UNAUTHORIZED]: "Unauthorized",
  [ErrorCode.FORBIDDEN]: "Forbidden",
};

function titleForCode(code: ErrorCode): string {
  if (errorCodeTitles[code]) return errorCodeTitles[code]!;
  // Fallback: replace underscores with spaces and title-case each word
  return code
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function acceptsProblemJson(req: Request): boolean {
  const accept = req.headers["accept"] ?? "";
  return accept.includes("application/problem+json");
}

export function errorHandler(
  err: Error | AppError,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const t = getTranslations(req.headers["accept-language"]);

  if (isPayloadTooLargeError(err)) {
    const code = ErrorCode.PAYLOAD_TOO_LARGE ?? ErrorCode.FORBIDDEN;

    if (acceptsProblemJson(req)) {
      res.set("Content-Type", "application/problem+json");
      res.status(413).json({
        type: `https://docs.stellarfootprint.org/errors/${code}`,
        title: titleForCode(code),
        status: 413,
        detail: PAYLOAD_TOO_LARGE_MESSAGE,
        instance: req.path ?? req.url ?? "/",
      } satisfies ProblemDetails);
      return;
    }

    res.status(413).json({
      success: false,
      error: PAYLOAD_TOO_LARGE_MESSAGE,
      code,
      ...(res.locals.requestId
        ? { requestId: res.locals.requestId as string }
        : {}),
    } satisfies ResponseEnvelope & { requestId?: string });
    return;
  }

  if (isCircuitOpenError(err)) {
    res.set("Retry-After", String(err.retryAfter));
    const code = ErrorCode.CIRCUIT_OPEN;

    if (acceptsProblemJson(req)) {
      res.set("Content-Type", "application/problem+json");
      res.status(503).json({
        type: `https://docs.stellarfootprint.org/errors/${code}`,
        title: titleForCode(code),
        status: 503,
        detail: err.message,
        instance: req.path ?? req.url ?? "/",
      } satisfies ProblemDetails);
      return;
    }

    res.status(503).json({
      success: false,
      error: t.CIRCUIT_OPEN,
      code,
      ...(res.locals.requestId
        ? { requestId: res.locals.requestId as string }
        : {}),
    } satisfies ResponseEnvelope & { requestId?: string });
    return;
  }

  const statusCode =
    isAppError(err) && typeof err.statusCode === "number"
      ? err.statusCode
      : 500;
  const rawMessage =
    err instanceof Error && err.message ? err.message : "Internal server error";

  const key = enValueToKey[rawMessage];
  const message = key ? (t[key] as string) : rawMessage;
  const code =
    isAppError(err) && err.code
      ? err.code
      : getErrorCodeByMessage(rawMessage, statusCode);

  if (acceptsProblemJson(req)) {
    res.set("Content-Type", "application/problem+json");
    res.status(statusCode).json({
      type: `https://docs.stellarfootprint.org/errors/${code}`,
      title: titleForCode(code),
      status: statusCode,
      detail: rawMessage,
      instance: req.path ?? req.url ?? "/",
    } satisfies ProblemDetails);
    return;
  }

  const response: ResponseEnvelope & { requestId?: string } = {
    success: false,
    error: message,
    code,
    ...(res.locals.requestId
      ? { requestId: res.locals.requestId as string }
      : {}),
  };

  res.status(statusCode).json(response);
}
