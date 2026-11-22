import dotenv from "dotenv";
dotenv.config();

import repl from "repl";

import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../src/config/stellar";
import * as cacheModule from "../src/services/cache";
import * as feeEstimator from "../src/services/feeEstimator";
import * as footprintParser from "../src/services/footprintParser";
import * as rpcClientModule from "../src/services/rpcClient";
import * as sampleFixtures from "../src/tests/fixtures/xdr";

const rpcClient = {
  ...rpcClientModule,
  getRpcServer: stellarConfig.getRpcServer,
  getNetworkConfig: stellarConfig.getNetworkConfig,
};

const cache = {
  ...cacheModule,
  instance: cacheModule.getCache(),
};

function decodeTx(
  xdr: string,
  network: stellarConfig.Network = "testnet",
): StellarSdk.Transaction | StellarSdk.FeeBumpTransaction {
  const { networkPassphrase } = stellarConfig.getNetworkConfig(network);
  return StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
}

function attachContext(context: Record<string, unknown>): void {
  context.StellarSdk = StellarSdk;
  context.rpcClient = rpcClient;
  context.footprintParser = footprintParser;
  context.feeEstimator = feeEstimator;
  context.cache = cache;
  context.samples = sampleFixtures;
  context.decodeTx = decodeTx;
}

function printBanner(): void {
  console.log("\n=== Stellar Footprint Engine — Interactive REPL ===");
  console.log("Pre-loaded globals:");
  console.log("  StellarSdk       @stellar/stellar-sdk");
  console.log("  rpcClient        simulateViaRpc, fetchTtlInfo, getRpcServer, getNetworkConfig");
  console.log("  footprintParser  parseFootprintEntries, extractContracts, ...");
  console.log("  feeEstimator     estimateFee, calculateDetailedFeeBreakdown, ...");
  console.log("  cache            getCache(), instance, LruMemoryCache, buildCacheKey");
  console.log("  samples          SOROBAN_INVOKE_XDR, CLASSIC_PAYMENT_XDR, FEE_BUMP_XDR, ...");
  console.log("  decodeTx         decodeTx(xdr, network = 'testnet')");
  console.log("\nExample:");
  console.log("  const tx = decodeTx(samples.SOROBAN_INVOKE_XDR)");
  console.log("  tx.operations\n");
}

function main(): void {
  printBanner();

  const replServer = repl.start({
    prompt: "soroban-footprint> ",
    useColors: true,
    useGlobal: false,
  });

  attachContext(replServer.context);

  replServer.on("reset", () => {
    attachContext(replServer.context);
  });

  replServer.on("exit", () => {
    process.exit(0);
  });
}

main();
