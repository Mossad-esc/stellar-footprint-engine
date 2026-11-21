const assert = require("node:assert/strict");
const StellarSdk = require("@stellar/stellar-sdk");

const TOTAL_TRANSACTIONS = 10_000;
const BATCH_SIZE = 50;
const SAMPLE_INTERVAL = 500;
const MAX_HEAP_DRIFT_PERCENT = 10;

// Sample Soroban transaction XDR for batch simulation memory leak testing
const SAMPLE_XDR =
  "AAAAAgAAAACnDQTKOBdaOH0ynf6k7SpkytahlUjNsWgm4WEB8rmE1QAAAGQAAAAAAAAAZwAAAAEAAAAAAAAAAAAAAABp6joKAAAAAAAAAAEAAAAAAAAAGAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFaGVsbG8AAAAAAAABAAAAAQAAAAAAAAAAAAAAAfK5hNUAAABAIbPVF4x6vSLx/J3T0SDhvTNtytA/BNO+qMJ74p/b3Y8xpBhR7xzy68FuEyffaF9fNXHEC+77WK+oOJpfon1tCg==";

function formatMb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(2);
}

function forceGc() {
  if (typeof global.gc === "function") {
    global.gc();
  }
}

/**
 * Simulates parsing and processing a single transaction's XDR and footprint
 * without retaining references across batches.
 */
function simulateTransaction(xdrString, index) {
  const tx = StellarSdk.TransactionBuilder.fromXDR(
    xdrString,
    StellarSdk.Networks.TESTNET,
  );
  const hash = tx.hash().toString("hex");
  const operationsCount = tx.operations.length;
  const envelopeXdr = tx.toXDR();

  return {
    index,
    hash,
    operationsCount,
    xdrLength: envelopeXdr.length,
  };
}

function runBatch(startIndex, batchSize) {
  const results = new Array(batchSize);
  for (let i = 0; i < batchSize; i += 1) {
    results[i] = simulateTransaction(SAMPLE_XDR, startIndex + i);
  }
  return results.length;
}

function runMemoryLeakTest() {
  if (typeof global.gc !== "function") {
    console.warn(
      "Warning: global.gc() is not available. Run with `node --expose-gc scripts/test-memory-leak.js` for accurate residual heap measurements.",
    );
  }

  // Warmup phase so V8 JIT and Stellar SDK static caches settle before baseline
  for (let i = 0; i < SAMPLE_INTERVAL; i += BATCH_SIZE) {
    runBatch(i, BATCH_SIZE);
  }

  forceGc();
  const baselineHeap = process.memoryUsage().heapUsed;
  const samples = [];

  console.log(
    `Starting memory leak test: ${TOTAL_TRANSACTIONS} transactions in batches of ${BATCH_SIZE} (sampling every ${SAMPLE_INTERVAL} iterations)`,
  );
  console.log(`Baseline residual heap: ${formatMb(baselineHeap)} MB\n`);
  console.log("Iteration | Heap Used (MB) | RSS (MB) | Drift (%)");
  console.log("--------------------------------------------------");

  for (
    let processed = BATCH_SIZE;
    processed <= TOTAL_TRANSACTIONS;
    processed += BATCH_SIZE
  ) {
    runBatch(processed - BATCH_SIZE, BATCH_SIZE);

    if (processed % SAMPLE_INTERVAL === 0) {
      forceGc();
      const mem = process.memoryUsage();
      const driftPercent = ((mem.heapUsed - baselineHeap) / baselineHeap) * 100;
      samples.push({
        iteration: processed,
        heapUsed: mem.heapUsed,
        rss: mem.rss,
        driftPercent,
      });

      console.log(
        `${String(processed).padStart(9)} | ${formatMb(mem.heapUsed).padStart(14)} | ${formatMb(mem.rss).padStart(8)} | ${driftPercent.toFixed(2).padStart(8)}%`,
      );
    }
  }

  forceGc();
  const finalHeap = process.memoryUsage().heapUsed;
  const finalDriftPercent = ((finalHeap - baselineHeap) / baselineHeap) * 100;

  console.log("\nMemory Leak Test Summary");
  console.log(`Baseline heap: ${formatMb(baselineHeap)} MB`);
  console.log(`Final heap:    ${formatMb(finalHeap)} MB`);
  console.log(`Total drift:   ${finalDriftPercent.toFixed(2)}%`);

  assert.ok(
    finalDriftPercent < MAX_HEAP_DRIFT_PERCENT,
    `Heap memory grew by ${finalDriftPercent.toFixed(2)}%, exceeding the ${MAX_HEAP_DRIFT_PERCENT}% threshold`,
  );

  console.log(
    `PASS: Residual heap drift (${finalDriftPercent.toFixed(2)}%) is within < ${MAX_HEAP_DRIFT_PERCENT}% limit.`,
  );
}

runMemoryLeakTest();
