import { Router } from "express";

import {
  health,
  liveness,
  readiness,
  simulate,
  simulateBatch,
  getSimulationJob,
  footprintDiffController,
  validate,
  networkStatus,
  decode,
  restore,
  invalidateCache,
  estimateFeeController,
  costBreakdownController,
  openApiSpec,
  supportedNetworks,
  simulateDryRun,
  getSimulateHistory,
} from "./controllers";
import {
  simulateRateLimiter,
  decodeRateLimiter,
  feeRateLimiter,
} from "../middleware/rateLimiter";

const router = Router();

// GET /health — liveness check for load balancers and uptime monitors (deprecated, use /health/live)
router.get("/health", health);

// GET /health/live — liveness check (process is running)
router.get("/health/live", liveness);

// GET /health/ready — readiness check (Redis and RPC circuit breaker are healthy)
router.get("/health/ready", readiness);

// GET /simulate/supported-networks — returns list of networks with configured RPC URLs
router.get("/simulate/supported-networks", supportedNetworks);

// POST /simulate — accepts { xdr, network } and returns footprint + cost
router.post("/simulate", simulateRateLimiter, simulate);

// POST /simulate/dry-run — parse XDR locally, return metadata without calling RPC
router.post("/simulate/dry-run", simulateDryRun);

// GET /simulate/history — return last N simulation results for the caller's IP
router.get("/simulate/history", getSimulateHistory);

// GET /simulate/jobs/:jobId — inspect async webhook simulation delivery status
router.get("/simulate/jobs/:jobId", getSimulationJob);

// POST /simulate/batch — accepts { transactions: [{ xdr }], network } and returns array of results
router.post("/simulate/batch", simulateBatch);

// GET /simulate/cost-breakdown — accepts ?cpuInsns=&memBytes=&network= and returns detailed cost breakdown
router.get("/simulate/cost-breakdown", costBreakdownController);

// GET /network/status — returns current network information
router.get("/network/status", networkStatus);

// POST /footprint/diff — compares two footprints and returns differences
router.post("/footprint/diff", footprintDiffController);

// POST /validate — validates transaction XDR without simulating
router.post("/validate", validate);

// GET /decode — accepts ?xdr=&type= and returns human-readable JSON of the XDR
router.get("/decode", decodeRateLimiter, decode);

// POST /restore — returns a restoration transaction if the transaction requires it
router.post("/restore", restore);

// POST /estimate-fee — accepts { cpuInsns, memBytes, network } and returns fee breakdown
router.post("/estimate-fee", feeRateLimiter, estimateFeeController);

// DELETE /cache — flush all cache entries (Redis or in-memory)
router.delete("/cache", invalidateCache);

// GET /openapi.json — serve raw OpenAPI spec as JSON
router.get("/openapi.json", openApiSpec);

export default router;
