import * as fs from "node:fs";
import * as path from "node:path";
import * as StellarSdk from "@stellar/stellar-sdk";
import { Bench } from "tinybench";

import { calculateFootprintStats } from "../../src/services/footprintExtractor";
import {
  extractContracts,
  parseFootprint,
  parseFootprintEntries,
} from "../../src/services/footprintParser";
import { parseLedgerKey, parseXdr } from "../../src/services/xdrParser";
import { sacFootprint } from "../../src/tests/fixtures/footprints";
import {
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  SOROBAN_INVOKE_XDR,
} from "../../src/tests/fixtures/xdr";

interface BenchmarkResult {
  name: string;
  opsPerSec: number;
  meanMs: number;
  p99Ms: number;
  samples: number;
}

interface BenchmarkReport {
  timestamp: string;
  commit: string;
  results: BenchmarkResult[];
}

function getOutputPath(): string | undefined {
  const outputFlagIndex = process.argv.indexOf("--output");
  if (outputFlagIndex !== -1 && process.argv[outputFlagIndex + 1]) {
    return process.argv[outputFlagIndex + 1];
  }
  return process.env.BENCH_OUTPUT;
}

async function runBenchmarks(): Promise<void> {
  const networkPassphrase = StellarSdk.Networks.TESTNET;
  const footprintData = sacFootprint(StellarSdk.Asset.native()).build();
  const footprint = footprintData.footprint();
  const readOnly = footprint.readOnly().map((key) => key.toXDR("base64"));
  const readWrite = footprint.readWrite().map((key) => key.toXDR("base64"));
  const allEntries = [...readOnly, ...readWrite];
  const sampleLedgerKey = readOnly[0];

  const parsedFootprint = parseFootprint(
    { readOnly, readWrite },
    networkPassphrase,
  );
  const footprintStats = calculateFootprintStats(readOnly, readWrite);
  const simulationResponse = {
    footprint: parsedFootprint,
    stats: footprintStats,
    cpuInsns: "1245678",
    memBytes: "456789",
    minResourceFee: "15234",
  };

  const bench = new Bench({ time: 500, warmupTime: 100 });

  bench
    .add("parseXdr (Soroban Invoke)", () => {
      parseXdr(SOROBAN_INVOKE_XDR, networkPassphrase);
    })
    .add("parseXdr (Classic Payment)", () => {
      parseXdr(CLASSIC_PAYMENT_XDR, networkPassphrase);
    })
    .add("parseXdr (Fee Bump)", () => {
      parseXdr(FEE_BUMP_XDR, networkPassphrase);
    })
    .add("parseLedgerKey", () => {
      parseLedgerKey(sampleLedgerKey);
    })
    .add("parseFootprintEntries", () => {
      parseFootprintEntries(allEntries);
    })
    .add("extractContracts", () => {
      extractContracts(allEntries);
    })
    .add("parseFootprint", () => {
      parseFootprint({ readOnly, readWrite }, networkPassphrase);
    })
    .add("calculateFootprintStats", () => {
      calculateFootprintStats(readOnly, readWrite);
    })
    .add("serializeSimulationResponse", () => {
      JSON.stringify(simulationResponse);
    });

  await bench.run();

  console.table(bench.table());

  const results: BenchmarkResult[] = bench.tasks.map((task) => {
    const res = task.result;
    return {
      name: task.name,
      opsPerSec: res ? Number(res.hz.toFixed(2)) : 0,
      meanMs: res ? Number(res.mean.toFixed(6)) : 0,
      p99Ms: res ? Number(res.p99.toFixed(6)) : 0,
      samples: res ? res.samples.length : 0,
    };
  });

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    commit: process.env.GITHUB_SHA ?? "local",
    results,
  };

  const outputPath = getOutputPath();
  if (outputPath) {
    const resolved = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`Benchmark report written to ${resolved}`);
  }
}

runBenchmarks().catch((error: unknown) => {
  console.error("Benchmark execution failed:", error);
  process.exit(1);
});
