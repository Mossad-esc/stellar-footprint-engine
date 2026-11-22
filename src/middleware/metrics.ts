import { Request, Response, NextFunction } from "express";
import client from "prom-client";

// Create a Registry to register the metrics
const register = new client.Registry();

// Add default metrics
client.collectDefaultMetrics({
  register,
  prefix: "stellar_footprint_service_",
});

// HTTP request metrics
const httpRequestsTotal = new client.Counter({
  name: "http_requests_total",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code", "network"],
  registers: [register],
});

const httpRequestDuration = new client.Histogram({
  name: "http_request_duration_seconds",
  help: "Duration of HTTP requests in seconds",
  labelNames: ["method", "route", "network"],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register],
});

const simulateRequestsTotal = new client.Counter({
  name: "simulate_requests_total",
  help: "Total number of Stellar simulations",
  labelNames: ["network", "status"],
  registers: [register],
});

const simulateDurationSeconds = new client.Histogram({
  name: "simulate_duration_seconds",
  help: "Duration of Stellar simulations in seconds",
  labelNames: ["network"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  registers: [register],
});

const rpcErrorsTotal = new client.Counter({
  name: "rpc_errors_total",
  help: "Total number of RPC errors",
  labelNames: ["network", "error_type"],
  registers: [register],
});

// Cache metrics
const cacheHitsTotal = new client.Counter({
  name: "cache_hits_total",
  help: "Total number of cache hits",
  labelNames: ["cache_type"],
  registers: [register],
});

const cacheMissesTotal = new client.Counter({
  name: "cache_misses_total",
  help: "Total number of cache misses",
  labelNames: ["cache_type"],
  registers: [register],
});

const cacheOperationsTotal = new client.Counter({
  name: "cache_operations_total",
  help: "Total number of cache operations",
  labelNames: ["tier", "operation", "status"],
  registers: [register],
});

const cacheMemoryKeysCount = new client.Gauge({
  name: "cache_memory_keys_count",
  help: "Number of keys in the in-memory cache",
  registers: [register],
});

const cacheMemoryBytesEstimate = new client.Gauge({
  name: "cache_memory_bytes_estimate",
  help: "Estimated memory usage of the in-memory cache in bytes",
  registers: [register],
});

const cacheEvictionsTotal = new client.Counter({
  name: "cache_evictions_total",
  help: "Total number of cache evictions",
  labelNames: ["tier"],
  registers: [register],
});

const cacheEmergencyTrimsTotal = new client.Counter({
  name: "cache_emergency_trims_total",
  help: "Total number of emergency heap-pressure trims",
  registers: [register],
});

// Tracking active simulations
const activeSimulations = new client.Gauge({
  name: "active_simulations",
  help: "Number of currently active simulations",
  registers: [register],
});

// Cache operation latency histogram
const cacheOperationDuration = new client.Histogram({
  name: "cache_operation_duration_seconds",
  help: "Duration of cache get/set operations in seconds",
  labelNames: ["operation", "backend"],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5],
  registers: [register],
});

// XDR payload size histogram
const simulateRequestXdrBytes = new client.Histogram({
  name: "simulate_request_xdr_bytes",
  help: "Size of incoming XDR payloads in bytes",
  buckets: [256, 512, 1024, 4096, 16384, 65536],
  registers: [register],
});

// Footprint entry count histogram (#423)
const footprintEntriesHistogram = new client.Histogram({
  name: "simulate_footprint_entries",
  help: "Number of footprint entries per simulation",
  labelNames: ["type"],
  buckets: [0, 1, 2, 5, 10, 20, 50, 100],
  registers: [register],
});

// Middleware to track HTTP metrics
export function metricsMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const start = Date.now();

  res.on("finish", () => {
    const duration = (Date.now() - start) / 1000;
    const route = req.route?.path || req.path;
    const isSimulateRoute = route.includes("/simulate");
    const network =
      isSimulateRoute && req.body?.network ? (req.body.network as string) : "";

    httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode.toString(),
      network,
    });

    httpRequestDuration.observe(
      {
        method: req.method,
        route,
        network,
      },
      duration,
    );
  });

  next();
}

// Metrics tracking functions
export const metrics = {
  recordCacheHit: (cacheType: string = "simulation") => {
    cacheHitsTotal.inc({ cache_type: cacheType });
    cacheOperationsTotal.inc({ tier: "memory", operation: "get", status: "hit" });
  },

  recordCacheMiss: (cacheType: string = "simulation") => {
    cacheMissesTotal.inc({ cache_type: cacheType });
    cacheOperationsTotal.inc({ tier: "memory", operation: "get", status: "miss" });
  },

  recordCacheLatency: (
    operation: "get" | "set",
    backend: string,
    durationSeconds: number,
  ) => {
    cacheOperationDuration.observe({ operation, backend }, durationSeconds);
  },

  recordCacheOperation: (
    tier: "memory" | "redis",
    operation: "get" | "set" | "delete" | "flush",
    status: "hit" | "miss" | "success" | "error",
  ) => {
    cacheOperationsTotal.inc({ tier, operation, status });
  },

  recordMemoryCacheKeys: (count: number) => {
    cacheMemoryKeysCount.set(count);
  },

  recordMemoryCacheBytes: (bytes: number) => {
    cacheMemoryBytesEstimate.set(bytes);
  },

  recordCacheEviction: (tier: "memory" | "redis") => {
    cacheEvictionsTotal.inc({ tier });
  },

  recordEmergencyTrim: () => {
    cacheEmergencyTrimsTotal.inc();
  },

  recordSimulation: (network: string, success: boolean) => {
    simulateRequestsTotal.inc({
      network,
      status: success ? "success" : "failure",
    });
  },

  recordSimulationDuration: (network: string, durationInSeconds: number) => {
    simulateDurationSeconds.observe({ network }, durationInSeconds);
  },

  recordRpcError: (network: string, errorType: string) => {
    rpcErrorsTotal.inc({ network, error_type: errorType });
  },

  incrementActiveSimulations: () => {
    activeSimulations.inc();
  },

  decrementActiveSimulations: () => {
    activeSimulations.dec();
  },

  recordXdrBytes: (bytes: number) => {
    simulateRequestXdrBytes.observe(bytes);
  },

  recordFootprintEntries: (readOnly: number, readWrite: number) => {
    footprintEntriesHistogram.observe({ type: "read_only" }, readOnly);
    footprintEntriesHistogram.observe({ type: "read_write" }, readWrite);
  },

  getMetrics: async (): Promise<string> => {
    return await register.metrics();
  },

  getRegister: () => register,
};

export default metrics;
