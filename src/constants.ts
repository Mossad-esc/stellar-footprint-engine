export const NETWORKS = {
  MAINNET: "mainnet",
  TESTNET: "testnet",
  FUTURENET: "futurenet",
} as const;

export const DEFAULT_NETWORK = NETWORKS.TESTNET;

export const RPC_URLS = {
  TESTNET: "https://soroban-testnet.stellar.org",
} as const;

/**
 * Cache TTL values in milliseconds for various caching layers.
 * - NETWORK_STATUS_MS: How long to cache network status responses (10 s)
 * - CONTRACT_EXISTENCE_MS: How long to cache contract existence lookups (30 s)
 * - RPC_POOL_MS: How long an RPC server connection is reused before recreation (5 min)
 * - SIMULATION_MS: How long to cache simulation results (1 min)
 */
export const CACHE_TTL = {
  NETWORK_STATUS_MS: 10000,
  CONTRACT_EXISTENCE_MS: 30000,
  RPC_POOL_MS: 300000,
  SIMULATION_MS: 60000,
} as const;

export const CACHE_TTL_MS =
  parseInt(process.env.CACHE_TTL_MS ?? "60000", 10) || 60000;

/** Simulation result LRU cache — configurable via env vars */
export const SIMULATION_CACHE_TTL_MS =
  (parseInt(process.env.CACHE_TTL_SECONDS ?? "60", 10) || 60) * 1000;
export const SIMULATION_CACHE_MAX_SIZE =
  parseInt(process.env.CACHE_MAX_SIZE ?? "500", 10) || 500;

const _batchMaxSizeEnv = parseInt(process.env.BATCH_MAX_SIZE ?? "10", 10);
export const BATCH_MAX_SIZE =
  Number.isFinite(_batchMaxSizeEnv) && _batchMaxSizeEnv > 0
    ? _batchMaxSizeEnv
    : 10;

export enum ErrorCode {
  MISSING_XDR = "MISSING_XDR",
  INVALID_NETWORK = "INVALID_NETWORK",
  RPC_URL_NOT_CONFIGURED = "RPC_URL_NOT_CONFIGURED",
  LEDGER_ENTRY_RESTORATION_REQUIRED = "LEDGER_ENTRY_RESTORATION_REQUIRED",
  TRANSACTION_DATA_MISSING = "TRANSACTION_DATA_MISSING",
  UNEXPECTED_ERROR = "UNEXPECTED_ERROR",
  INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR",
  BAD_REQUEST = "BAD_REQUEST",
  UNPROCESSABLE_ENTITY = "UNPROCESSABLE_ENTITY",
  FORBIDDEN = "FORBIDDEN",
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",
  REQUEST_TIMEOUT = "REQUEST_TIMEOUT",
  CONTENT_TYPE_INVALID = "CONTENT_TYPE_INVALID",
  OPENAPI_SPEC_NOT_FOUND = "OPENAPI_SPEC_NOT_FOUND",
  INVALID_XDR = "INVALID_XDR",
  INVALID_XDR_TYPE = "INVALID_XDR_TYPE",
  MISSING_REQUIRED_FIELDS = "MISSING_REQUIRED_FIELDS",
  INVALID_QUERY_PARAMETERS = "INVALID_QUERY_PARAMETERS",
  INVALID_LEDGER_SEQUENCE = "INVALID_LEDGER_SEQUENCE",
  BATCH_SIZE_EXCEEDED = "BATCH_SIZE_EXCEEDED",
  TRANSACTION_MISSING_SOROBAN_OPERATION = "TRANSACTION_MISSING_SOROBAN_OPERATION",
  RPC_SIMULATION_ERROR = "RPC_SIMULATION_ERROR",
  SIMULATION_RESTORE_REQUIRED = "SIMULATION_RESTORE_REQUIRED",
  SIMULATION_DATA_MISSING = "SIMULATION_DATA_MISSING",
  CIRCUIT_OPEN = "CIRCUIT_OPEN",
  JOB_NOT_FOUND = "JOB_NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
}

export const ERROR_MESSAGES = {
  MISSING_XDR: "Missing required field: xdr",
  INVALID_NETWORK: "Invalid network. Use 'testnet', 'mainnet', or 'futurenet'",
  RPC_URL_NOT_CONFIGURED: "RPC URL not configured for network",
  LEDGER_ENTRY_RESTORATION_REQUIRED:
    "Transaction requires ledger entry restoration before simulation.",
  TRANSACTION_DATA_MISSING:
    "Simulation succeeded but transactionData is missing; cannot extract footprint.",
  UNEXPECTED_ERROR: "Unexpected error",
  INVALID_LEDGER_SEQUENCE: "ledgerSequence must be a positive integer",
} as const;

export function getErrorCodeByMessage(
  message: string,
  statusCode: number,
): ErrorCode {
  switch (message) {
    case ERROR_MESSAGES.MISSING_XDR:
      return ErrorCode.MISSING_XDR;
    case ERROR_MESSAGES.INVALID_NETWORK:
      return ErrorCode.INVALID_NETWORK;
    case ERROR_MESSAGES.RPC_URL_NOT_CONFIGURED:
      return ErrorCode.RPC_URL_NOT_CONFIGURED;
    case ERROR_MESSAGES.LEDGER_ENTRY_RESTORATION_REQUIRED:
      return ErrorCode.SIMULATION_RESTORE_REQUIRED;
    case ERROR_MESSAGES.TRANSACTION_DATA_MISSING:
      return ErrorCode.SIMULATION_DATA_MISSING;
    case ERROR_MESSAGES.UNEXPECTED_ERROR:
      return ErrorCode.UNEXPECTED_ERROR;
    case "Missing required field: transactions (must be a non-empty array)":
    case "Missing required fields: before and after":
    case "Missing required query parameters: cpuInsns and memBytes":
    case "Missing required fields: cpuInsns and memBytes":
      return ErrorCode.MISSING_REQUIRED_FIELDS;
    case ERROR_MESSAGES.INVALID_LEDGER_SEQUENCE:
      return ErrorCode.INVALID_LEDGER_SEQUENCE;
    case "cpuInsns and memBytes must be non-negative integer strings":
      return ErrorCode.INVALID_QUERY_PARAMETERS;
    case "Transaction must contain a Soroban operation (invokeHostFunction).":
      return ErrorCode.TRANSACTION_MISSING_SOROBAN_OPERATION;
    case "Too many failed requests. Try again later.":
    case "Too Many Requests":
      return ErrorCode.RATE_LIMIT_EXCEEDED;
    case "Request timed out":
      return ErrorCode.REQUEST_TIMEOUT;
    case "Forbidden":
      return ErrorCode.FORBIDDEN;
    case "OpenAPI spec not found":
      return ErrorCode.OPENAPI_SPEC_NOT_FOUND;
    case "Webhook job not found":
      return ErrorCode.JOB_NOT_FOUND;
    case "Content-Type must be application/json":
      return ErrorCode.CONTENT_TYPE_INVALID;
    default:
      break;
  }

  if (message.startsWith("Invalid type.")) {
    return ErrorCode.INVALID_XDR_TYPE;
  }
  if (message.startsWith("Invalid XDR")) {
    return ErrorCode.INVALID_XDR;
  }
  if (message.startsWith("Failed to decode XDR")) {
    return ErrorCode.INVALID_XDR;
  }
  if (message.startsWith("Transaction simulation failed:")) {
    return ErrorCode.RPC_SIMULATION_ERROR;
  }

  if (message.startsWith("Missing required field: xdr")) {
    return ErrorCode.MISSING_XDR;
  }

  switch (statusCode) {
    case HTTP_STATUS.BAD_REQUEST:
      return ErrorCode.BAD_REQUEST;
    case HTTP_STATUS.UNPROCESSABLE_ENTITY:
      return ErrorCode.UNPROCESSABLE_ENTITY;
    case HTTP_STATUS.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HTTP_STATUS.NOT_FOUND:
      return ErrorCode.OPENAPI_SPEC_NOT_FOUND;
    case HTTP_STATUS.GATEWAY_TIMEOUT:
      return ErrorCode.REQUEST_TIMEOUT;
    case HTTP_STATUS.SERVICE_UNAVAILABLE:
      return ErrorCode.CIRCUIT_OPEN;
    default:
      return ErrorCode.INTERNAL_SERVER_ERROR;
  }
}

export const HTTP_STATUS = {
  OK: 200,
  ACCEPTED: 202,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  UNPROCESSABLE_ENTITY: 422,
  UNSUPPORTED_MEDIA_TYPE: 415,
  FORBIDDEN: 403,
  TOO_MANY_REQUESTS: 429,
  NOT_FOUND: 404,
  GATEWAY_TIMEOUT: 504,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  SERVICE_UNAVAILABLE: 503,
} as const;
