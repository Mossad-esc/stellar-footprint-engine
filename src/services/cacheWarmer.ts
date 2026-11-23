import { Network } from "@config/stellar";
import { getRpcServer } from "@config/stellar";
import * as StellarSdk from "@stellar/stellar-sdk";

import { getCache, invalidateContractCache } from "./cache";
import { logger } from "../utils/logger";
import { env } from "../config/env";

/** Standard method signatures for popular contract interactions */
interface WarmMethod {
  contractId: string;
  method: string;
  args: StellarSdk.xdr.ScVal[];
}

/** Pre-built dummy transactions for cache warming */
const DEFAULT_WARM_METHODS: WarmMethod[] = [
  // Native SAC token balance
  {
    contractId: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
    method: "balance",
    args: [StellarSdk.nativeToScVal("GABC...", { type: "address" })],
  },
  // Top DEX pair (example: USDC/XLM)
  {
    contractId: "CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA",
    method: "get_reserves",
    args: [],
  },
];

let _warmingInterval: NodeJS.Timeout | null = null;
let _isWarming = false;
let _warmMethods: WarmMethod[] = DEFAULT_WARM_METHODS;

function parseWarmMethods(): WarmMethod[] {
  const contractsEnv = env.CACHE_WARMING_CONTRACTS;
  if (!contractsEnv) return DEFAULT_WARM_METHODS;

  try {
    return JSON.parse(contractsEnv) as WarmMethod[];
  } catch {
    logger.warn({ contractsEnv }, "Failed to parse CACHE_WARMING_CONTRACTS, using defaults");
    return DEFAULT_WARM_METHODS;
  }
}

async function buildAndSimulate(
  network: Network,
  method: WarmMethod,
): Promise<void> {
  try {
    const networkPassphrase = network === "mainnet"
      ? StellarSdk.Networks.PUBLIC
      : network === "testnet"
        ? StellarSdk.Networks.TESTNET
        : StellarSdk.Networks.FUTURENET;

    const server = getRpcServer(network);
    const contractAddress = StellarSdk.Address.fromString(method.contractId);
    
    const tx = new StellarSdk.TransactionBuilder(
      StellarSdk.Keypair.random().publicKey(),
      { fee: "100", networkPassphrase }
    )
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
            new StellarSdk.xdr.InvokeContractArgs({
              contractAddress: contractAddress.toScAddress(),
              functionName: method.method,
              args: method.args,
            }),
          ),
          auth: [],
        }),
      )
      .setTimeout(30)
      .build();

    await server.simulateTransaction(tx);
  } catch (err) {
    // Silently ignore warming errors — don't spam logs
    logger.debug(
      { contractId: method.contractId, method: method.method, err: (err as Error).message },
      "Cache warming simulation failed",
    );
  }
}

async function warmCacheForNetwork(network: Network): Promise<void> {
  if (_isWarming) return;
  _isWarming = true;

  const methods = _warmMethods;
  logger.debug({ network, count: methods.length }, "Starting cache warming");

  try {
    await Promise.allSettled(
      methods.map((method) => buildAndSimulate(network, method))
    );
    logger.debug({ network }, "Cache warming completed");
  } finally {
    _isWarming = false;
  }
}

async function onLedgerClose(network: Network): Promise<void> {
  if (!env.ENABLE_CACHE_WARMING) return;
  await warmCacheForNetwork(network);
}

export function startCacheWarmer(network: Network = "testnet"): void {
  if (!env.ENABLE_CACHE_WARMING) {
    logger.info("Cache warming disabled (ENABLE_CACHE_WARMING=false)");
    return;
  }

  _warmMethods = parseWarmMethods();
  const intervalMs = env.CACHE_WARMING_INTERVAL_MS;

  logger.info(
    { network, intervalMs, contracts: _warmMethods.length },
    "Starting cache warming worker",
  );

  // Initial warm
  warmCacheForNetwork(network);

  // Periodic warming on interval (simulating ledger close)
  _warmingInterval = setInterval(() => {
    onLedgerClose(network);
  }, intervalMs);
}

export function stopCacheWarmer(): void {
  if (_warmingInterval) {
    clearInterval(_warmingInterval);
    _warmingInterval = null;
    logger.info("Cache warming worker stopped");
  }
}

export function isCacheWarmerRunning(): boolean {
  return _warmingInterval !== null;
}

export function getWarmMethods(): WarmMethod[] {
  return [..._warmMethods];
}

export function setWarmMethods(methods: WarmMethod[]): void {
  _warmMethods = methods;
}