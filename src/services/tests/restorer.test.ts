import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import {
  buildRestoreTransaction,
  calculateRestorationFee,
  createContractCodeLedgerKey,
  createContractInstanceLedgerKey,
} from "../restorer";

jest.mock("../../config/stellar", () => ({
  ...jest.requireActual("../../config/stellar"),
  getRpcServer: jest.fn(),
  getNetworkConfig: jest.fn(),
}));

const mockedGetRpcServer = stellarConfig.getRpcServer as jest.MockedFunction<
  typeof stellarConfig.getRpcServer
>;
const mockedGetNetworkConfig =
  stellarConfig.getNetworkConfig as jest.MockedFunction<
    typeof stellarConfig.getNetworkConfig
  >;

function buildSampleTransactions() {
  const sourceKeypair = StellarSdk.Keypair.random();
  const feePayerKeypair = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(sourceKeypair.publicKey(), "100");

  const contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 7));
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(contract.call("ping"))
    .setTimeout(30)
    .build();

  const feeBumpTx = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    feePayerKeypair,
    "200",
    tx,
    StellarSdk.Networks.TESTNET,
  );

  return {
    sourcePublicKey: sourceKeypair.publicKey(),
    contractId,
    txXdr: tx.toXDR(),
    feeBumpXdr: feeBumpTx.toXDR(),
  };
}

function extractSorobanFootprint(
  restoreXdr: string,
): StellarSdk.xdr.LedgerFootprint {
  const envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(
    restoreXdr,
    "base64",
  );
  const sorobanData = envelope.v1().tx().ext().sorobanData();
  return sorobanData.resources().footprint();
}

describe("buildRestoreTransaction", () => {
  const mockSimulateTransaction = jest.fn();
  const mockGetAccount = jest.fn();
  const mockGetLedgerEntries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetNetworkConfig.mockReturnValue({
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: StellarSdk.Networks.TESTNET,
    });
    mockedGetRpcServer.mockReturnValue({
      simulateTransaction: mockSimulateTransaction,
      getAccount: mockGetAccount,
    } as unknown as StellarSdk.rpc.Server);
  });

  it("returns needsRestore: false when simulation does not require restoration", async () => {
    const { txXdr } = buildSampleTransactions();
    mockSimulateTransaction.mockResolvedValue({
      id: "sim-1",
      latestLedger: 1000,
      results: [],
      transactionData: new StellarSdk.SorobanDataBuilder(),
      minResourceFee: "100",
    });

    const result = await buildRestoreTransaction(txXdr, "testnet");

    expect(result).toEqual({ needsRestore: false });
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("returns needsRestore: false on non-restoration simulation errors", async () => {
    const { txXdr } = buildSampleTransactions();
    mockSimulateTransaction.mockResolvedValue({
      id: "sim-err",
      latestLedger: 1000,
      error: "HostError: Error(Contract, #1)",
    });

    const result = await buildRestoreTransaction(txXdr, "testnet");

    expect(result).toEqual({ needsRestore: false });
    expect(mockGetAccount).not.toHaveBeenCalled();
  });

  it("builds a restoreFootprint transaction when simulation returns a restorePreamble", async () => {
    const { sourcePublicKey, contractId, txXdr } = buildSampleTransactions();
    const wasmHash = Buffer.alloc(32, 2);
    const ledgerKey = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash: wasmHash }),
    );
    const sorobanDataBuilder = new StellarSdk.SorobanDataBuilder()
      .setReadWrite([ledgerKey])
      .setResourceFee(5000);

    mockSimulateTransaction.mockResolvedValue({
      id: "sim-restore",
      latestLedger: 1000,
      result: {
        auth: [],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
      transactionData: sorobanDataBuilder,
      minResourceFee: "5000",
      restorePreamble: {
        minResourceFee: "4200",
        transactionData: sorobanDataBuilder,
      },
    });
    mockGetAccount.mockResolvedValue(
      new StellarSdk.Account(sourcePublicKey, "101"),
    );

    const result = await buildRestoreTransaction(txXdr);

    expect(result.needsRestore).toBe(true);
    expect(result.fee).toBe(StellarSdk.BASE_FEE);
    expect(typeof result.restoreXdr).toBe("string");
    expect(result.restoredKeys).toEqual({
      contractCode: [wasmHash.toString("hex")],
      contractInstance: [contractId],
    });
    expect(mockGetAccount).toHaveBeenCalledWith(sourcePublicKey);

    const parsedRestoreTx = StellarSdk.TransactionBuilder.fromXDR(
      result.restoreXdr ?? "",
      StellarSdk.Networks.TESTNET,
    ) as StellarSdk.Transaction;
    expect(parsedRestoreTx.operations).toHaveLength(1);
    expect(parsedRestoreTx.operations[0].type).toBe("restoreFootprint");

    const footprint = extractSorobanFootprint(result.restoreXdr ?? "");
    expect(footprint.readOnly()).toHaveLength(0);
    expect(footprint.readWrite()).toHaveLength(2);
  });

  it("uses innerTransaction.source when restoring a FeeBumpTransaction", async () => {
    const { sourcePublicKey, feeBumpXdr } = buildSampleTransactions();
    const sorobanDataBuilder = new StellarSdk.SorobanDataBuilder();

    mockSimulateTransaction.mockResolvedValue({
      id: "sim-feebump-restore",
      latestLedger: 1000,
      result: {
        auth: [],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
      transactionData: sorobanDataBuilder,
      minResourceFee: "5000",
      restorePreamble: {
        minResourceFee: "4200",
        transactionData: sorobanDataBuilder,
      },
    });
    mockGetAccount.mockResolvedValue(
      new StellarSdk.Account(sourcePublicKey, "202"),
    );

    const result = await buildRestoreTransaction(feeBumpXdr, "testnet");

    expect(result.needsRestore).toBe(true);
    expect(mockGetAccount).toHaveBeenCalledWith(sourcePublicKey);
  });

  it("handles LEDGER_ENTRY_RESTORATION_REQUIRED error with restorePreamble for expired contract code", async () => {
    const { sourcePublicKey, contractId, txXdr } = buildSampleTransactions();
    const wasmHash = Buffer.alloc(32, 0xcd);
    const codeKey = createContractCodeLedgerKey(wasmHash);
    const instanceKey = createContractInstanceLedgerKey(contractId);
    const preambleBuilder = new StellarSdk.SorobanDataBuilder()
      .setReadOnly([instanceKey])
      .setReadWrite([codeKey])
      .setResourceFee("12000");

    mockSimulateTransaction.mockResolvedValue({
      id: "sim-err-preamble",
      latestLedger: 250_000,
      error:
        "HostError: LEDGER_ENTRY_RESTORATION_REQUIRED (contractCode expired)",
      restorePreamble: {
        minResourceFee: "12000",
        transactionData: preambleBuilder,
      },
    });
    mockGetAccount.mockResolvedValue(
      new StellarSdk.Account(sourcePublicKey, "303"),
    );

    const result = await buildRestoreTransaction(txXdr, "testnet", {
      wasmSizeBytes: 32_768,
    });

    expect(result.needsRestore).toBe(true);
    expect(result.wasmSizeBytes).toBe(32_768);
    expect(result.ledgerSequence).toBe(250_000);
    expect(result.restoredKeys).toEqual({
      contractCode: [wasmHash.toString("hex")],
      contractInstance: [contractId],
    });
    expect(BigInt(result.estimatedRestoreFee ?? "0")).toBeGreaterThan(12_000n);

    const footprint = extractSorobanFootprint(result.restoreXdr ?? "");
    expect(footprint.readOnly()).toHaveLength(0);
    const keySwitches = footprint.readWrite().map((k) => k.switch().name);
    expect(keySwitches).toEqual(
      expect.arrayContaining(["contractData", "contractCode"]),
    );
  });

  it("discovers expired WASM hash and bytecode size via getLedgerEntries on LEDGER_ENTRY_RESTORATION_REQUIRED", async () => {
    const { sourcePublicKey, contractId, txXdr } = buildSampleTransactions();
    const wasmHash = Buffer.alloc(32, 0xef);
    const wasmBytecode = Buffer.alloc(16_384, 0x01);

    const contractScAddress =
      StellarSdk.Address.fromString(contractId).toScAddress();
    const instanceEntry = StellarSdk.xdr.LedgerEntryData.contractData(
      new StellarSdk.xdr.ContractDataEntry({
        ext: new StellarSdk.xdr.ExtensionPoint(0),
        contract: contractScAddress,
        key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
        durability: StellarSdk.xdr.ContractDataDurability.persistent(),
        val: StellarSdk.xdr.ScVal.scvContractInstance(
          new StellarSdk.xdr.ScContractInstance({
            executable:
              StellarSdk.xdr.ContractExecutable.contractExecutableWasm(
                wasmHash,
              ),
            storage: [],
          }),
        ),
      }),
    );

    const codeEntry = StellarSdk.xdr.LedgerEntryData.contractCode(
      new StellarSdk.xdr.ContractCodeEntry({
        ext: new StellarSdk.xdr.ContractCodeEntryExt(0),
        hash: wasmHash,
        code: wasmBytecode,
      }),
    );

    mockedGetRpcServer.mockReturnValue({
      simulateTransaction: mockSimulateTransaction,
      getAccount: mockGetAccount,
      getLedgerEntries: mockGetLedgerEntries,
    } as unknown as StellarSdk.rpc.Server);

    mockSimulateTransaction.mockResolvedValue({
      id: "sim-code-expired",
      latestLedger: 500_000,
      error: "LEDGER_ENTRY_RESTORATION_REQUIRED: archived contract code",
    });

    mockGetLedgerEntries
      .mockResolvedValueOnce({
        entries: [{ val: instanceEntry, liveUntilLedgerSeq: 480_000 }],
        latestLedger: 500_000,
      })
      .mockResolvedValueOnce({
        entries: [{ val: codeEntry, liveUntilLedgerSeq: 450_000 }],
        latestLedger: 500_000,
      });

    mockGetAccount.mockResolvedValue(
      new StellarSdk.Account(sourcePublicKey, "404"),
    );

    const result = await buildRestoreTransaction(txXdr, "testnet");

    expect(result.needsRestore).toBe(true);
    expect(result.wasmSizeBytes).toBe(16_384);
    expect(result.ledgerSequence).toBe(500_000);
    expect(result.restoredKeys).toEqual({
      contractCode: [wasmHash.toString("hex")],
      contractInstance: [contractId],
    });
    expect(mockGetLedgerEntries).toHaveBeenCalledTimes(2);

    const footprint = extractSorobanFootprint(result.restoreXdr ?? "");
    expect(footprint.readWrite()).toHaveLength(2);
  });

  it("scales refundable restoration fee with WASM bytecode size and validates WASM hash length", () => {
    const smallFee = BigInt(
      calculateRestorationFee({
        wasmSizeBytes: 2_048,
        entryCount: 2,
        latestLedger: 200_000,
        archivedAtLedger: 190_000,
      }),
    );
    const largeFee = BigInt(
      calculateRestorationFee({
        wasmSizeBytes: 65_536,
        entryCount: 2,
        latestLedger: 200_000,
        archivedAtLedger: 190_000,
      }),
    );

    expect(largeFee).toBeGreaterThan(smallFee);
    expect(() => createContractCodeLedgerKey("abcd")).toThrow(/32 bytes/);
  });
});
