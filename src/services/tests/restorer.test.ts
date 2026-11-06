import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import { buildRestoreTransaction } from "../restorer";

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
    txXdr: tx.toXDR(),
    feeBumpXdr: feeBumpTx.toXDR(),
  };
}

describe("buildRestoreTransaction", () => {
  const mockSimulateTransaction = jest.fn();
  const mockGetAccount = jest.fn();

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

  it("builds a restoreFootprint transaction when simulation returns a restorePreamble", async () => {
    const { sourcePublicKey, txXdr } = buildSampleTransactions();
    const ledgerKey = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 2) }),
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
    expect(mockGetAccount).toHaveBeenCalledWith(sourcePublicKey);

    const parsedRestoreTx = StellarSdk.TransactionBuilder.fromXDR(
      result.restoreXdr ?? "",
      StellarSdk.Networks.TESTNET,
    ) as StellarSdk.Transaction;
    expect(parsedRestoreTx.operations).toHaveLength(1);
    expect(parsedRestoreTx.operations[0].type).toBe("restoreFootprint");
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
});
