import * as StellarSdk from "@stellar/stellar-sdk";

import { Network, getNetworkConfig, getRpcServer } from "../config/stellar";

const RESTORATION_ERROR_PATTERN =
  /LEDGER_ENTRY_RESTORATION_REQUIRED|restore\s*footprint|archived|entry\s+expired|code\s+expired/i;

const DEFAULT_RESTORE_TTL_LEDGERS = 100_000;
const INSTANCE_ENTRY_ESTIMATE_BYTES = 256;
const DEFAULT_WASM_ESTIMATE_BYTES = 4_096;
const STROOPS_PER_READ_ENTRY = 6_250n;
const STROOPS_PER_WRITE_ENTRY = 10_000n;
const STROOPS_PER_1KB_RW = 11_800n;
const PERSISTENT_RENT_STROOPS_PER_KB_PER_1M_LEDGERS = 2_000_000n;

interface RestorePreambleLike {
  minResourceFee: string;
  transactionData: StellarSdk.SorobanDataBuilder;
}

interface SimulationWithOptionalRestore {
  latestLedger?: number;
  error?: string;
  restorePreamble?: RestorePreambleLike;
}

export interface RestoredKeysSummary {
  contractCode: string[];
  contractInstance: string[];
}

export interface RestoreOptions {
  wasmHash?: string;
  contractId?: string;
  wasmSizeBytes?: number;
  restoreTtlLedgers?: number;
}

export interface RestoreResult {
  needsRestore: boolean;
  restoreXdr?: string;
  fee?: string;
  estimatedRestoreFee?: string;
  wasmSizeBytes?: number;
  ledgerSequence?: number;
  restoredKeys?: RestoredKeysSummary;
}

export interface RestorationFeeParams {
  wasmSizeBytes: number;
  entryCount: number;
  latestLedger?: number;
  archivedAtLedger?: number;
  restoreTtlLedgers?: number;
  preambleMinResourceFee?: string;
}

export function createContractCodeLedgerKey(
  wasmHash: string | Buffer,
): StellarSdk.xdr.LedgerKey {
  const hashBuffer =
    typeof wasmHash === "string" ? Buffer.from(wasmHash, "hex") : wasmHash;
  if (hashBuffer.length !== 32) {
    throw new Error("Contract WASM hash must be exactly 32 bytes");
  }
  return StellarSdk.xdr.LedgerKey.contractCode(
    new StellarSdk.xdr.LedgerKeyContractCode({ hash: hashBuffer }),
  );
}

export function createContractInstanceLedgerKey(
  contractId: string,
): StellarSdk.xdr.LedgerKey {
  return new StellarSdk.Contract(contractId).getFootprint();
}

export function calculateRestorationFee(params: RestorationFeeParams): string {
  const entryCount = BigInt(Math.max(1, Math.trunc(params.entryCount)));
  const wasmBytes = Math.max(0, Math.trunc(params.wasmSizeBytes));
  const totalBytes = BigInt(
    Math.max(
      INSTANCE_ENTRY_ESTIMATE_BYTES,
      wasmBytes + INSTANCE_ENTRY_ESTIMATE_BYTES,
    ),
  );

  const baseTtl = Math.max(
    1,
    Math.trunc(params.restoreTtlLedgers ?? DEFAULT_RESTORE_TTL_LEDGERS),
  );
  const archivalGap =
    params.latestLedger !== undefined &&
    params.archivedAtLedger !== undefined &&
    params.latestLedger > params.archivedAtLedger
      ? params.latestLedger - params.archivedAtLedger
      : 0;
  // Factor current ledger sequence / archival gap into minimum rent window
  const effectiveTtlLedgers = BigInt(baseTtl + Math.min(archivalGap, baseTtl));

  const entryFee =
    entryCount * (STROOPS_PER_READ_ENTRY + STROOPS_PER_WRITE_ENTRY);
  const kbChunks = (totalBytes + 1023n) / 1024n;
  const ioByteFee = kbChunks * STROOPS_PER_1KB_RW;
  const persistentRentFee =
    (totalBytes *
      effectiveTtlLedgers *
      PERSISTENT_RENT_STROOPS_PER_KB_PER_1M_LEDGERS) /
    (1024n * 1_000_000n);

  const computedFee = entryFee + ioByteFee + persistentRentFee;
  const preambleFee =
    params.preambleMinResourceFee && /^\d+$/.test(params.preambleMinResourceFee)
      ? BigInt(params.preambleMinResourceFee)
      : 0n;

  return (computedFee > preambleFee ? computedFee : preambleFee).toString();
}

function extractInvokedContractIds(
  tx: StellarSdk.Transaction | StellarSdk.FeeBumpTransaction,
): string[] {
  const innerTx = "innerTransaction" in tx ? tx.innerTransaction : tx;
  const contractIds: string[] = [];

  for (const op of innerTx.operations) {
    if (op.type === "invokeHostFunction") {
      const hostFn = op.func;
      if (hostFn.switch().name === "hostFunctionTypeInvokeContract") {
        const scAddr = hostFn.invokeContract().contractAddress();
        if (scAddr.switch().name === "scAddressTypeContract") {
          const cid = StellarSdk.Address.fromScAddress(scAddr).toString();
          if (!contractIds.includes(cid)) {
            contractIds.push(cid);
          }
        }
      }
    }
  }

  return contractIds;
}

function extractRestorePreamble(
  response: StellarSdk.rpc.Api.SimulateTransactionResponse,
): { needsRestore: boolean; preamble?: RestorePreambleLike } {
  if (StellarSdk.rpc.Api.isSimulationRestore(response)) {
    return { needsRestore: true, preamble: response.restorePreamble };
  }

  const candidate = response as unknown as SimulationWithOptionalRestore;
  if (candidate.restorePreamble) {
    return { needsRestore: true, preamble: candidate.restorePreamble };
  }

  if (
    StellarSdk.rpc.Api.isSimulationError(response) &&
    typeof response.error === "string" &&
    RESTORATION_ERROR_PATTERN.test(response.error)
  ) {
    return { needsRestore: true };
  }

  return { needsRestore: false };
}

function summarizeLedgerKeys(
  keys: StellarSdk.xdr.LedgerKey[],
): RestoredKeysSummary {
  const contractCode: string[] = [];
  const contractInstance: string[] = [];

  for (const key of keys) {
    const switchName = key.switch().name;
    if (switchName === "contractCode") {
      const hashHex = Buffer.from(key.contractCode().hash()).toString("hex");
      if (!contractCode.includes(hashHex)) {
        contractCode.push(hashHex);
      }
    } else if (switchName === "contractData") {
      const data = key.contractData();
      if (
        data.key().switch().name === "scvLedgerKeyContractInstance" &&
        data.contract().switch().name === "scAddressTypeContract"
      ) {
        const cid = StellarSdk.Address.fromScAddress(
          data.contract(),
        ).toString();
        if (!contractInstance.includes(cid)) {
          contractInstance.push(cid);
        }
      }
    }
  }

  return { contractCode, contractInstance };
}

export async function buildRestoreTransaction(
  xdr: string,
  network: Network = "testnet",
  options?: RestoreOptions,
): Promise<RestoreResult> {
  const server = getRpcServer(network);
  const { networkPassphrase } = getNetworkConfig(network);

  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
  const response = await server.simulateTransaction(tx);

  const { needsRestore, preamble } = extractRestorePreamble(response);
  if (!needsRestore) {
    return { needsRestore: false };
  }

  const keyMap = new Map<string, StellarSdk.xdr.LedgerKey>();
  const addKey = (key: StellarSdk.xdr.LedgerKey): void => {
    keyMap.set(key.toXDR("base64"), key);
  };

  if (preamble) {
    const builtData = preamble.transactionData.build();
    const footprint = builtData.resources().footprint();
    for (const key of footprint.readOnly()) {
      addKey(key);
    }
    for (const key of footprint.readWrite()) {
      addKey(key);
    }
  }

  const targetContractIds = extractInvokedContractIds(tx);
  if (options?.contractId && !targetContractIds.includes(options.contractId)) {
    targetContractIds.push(options.contractId);
  }

  for (const contractId of targetContractIds) {
    addKey(createContractInstanceLedgerKey(contractId));
  }

  if (options?.wasmHash) {
    addKey(createContractCodeLedgerKey(options.wasmHash));
  }

  let measuredWasmBytes = 0;
  let archivedAtLedger: number | undefined;

  if (typeof server.getLedgerEntries === "function") {
    const instanceKeys = Array.from(keyMap.values()).filter(
      (k) =>
        k.switch().name === "contractData" &&
        k.contractData().key().switch().name === "scvLedgerKeyContractInstance",
    );

    if (instanceKeys.length > 0) {
      try {
        const instanceRes = await server.getLedgerEntries(...instanceKeys);
        for (const entry of instanceRes?.entries ?? []) {
          if (
            entry.liveUntilLedgerSeq !== undefined &&
            (archivedAtLedger === undefined ||
              entry.liveUntilLedgerSeq < archivedAtLedger)
          ) {
            archivedAtLedger = entry.liveUntilLedgerSeq;
          }
          if (entry.val.switch().name === "contractData") {
            const scVal = entry.val.contractData().val();
            if (scVal.switch().name === "scvContractInstance") {
              const exec = scVal.instance().executable();
              if (exec.switch().name === "contractExecutableWasm") {
                addKey(
                  createContractCodeLedgerKey(Buffer.from(exec.wasmHash())),
                );
              }
            }
          }
        }
      } catch {
        // Ignore RPC getLedgerEntries errors on archived/unavailable entries
      }
    }

    const codeKeys = Array.from(keyMap.values()).filter(
      (k) => k.switch().name === "contractCode",
    );

    if (codeKeys.length > 0 && options?.wasmSizeBytes === undefined) {
      try {
        const codeRes = await server.getLedgerEntries(...codeKeys);
        for (const entry of codeRes?.entries ?? []) {
          if (
            entry.liveUntilLedgerSeq !== undefined &&
            (archivedAtLedger === undefined ||
              entry.liveUntilLedgerSeq < archivedAtLedger)
          ) {
            archivedAtLedger = entry.liveUntilLedgerSeq;
          }
          if (entry.val.switch().name === "contractCode") {
            measuredWasmBytes += entry.val.contractCode().code().length;
          }
        }
      } catch {
        // Fall back to default WASM byte estimate if RPC omits archived bytecode
      }
    }
  }

  const readWriteKeys = Array.from(keyMap.values());
  const restoredKeys = summarizeLedgerKeys(readWriteKeys);
  const hasCodeKeys = restoredKeys.contractCode.length > 0;

  const wasmSizeBytes =
    options?.wasmSizeBytes ??
    (measuredWasmBytes > 0
      ? measuredWasmBytes
      : hasCodeKeys
        ? DEFAULT_WASM_ESTIMATE_BYTES * restoredKeys.contractCode.length
        : 0);

  const latestLedger =
    "latestLedger" in response && typeof response.latestLedger === "number"
      ? response.latestLedger
      : undefined;

  const resourceFee = calculateRestorationFee({
    wasmSizeBytes,
    entryCount: readWriteKeys.length,
    latestLedger,
    archivedAtLedger,
    restoreTtlLedgers: options?.restoreTtlLedgers,
    preambleMinResourceFee: preamble?.minResourceFee,
  });

  const totalWriteBytes =
    wasmSizeBytes +
    Math.max(1, restoredKeys.contractInstance.length) *
      INSTANCE_ENTRY_ESTIMATE_BYTES;

  const sorobanData = new StellarSdk.SorobanDataBuilder()
    .setReadOnly([])
    .setReadWrite(readWriteKeys)
    .setResources(0, totalWriteBytes, totalWriteBytes)
    .setResourceFee(resourceFee)
    .build();

  const sourceAccount =
    "innerTransaction" in tx ? tx.innerTransaction.source : tx.source;
  const account = await server.getAccount(sourceAccount);
  const fee = StellarSdk.BASE_FEE;
  const estimatedRestoreFee = (BigInt(fee) + BigInt(resourceFee)).toString();

  const restoreTx = new StellarSdk.TransactionBuilder(account, {
    fee,
    networkPassphrase,
  })
    .setSorobanData(sorobanData)
    .addOperation(StellarSdk.Operation.restoreFootprint({}))
    .setTimeout(30)
    .build();

  return {
    needsRestore: true,
    restoreXdr: restoreTx.toXDR(),
    fee,
    estimatedRestoreFee,
    wasmSizeBytes,
    ledgerSequence: latestLedger,
    restoredKeys,
  };
}
