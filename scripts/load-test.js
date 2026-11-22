const autocannon = require("autocannon");

const baseUrl = process.env.LOAD_TEST_URL || "http://localhost:3000";
const defaultPath = process.env.LOAD_TEST_PATH || "/api/v1/health";
const target = new URL(defaultPath, baseUrl).toString();
const duration = parseInt(process.env.LOAD_TEST_DURATION || "60", 10);
const defaultConnections = parseInt(
  process.env.LOAD_TEST_CONNECTIONS || "100",
  10,
);
const scenario = process.env.LOAD_TEST_SCENARIO || "mixed";

// Sample Soroban transaction XDR for simulation and decode testing
const SAMPLE_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

const JSON_HEADERS = {
  "Content-Type": "application/json",
};

function calculateErrorRate(result) {
  const totalRequests = result.requests?.total ?? 0;
  const totalErrors =
    (result.errors ?? 0) + (result.timeouts ?? 0) + (result.non2xx ?? 0);
  return totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;
}

/**
 * Build a 20-request weighted cycle matching the realistic traffic mix:
 * - 70% single simulate (14 requests)
 * - 15% dry-run         (3 requests)
 * - 10% decode          (2 requests)
 * -  5% batch           (1 request)
 */
function buildMixedRequests() {
  const simulateReq = {
    method: "POST",
    path: "/api/v1/simulate",
    headers: JSON_HEADERS,
    body: JSON.stringify({ xdr: SAMPLE_XDR, network: "testnet" }),
  };

  const dryRunReq = {
    method: "POST",
    path: "/api/v1/simulate/dry-run",
    headers: JSON_HEADERS,
    body: JSON.stringify({ xdr: SAMPLE_XDR, network: "testnet" }),
  };

  const decodeReq = {
    method: "GET",
    path: `/api/v1/decode?xdr=${encodeURIComponent(SAMPLE_XDR)}&type=transaction`,
  };

  const batchReq = {
    method: "POST",
    path: "/api/v1/simulate/batch",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      transactions: Array(5)
        .fill(null)
        .map(() => ({ xdr: SAMPLE_XDR })),
      network: "testnet",
    }),
  };

  // Interleave evenly across 20 slots (14 simulate, 3 dry-run, 2 decode, 1 batch)
  return [
    simulateReq,
    simulateReq,
    dryRunReq,
    simulateReq,
    simulateReq,
    decodeReq,
    simulateReq,
    simulateReq,
    simulateReq,
    dryRunReq,
    simulateReq,
    simulateReq,
    decodeReq,
    simulateReq,
    simulateReq,
    dryRunReq,
    simulateReq,
    simulateReq,
    simulateReq,
    batchReq,
  ];
}

function extractCacheHeader(rawHeaders) {
  if (!rawHeaders) return null;
  if (Array.isArray(rawHeaders)) {
    for (let i = 0; i < rawHeaders.length - 1; i += 2) {
      if (String(rawHeaders[i]).toLowerCase() === "x-cache") {
        return String(rawHeaders[i + 1]).toUpperCase();
      }
    }
    return null;
  }
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (key.toLowerCase() === "x-cache") {
      return String(value).toUpperCase();
    }
  }
  return null;
}

async function runScenario(scenarioName, connections) {
  let cacheHits = 0;
  let cacheableResponses = 0;

  const config = {
    url: baseUrl,
    connections,
    duration,
    timeout: 30,
    setupClient: (client) => {
      client.on("headers", (headers) => {
        const cacheStatus = extractCacheHeader(headers);
        if (cacheStatus) {
          cacheableResponses += 1;
          if (cacheStatus === "HIT") {
            cacheHits += 1;
          }
        }
      });
    },
  };

  if (scenarioName === "health") {
    config.url = target;
  } else if (scenarioName === "batch") {
    config.url = new URL("/api/v1/simulate/batch", baseUrl).toString();
    config.method = "POST";
    config.headers = JSON_HEADERS;
    config.body = JSON.stringify({
      transactions: Array(5)
        .fill(null)
        .map(() => ({ xdr: SAMPLE_XDR })),
      network: "testnet",
    });
  } else {
    config.requests = buildMixedRequests();
  }

  console.log(
    `\nRunning load test (${scenarioName}): ${connections} connections for ${duration}s against ${config.url}`,
  );

  const result = await autocannon(config);

  const cacheHitRate =
    process.env.CACHE_HIT_RATE !== undefined
      ? parseFloat(process.env.CACHE_HIT_RATE)
      : cacheableResponses > 0
        ? (cacheHits / cacheableResponses) * 100
        : 0;

  return {
    scenario: scenarioName,
    connections,
    duration,
    reqPerSec: Math.round(result.requests?.average ?? 0),
    p50: Math.round(result.latency?.p50 ?? 0),
    p90: Math.round(result.latency?.p90 ?? 0),
    p95: Math.round(result.latency?.p95 ?? 0),
    p99: Math.round(result.latency?.p99 ?? 0),
    errors: calculateErrorRate(result).toFixed(2),
    cacheHitRate: cacheHitRate.toFixed(1),
    cacheHitRateNumeric: cacheHitRate,
  };
}

function printMarkdownSummary(results) {
  console.log("\n### Load Test Summary\n");
  console.log(
    "| Scenario | Connections | Duration (s) | Req/sec | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Errors (%) | Cache Hit (%) |",
  );
  console.log(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );

  results.forEach((row) => {
    console.log(
      `| ${row.scenario} | ${row.connections} | ${row.duration} | ${row.reqPerSec} | ${row.p50} | ${row.p90} | ${row.p95} | ${row.p99} | ${row.errors} | ${row.cacheHitRate} |`,
    );
  });
}

function assertPerformanceTargets(results) {
  const failures = [];

  for (const row of results) {
    if (row.cacheHitRateNumeric > 75) {
      if (row.reqPerSec <= 500) {
        failures.push(
          `[${row.scenario}] Expected throughput > 500 req/sec when cache hit rate > 75% (${row.cacheHitRate}%), got ${row.reqPerSec} req/sec`,
        );
      }
      if (row.p95 >= 200) {
        failures.push(
          `[${row.scenario}] Expected p95 latency < 200ms when cache hit rate > 75% (${row.cacheHitRate}%), got ${row.p95}ms`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error("\nPerformance assertions failed:");
    failures.forEach((msg) => console.error(`  - ${msg}`));
    return false;
  }

  return true;
}

async function runLoadTests() {
  try {
    console.log(
      `Starting autocannon load tests (scenario: ${scenario}, connections: ${defaultConnections}, duration: ${duration}s)...`,
    );

    const connectionLevels =
      scenario === "mixed" ? [defaultConnections] : [10, 50, 100];

    const results = [];
    for (const connections of connectionLevels) {
      const result = await runScenario(scenario, connections);
      results.push(result);
    }

    printMarkdownSummary(results);

    if (!assertPerformanceTargets(results)) {
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error("Load test failed:", error);
    process.exit(1);
  }
}

runLoadTests();
