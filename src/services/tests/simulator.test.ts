import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer } from "../../config/stellar";
import { TTL_WARNING_THRESHOLD_LEDGERS } from "../../constants";
import { getCache } from "../../services/cache";
import {
  SOROBAN_INVOKE_XDR,
  CLASSIC_PAYMENT_XDR,
  FEE_BUMP_XDR,
  INVALID_BASE64_XDR,
} from "../../tests/fixtures/xdr";
import {
  buildMockTransaction,
  mockTransaction,
} from "../../tests/factories/transactionFactory";
import * as footprintParser from "../footprintParser";
import { simulateTransaction, simulateDryRun } from "../simulator";

jest.mock("@config/stellar", () => ({
  getNetworkConfig: jest.fn().mockReturnValue({
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
  getRpcServer: jest.fn(),
}));

const mockSimulate = jest.fn<
  Promise<StellarSdk.rpc.Api.SimulateTransactionResponse>,
  unknown[]
>();
const mockEntries = jest.fn<
  Promise<StellarSdk.rpc.Api.GetLedgerEntriesResponse>,
  unknown[]
>();
const server = {
  simulateTransaction: mockSimulate,
  getLedgerEntries: mockEntries,
} as unknown as StellarSdk.rpc.Server;
const codeKey = (byte = 2) =>
  StellarSdk.xdr.LedgerKey.contractCode(
    new StellarSdk.xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, byte) }),
  );
const dataKey = StellarSdk.xdr.LedgerKey.fromXDR(
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB",
  "base64",
);
const accountKey = StellarSdk.xdr.LedgerKey.fromXDR(
  "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==",
  "base64",
);
const raw = (key: StellarSdk.xdr.LedgerKey) => key.toXDR("base64");

function success(
  keys: StellarSdk.xdr.LedgerKey[] = [],
  latestLedger = 101,
): StellarSdk.rpc.Api.SimulateTransactionSuccessResponse {
  return {
    id: "test",
    _parsed: true,
    latestLedger,
    events: [],
    minResourceFee: "100",
    transactionData: new StellarSdk.SorobanDataBuilder().setReadOnly(keys),
  };
}
function ledgerEntry(
  key: StellarSdk.xdr.LedgerKey,
  liveUntilLedgerSeq: number,
): StellarSdk.rpc.Api.LedgerEntryResult {
  return {
    key,
    liveUntilLedgerSeq,
    val: StellarSdk.xdr.LedgerEntryData.ttl(
      new StellarSdk.xdr.TtlEntry({
        keyHash: StellarSdk.hash(key.toXDR()),
        liveUntilLedgerSeq,
      }),
    },
    FeeBumpTransaction,
    StrKey: {
      encodeEd25519PublicKey: jest.fn().mockReturnValue("GABC"),
    },
    rpc: {
      Server: jest.fn(),
      Api: { isSimulationError, isSimulationRestore },
    },
    Networks: {
      TESTNET: "Test SDF Network ; September 2015",
      PUBLIC: "Public Global Stellar Network ; September 2015",
      FUTURENET: "Test SDF Future Network ; October 2022",
    },
    xdr: {
      ...jest.requireActual<typeof import("@stellar/stellar-sdk")>(
        "@stellar/stellar-sdk",
      ).xdr,
      LedgerKey: jest.requireActual<typeof import("@stellar/stellar-sdk")>(
        "@stellar/stellar-sdk",
      ).xdr.LedgerKey,
      AccountId: { fromString: jest.fn().mockReturnValue({}) },
    },
  };
}
function ttlState(
  key: StellarSdk.xdr.LedgerKey,
  before: number | null,
  after: number,
): StellarSdk.rpc.Api.LedgerEntryChange {
  const keyHash = StellarSdk.hash(key.toXDR());
  const entry = (seq: number) =>
    new StellarSdk.xdr.LedgerEntry({
      lastModifiedLedgerSeq: 100,
      data: StellarSdk.xdr.LedgerEntryData.ttl(
        new StellarSdk.xdr.TtlEntry({ keyHash, liveUntilLedgerSeq: seq }),
      ),
      ext: StellarSdk.xdr.LedgerEntryExt.v0(),
    });
  return {
    type: 2,
    key: StellarSdk.xdr.LedgerKey.ttl(
      new StellarSdk.xdr.LedgerKeyTtl({ keyHash }),
    ),
    before: before === null ? null : entry(before),
    after: entry(after),
  };
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await getCache().flush();
  jest.mocked(getRpcServer).mockReturnValue(server);
  jest
    .spyOn(footprintParser, "detectTokenContract")
    .mockResolvedValue("unknown");
  mockSimulate.mockResolvedValue(success());
  mockEntries.mockResolvedValue({ entries: [], latestLedger: 999 });
});

describe("simulateTransaction", () => {
  it("extracts a successful footprint and cost", async () => {
    const response = {
      ...success(),
      cost: { cpuInsns: "1000", memBytes: "2000" },
    };
    mockSimulate.mockResolvedValue(response);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(true);
    expect(result.cost).toEqual(response.cost);
    expect(result.rawFootprint).toEqual({ readOnly: [], readWrite: [] });
    expect(result.contracts).toEqual([]);
    expect(mockSimulate).toHaveBeenCalledTimes(1);
  });
  it("sanitizes simulation errors", async () => {
    mockSimulate.mockResolvedValue({
      id: "test",
      _parsed: true,
      latestLedger: 101,
      events: [],
      error: "contract panic",
    });
    expect(await simulateTransaction(SOROBAN_INVOKE_XDR)).toMatchObject({
      success: false,
      error: "contract panic",
      code: "RPC_SIMULATION_ERROR",
    });
  });
  it("rejects malformed envelopes and classic operations before RPC", async () => {
    await expect(simulateTransaction(INVALID_BASE64_XDR)).rejects.toThrow();
    expect(await simulateTransaction(CLASSIC_PAYMENT_XDR)).toMatchObject({
      success: false,
      code: "TRANSACTION_MISSING_SOROBAN_OPERATION",
    });
    expect(mockSimulate).not.toHaveBeenCalled();
  });
  it("unwraps fee bump transactions", async () => {
    expect(await simulateTransaction(FEE_BUMP_XDR)).toMatchObject({
      success: false,
      feeBump: true,
    });
  });
  it("upgrades v0 envelopes before simulation", async () => {
    const tx = new StellarSdk.xdr.TransactionV0({
      sourceAccountEd25519: Buffer.alloc(32, 1),
      fee: 100,
      seqNum: 1n,
      timeBounds: new StellarSdk.xdr.TimeBounds({ minTime: 0n, maxTime: 0n }),
      memo: StellarSdk.xdr.Memo.memoNone(),
      operations: [
        StellarSdk.Operation.invokeContractFunction({
          contract: StellarSdk.Address.contract(Buffer.alloc(32)).toString(),
          function: "hello",
          args: [],
        }),
      ],
      ext: StellarSdk.xdr.TransactionV0Ext.v0(),
    });
    const v0 = StellarSdk.xdr.TransactionEnvelope.envelopeTypeTxV0(
      new StellarSdk.xdr.TransactionV0Envelope({ tx, signatures: [] }),
    ).toXDR("base64");
    expect(await simulateTransaction(v0)).toMatchObject({
      success: true,
      upgradedFromV0: true,
    });
  });
  it("passes ledger and network options and reports stale ledger selection", async () => {
    mockSimulate.mockResolvedValue(success([], 1000));
    const result = await simulateTransaction(
      SOROBAN_INVOKE_XDR,
      "mainnet",
      undefined,
      500,
    );
    expect(getRpcServer).toHaveBeenCalledWith("mainnet");
    expect(mockSimulate.mock.calls[0][1]).toMatchObject({ ledger: 500 });
    expect(result.warnings).toEqual([expect.stringContaining("500")]);
  });
  it("reports missing transaction data", async () => {
    mockSimulate.mockResolvedValue({
      ...success(),
      transactionData: undefined,
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    expect(await simulateTransaction(SOROBAN_INVOKE_XDR)).toMatchObject({
      success: false,
      code: "SIMULATION_DATA_MISSING",
    });
  });
});

describe("storage TTL analysis", () => {
  it("matches reordered and omitted entries by key using simulation latestLedger", async () => {
    const second = codeKey(3);
    mockSimulate.mockResolvedValue(success([codeKey(), second, dataKey]));
    mockEntries.mockResolvedValue({
      latestLedger: 999,
      entries: [ledgerEntry(dataKey, 150), ledgerEntry(second, 240_101)],
    });
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.ttl?.[raw(dataKey)]).toMatchObject({
      liveUntilLedger: 150,
      expiresInLedgers: 49,
      requiresExtension: true,
    });
    expect(result.ttl?.[raw(second)]?.expiresInLedgers).toBe(240_000);
    expect(result.ttl?.[raw(codeKey())]).toEqual({
      liveUntilLedger: null,
      expiresInLedgers: null,
    });
    expect(result.ttl?.[raw(accountKey)]).toBeUndefined();
    expect(result.footprint?.readOnly[2].ttlInfo).toEqual(
      result.ttl?.[raw(dataKey)],
    );
    expect(result.ttlWarnings).toEqual([
      expect.stringContaining("expires in 49 ledgers"),
    ]);
    expect(result.cost?.ttlExtension).toEqual({
      extendTo: TTL_WARNING_THRESHOLD_LEDGERS,
      entries: [raw(dataKey)],
      restoreFirst: false,
    });
  });
  it.each([
    [-1, true, true],
    [0, true, false],
    [99_999, true, false],
    [100_000, true, false],
    [239_999, true, false],
    [240_000, false, false],
    [240_001, false, false],
  ])("handles %i remaining ledgers", async (remaining, warns, archived) => {
    mockSimulate.mockResolvedValue(success([codeKey()]));
    mockEntries.mockResolvedValue({
      latestLedger: 999,
      entries: [ledgerEntry(codeKey(), 101 + remaining)],
    });
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.ttl?.[raw(codeKey())]).toMatchObject({
      expiresInLedgers: remaining,
      requiresRestore: archived,
      requiresExtension: remaining < 100_000,
    });
    expect(result.ttlWarnings).toHaveLength(warns ? 1 : 0);
    expect(Boolean(result.cost?.ttlExtension)).toBe(warns);
  });
  it("uses pre simulation TTL state changes rather than projected extension values", async () => {
    mockSimulate.mockResolvedValue({
      ...success([dataKey]),
      stateChanges: [ttlState(dataKey, 150, 500_000)],
    });
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.ttl?.[raw(dataKey)]?.expiresInLedgers).toBe(49);
    expect(mockEntries).not.toHaveBeenCalled();
  });
  it("reads TTLs created in state changes", async () => {
    mockSimulate.mockResolvedValue({
      ...success([dataKey]),
      stateChanges: [ttlState(dataKey, null, 250_000)],
    });
    expect(
      (await simulateTransaction(SOROBAN_INVOKE_XDR)).ttl?.[raw(dataKey)]
        ?.liveUntilLedger,
    ).toBe(250_000);
  });
  it("reports restoration preamble keys without inventing unavailable expiration ledgers", async () => {
    mockSimulate.mockResolvedValue({
      ...success([dataKey]),
      result: { auth: [], retval: StellarSdk.xdr.ScVal.scvVoid() },
      restorePreamble: {
        minResourceFee: "100",
        transactionData: new StellarSdk.SorobanDataBuilder().setReadWrite([
          dataKey,
        ]),
      },
    });
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result).toMatchObject({
      success: false,
      type: "restoration_required",
    });
    expect(result.ttl?.[raw(dataKey)]).toEqual({
      liveUntilLedger: null,
      expiresInLedgers: null,
      requiresRestore: true,
      requiresExtension: true,
    });
    expect(result.cost?.ttlExtension?.restoreFirst).toBe(true);
    expect(result.ttlWarnings).toEqual([
      expect.stringContaining("is archived"),
    ]);
  });
  it("preserves TTLs from state changes when lookup fails", async () => {
    mockSimulate.mockResolvedValue({
      ...success([dataKey, codeKey()]),
      stateChanges: [ttlState(dataKey, 150, 200)],
    });
    mockEntries.mockRejectedValue(new Error("unavailable"));
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(true);
    expect(result.ttl?.[raw(dataKey)]?.expiresInLedgers).toBe(49);
  });
});

const payer = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const cosigner = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
const recipient = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
const contract = StellarSdk.Address.contract(Buffer.alloc(32, 7)).toString();
const cosigner2 = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 8));
const cosigner3 = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
const addr = (key: StellarSdk.Keypair) =>
  new StellarSdk.Address(key.publicKey()).toScVal();
const i128 = (value = 123456789012345678901234567890n) =>
  StellarSdk.nativeToScVal(value, { type: "i128" });
const transferArgs = [addr(payer), addr(recipient), i128()];
function invocation(
  functionName = "transfer",
  args = transferArgs,
): StellarSdk.xdr.InvokeContractArgs {
  return new StellarSdk.xdr.InvokeContractArgs({
    contractAddress: new StellarSdk.Address(contract).toScAddress(),
    functionName,
    args,
  });
}
function tree(
  functionName = "transfer",
  children: StellarSdk.xdr.SorobanAuthorizedInvocation[] = [],
  args = transferArgs,
): StellarSdk.xdr.SorobanAuthorizedInvocation {
  return new StellarSdk.xdr.SorobanAuthorizedInvocation({
    function:
      StellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        invocation(functionName, args),
      ),
    subInvocations: children,
  });
}
function signature(keys: StellarSdk.Keypair[]): StellarSdk.xdr.ScVal {
  return StellarSdk.xdr.ScVal.scvVec(
    keys.map((key) =>
      StellarSdk.xdr.ScVal.scvMap([
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol("public_key"),
          val: StellarSdk.xdr.ScVal.scvBytes(key.rawPublicKey()),
        }),
        new StellarSdk.xdr.ScMapEntry({
          key: StellarSdk.xdr.ScVal.scvSymbol("signature"),
          val: StellarSdk.xdr.ScVal.scvBytes(key.sign(Buffer.alloc(32))),
        }),
      ]),
    ),
  );
}
function authorization(
  root = tree(),
  keys: StellarSdk.Keypair[] = [],
  account = payer,
): StellarSdk.xdr.SorobanAuthorizationEntry {
  return new StellarSdk.xdr.SorobanAuthorizationEntry({
    rootInvocation: root,
    credentials: StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
      new StellarSdk.xdr.SorobanAddressCredentials({
        address: new StellarSdk.Address(account.publicKey()).toScAddress(),
        nonce: 1n,
        signatureExpirationLedger: 1000,
        signature: signature(keys),
      }),
    ),
  });
}
function transaction(
  functionName = "transfer",
  args = transferArgs,
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[] = [],
): StellarSdk.Transaction {
  return mockTransaction({ sourceAccount: payer })
    .withContractCall(contract, functionName, args)
    .withAuth(auth)
    .build();
}
function accountData(
  account = payer,
  thresholds = [1, 1, 2, 3],
  weight = 1,
): StellarSdk.xdr.LedgerEntryData {
  return StellarSdk.xdr.LedgerEntryData.account(
    new StellarSdk.xdr.AccountEntry({
      accountId: StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
        account.rawPublicKey(),
      ),
      balance: 10000000n,
      seqNum: 1n,
      numSubEntries: 1,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from(thresholds),
      signers: [
        new StellarSdk.xdr.Signer({
          key: StellarSdk.xdr.SignerKey.signerKeyTypeEd25519(
            cosigner.rawPublicKey(),
          ),
          weight,
        }),
      ],
      ext: StellarSdk.xdr.AccountEntryExt.v0(),
    }),
  );
}
function accountState(
  account = payer,
  thresholds = [1, 1, 2, 3],
): StellarSdk.rpc.Api.LedgerEntryChange {
  return {
    type: 2,
    key: StellarSdk.xdr.LedgerKey.account(
      new StellarSdk.xdr.LedgerKeyAccount({
        accountId: StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
          account.rawPublicKey(),
        ),
      }),
    ),
    before: new StellarSdk.xdr.LedgerEntry({
      lastModifiedLedgerSeq: 100,
      data: accountData(account, thresholds),
      ext: StellarSdk.xdr.LedgerEntryExt.v0(),
    }),
    after: null,
  };
}

function multiSigAccountData(
  account = payer,
  thresholds = [0, 1, 2, 3],
  signers: { key: StellarSdk.Keypair; weight: number }[] = [],
): StellarSdk.xdr.LedgerEntryData {
  return StellarSdk.xdr.LedgerEntryData.account(
    new StellarSdk.xdr.AccountEntry({
      accountId: StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
        account.rawPublicKey(),
      ),
      balance: 10000000n,
      seqNum: 1n,
      numSubEntries: signers.length,
      inflationDest: null,
      flags: 0,
      homeDomain: "",
      thresholds: Buffer.from(thresholds),
      signers: signers.map(
        ({ key, weight }) =>
          new StellarSdk.xdr.Signer({
            key: StellarSdk.xdr.SignerKey.signerKeyTypeEd25519(
              key.rawPublicKey(),
            ),
            weight,
          }),
      ),
      ext: StellarSdk.xdr.AccountEntryExt.v0(),
    }),
  );
}

function multiSigAccountState(
  account = payer,
  thresholds = [0, 1, 2, 3],
  signers: { key: StellarSdk.Keypair; weight: number }[] = [],
): StellarSdk.rpc.Api.LedgerEntryChange {
  return {
    type: 2,
    key: StellarSdk.xdr.LedgerKey.account(
      new StellarSdk.xdr.LedgerKeyAccount({
        accountId: StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
          account.rawPublicKey(),
        ),
      }),
    ),
    before: new StellarSdk.xdr.LedgerEntry({
      lastModifiedLedgerSeq: 100,
      data: multiSigAccountData(account, thresholds, signers),
      ext: StellarSdk.xdr.LedgerEntryExt.v0(),
    }),
    after: null,
  };
}

describe("static dry run", () => {
  it.each([
    ["transfer", transferArgs],
    ["balance", [addr(payer)]],
    [
      "approve",
      [addr(payer), addr(recipient), i128(), StellarSdk.xdr.ScVal.scvU32(1000)],
    ],
    ["transfer_from", [addr(cosigner), ...transferArgs]],
  ])("recognizes SEP 41 %s by its symbol and argument types", (name, args) => {
    const result = simulateDryRun(transaction(name, args).toXDR());
    expect(result.operations[0].invocation).toMatchObject({
      contractId: contract,
      functionName: name,
      interfaceEstimation: { name: "SEP-41" },
    });
    expect(mockSimulate).not.toHaveBeenCalled();
    expect(mockEntries).not.toHaveBeenCalled();
    expect(getRpcServer).not.toHaveBeenCalled();
  });

  // ── #429: TTL expiry warnings ─────────────────────────────────────────────

  it("returns warnings for footprint entries expiring in < 100 ledgers", async () => {
    // Set up a non-empty footprint so TTL lookup is triggered
    const mockEntry = {
      toXDR: jest
        .fn()
        .mockReturnValue(
          "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==",
        ),
    };
    mockFootprint.readOnly.mockReturnValueOnce([mockEntry]);
    mockFootprint.readWrite.mockReturnValueOnce([]);
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());
    // Entry expires in 49 ledgers (liveUntil=150, current=101)
    mockGetLedgerEntries.mockResolvedValueOnce({
      entries: [{ liveUntilLedgerSeq: 150 }],
      latestLedger: 101,
    });
    expect(simulateDryRun(FEE_BUMP_XDR).operations[0].type).toBe("payment");
    const upload = buildMockTransaction({
      sourceAccount: payer,
      operations: [
        StellarSdk.Operation.uploadContractWasm({ wasm: Buffer.from("wasm") }),
      ],
    });
    expect(
      simulateDryRun(upload.toXDR()).operations[0].invocation,
    ).toBeUndefined();
  });
});

  it("returns empty warnings when all entries have >= 100 ledgers remaining", async () => {
    const mockEntry = {
      toXDR: jest
        .fn()
        .mockReturnValue(
          "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==",
        ),
    };
    mockFootprint.readOnly.mockReturnValueOnce([mockEntry]);
    mockFootprint.readWrite.mockReturnValueOnce([]);
    mockSimulateTransaction.mockResolvedValue(makeSuccessResponse());
    mockGetLedgerEntries.mockResolvedValueOnce({
      entries: [{ liveUntilLedgerSeq: 300 }],
      latestLedger: 100,
    });
  });
  it.each([
    [true, 2],
    [false, 1],
  ])(
    "compares supplied master and signer weights to the medium threshold (sufficient %s)",
    async (sufficient, total) => {
      const auth = authorization(
        tree(),
        sufficient ? [payer, cosigner, cosigner] : [payer],
      );
      mockSimulate.mockResolvedValue({
        ...success(),
        stateChanges: [accountState()],
        result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
      });
      const result = await simulateTransaction(transaction().toXDR());
      expect(result.signerThresholdReports?.[0]).toMatchObject({
        accountId: payer.publicKey(),
        authorizationLevel: "payment",
        thresholdRequired: 2,
        totalWeight: total,
        isSufficient: sufficient,
      });
      expect(result.signerThresholdReports?.[0].signers).toHaveLength(total);
    },
  );
  it("uses the high threshold when an admin invocation is nested in a payment tree", async () => {
    const auth = authorization(
      tree("transfer", [tree("mint", [], [addr(payer), i128()])]),
      [payer, cosigner],
    );
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      authorizationLevel: "admin",
      thresholdRequired: 3,
      totalWeight: 2,
      isSufficient: false,
    });
  });
  it("does not count unsigned credentials or keys not configured as account signers", async () => {
    const auth = authorization(tree(), [recipient]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      totalWeight: 0,
      isSufficient: false,
    });
    expect(result.signerThresholdReports?.[0].signers).toEqual([
      { publicKey: recipient.publicKey(), weight: 0 },
    ]);
    await getCache().flush();
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: {
        auth: [authorization()],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    });
    expect(
      (await simulateTransaction(transaction().toXDR()))
        .signerThresholdReports?.[0],
    ).toMatchObject({ signers: [], totalWeight: 0, isSufficient: false });
  });
  it("reads account entries from the touched footprint", async () => {
    const state = accountState();
    const auth = authorization(tree(), [payer, cosigner]);
    mockSimulate.mockResolvedValue({
      ...success([state.key]),
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    mockEntries.mockResolvedValue({
      entries: [{ key: state.key, val: accountData() }],
      latestLedger: 200,
    });
    expect(
      (await simulateTransaction(transaction().toXDR()))
        .signerThresholdReports?.[0].isSufficient,
    ).toBe(true);
    expect(mockEntries).toHaveBeenCalledWith(state.key);
  });
  it("prefers signed envelope credentials when the simulated authorization tree matches", async () => {
    const unsigned = authorization();
    const signed = authorization(tree(), [payer, cosigner]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [unsigned], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(
      transaction("transfer", transferArgs, [signed]).toXDR(),
    );
    expect(result.signerThresholdReports?.[0].isSufficient).toBe(true);
  });
  it("checks separate authorization trees without combining their signatures", async () => {
    const auth = [
      authorization(tree(), [payer]),
      authorization(tree("balance", [], [addr(payer)]), [cosigner]),
    ];
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth, retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.requiredSigners).toEqual([payer.publicKey()]);
    expect(result.signerThresholdReports).toHaveLength(2);
    expect(
      result.signerThresholdReports?.every(
        (report) => report.totalWeight === 1 && !report.isSufficient,
      ),
    ).toBe(true);
  });
  it("uses source account credentials and verified transaction signatures", async () => {
    const auth = new StellarSdk.xdr.SorobanAuthorizationEntry({
      credentials:
        StellarSdk.xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: tree(),
    });
    const tx = transaction("transfer", transferArgs, [auth]);
    tx.sign(payer, cosigner);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(tx.toXDR());
    expect(result.requiredSigners).toEqual([payer.publicKey()]);
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      totalWeight: 2,
      isSufficient: true,
    });
  });
  it("keeps custom contract credentials unknown instead of treating them as accounts", async () => {
    const auth = new StellarSdk.xdr.SorobanAuthorizationEntry({
      credentials: StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
        new StellarSdk.xdr.SorobanAddressCredentials({
          address: new StellarSdk.Address(contract).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 1000,
          signature: StellarSdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: tree(),
    });
    mockSimulate.mockResolvedValue({
      ...success(),
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.requiredSigners).toEqual([contract]);
    expect(result.signerThresholdReports?.[0].isSufficient).toBeNull();
  });

  it("reads upgraded address credentials returned by the current RPC", async () => {
    const original = authorization(tree(), [payer, cosigner]);
    if (original.credentials.type !== "sorobanCredentialsAddress")
      throw new Error("Expected address credentials in fixture");
    const auth = new StellarSdk.xdr.SorobanAuthorizationEntry({
      rootInvocation: original.rootInvocation,
      credentials:
        StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddressV2(
          original.credentials.address,
        ),
    });
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.requiredSigners).toEqual([payer.publicKey()]);
    expect(result.authEntries?.[0].credentialsType).toBe(
      "sorobanCredentialsAddressV2",
    );
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      totalWeight: 2,
      thresholdRequired: 2,
      isSufficient: true,
    });
  });

  it("collects nested delegate authorizers and compares each account separately", async () => {
    const original = authorization(tree("mint"), [payer, cosigner]);
    if (original.credentials.type !== "sorobanCredentialsAddress")
      throw new Error("Expected address credentials in fixture");
    const nested = new StellarSdk.xdr.SorobanDelegateSignature({
      address: new StellarSdk.Address(recipient.publicKey()).toScAddress(),
      signature: signature([recipient]),
      nestedDelegates: [],
    });
    const auth = new StellarSdk.xdr.SorobanAuthorizationEntry({
      rootInvocation: original.rootInvocation,
      credentials:
        StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(
          new StellarSdk.xdr.SorobanAddressCredentialsWithDelegates({
            addressCredentials: original.credentials.address,
            delegates: [
              new StellarSdk.xdr.SorobanDelegateSignature({
                address: new StellarSdk.Address(
                  cosigner.publicKey(),
                ).toScAddress(),
                signature: signature([cosigner]),
                nestedDelegates: [nested, nested],
              }),
            ],
          }),
        ),
    });
    const encoded = transaction("mint", transferArgs, [auth]).toXDR();
    expect(simulateDryRun(encoded).operations[0].requiredSigners).toEqual([
      payer.publicKey(),
      cosigner.publicKey(),
      recipient.publicKey(),
    ]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState(), accountState(recipient, [1, 1, 1, 1])],
      result: { auth: [auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(encoded);
    expect(result.signerThresholdReports).toHaveLength(3);
    expect(result.signerThresholdReports).toEqual([
      expect.objectContaining({
        accountId: payer.publicKey(),
        authorizationLevel: "admin",
        totalWeight: 2,
        thresholdRequired: 3,
        isSufficient: false,
      }),
      expect.objectContaining({
        accountId: cosigner.publicKey(),
        authorizationLevel: "admin",
        totalWeight: null,
        isSufficient: null,
      }),
      expect.objectContaining({
        accountId: recipient.publicKey(),
        authorizationLevel: "admin",
        totalWeight: 1,
        thresholdRequired: 1,
        isSufficient: true,
      }),
    ]);
  });

  it("leaves weights unknown when a touched account lookup is unavailable", async () => {
    const state = accountState();
    mockSimulate.mockResolvedValue({
      ...success([state.key]),
      result: {
        auth: [authorization(tree(), [payer])],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    });
    mockEntries.mockRejectedValue(new Error("Account lookup unavailable"));
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.success).toBe(true);
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      signers: [{ publicKey: payer.publicKey(), weight: null }],
      thresholdRequired: null,
      totalWeight: null,
      isSufficient: null,
    });
  });
});

describe("multi-sig and threshold authorization", () => {
  it("extracts all authorizers into requiredSigners without duplicates", async () => {
    const auth = [
      authorization(tree(), [payer], payer),
      authorization(tree("balance", [], [addr(payer)]), [cosigner], cosigner),
      authorization(
        tree(
          "approve",
          [],
          [addr(payer), addr(recipient), i128(), StellarSdk.xdr.ScVal.scvU32(1000)],
        ),
        [payer],
        payer,
      ),
    ];
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth, retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.requiredSigners).toEqual([
      payer.publicKey(),
      cosigner.publicKey(),
    ]);
    expect(result.threshold).toBe(2);
    expect(result.authEntries).toHaveLength(3);
  });

  it("handles account with multiple Ed25519 signer entries (2-of-3 threshold)", async () => {
    const signers = [
      { key: cosigner, weight: 1 },
      { key: cosigner2, weight: 1 },
      { key: cosigner3, weight: 1 },
    ];
    const auth = authorization(tree(), [cosigner, cosigner2, cosigner3]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [multiSigAccountState(payer, [0, 1, 2, 3], signers)],
      result: { auth, retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    const report = result.signerThresholdReports?.[0];
    expect(report).toMatchObject({
      accountId: payer.publicKey(),
      authorizationLevel: "payment",
      thresholdRequired: 2,
      totalWeight: 3,
      isSufficient: true,
    });
    expect(report.signers).toHaveLength(3);
    expect(report.signers.map((s) => s.publicKey)).toEqual(
      expect.arrayContaining([
        cosigner.publicKey(),
        cosigner2.publicKey(),
        cosigner3.publicKey(),
      ]),
    );
  });

  it("is insufficient when fewer than threshold signers are supplied", async () => {
    const signers = [
      { key: cosigner, weight: 1 },
      { key: cosigner2, weight: 1 },
      { key: cosigner3, weight: 1 },
    ];
    const auth = authorization(tree(), [cosigner]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [multiSigAccountState(payer, [0, 1, 2, 3], signers)],
      result: { auth, retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      thresholdRequired: 2,
      totalWeight: 1,
      isSufficient: false,
    });
  });

  it("handles contract auth with nested sub-contract invocations", async () => {
    const nestedTree = tree("transfer", [
      tree("mint", [], [addr(payer), i128()]),
      tree(
        "approve",
        [],
        [addr(payer), addr(recipient), i128(), StellarSdk.xdr.ScVal.scvU32(1000)],
      ),
    ]);
    const auth = authorization(nestedTree, [payer, cosigner]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth, retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.authEntries?.[0].invocationTree).toMatchObject({
      authorizationLevel: "admin",
      subInvocations: expect.arrayContaining([
        expect.objectContaining({
          authorizationLevel: "admin",
          invocation: expect.objectContaining({ functionName: "mint" }),
        }),
        expect.objectContaining({
          authorizationLevel: "payment",
          invocation: expect.objectContaining({ functionName: "approve" }),
        }),
      ]),
    });
    expect(result.signerThresholdReports?.[0]).toMatchObject({
      authorizationLevel: "admin",
      thresholdRequired: 3,
      totalWeight: 2,
      isSufficient: false,
    });
  });

  it("handles mixed address and account credentials with distinct authorizers", async () => {
    const addressAuth = authorization(tree(), [payer, cosigner], payer);
    const sourceAuth = new StellarSdk.xdr.SorobanAuthorizationEntry({
      credentials:
        StellarSdk.xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
      rootInvocation: tree("balance", [], [addr(payer)]),
    });
    // Set the operation source to cosigner so the source-account credential
    // resolves to cosigner (not the default payer), creating a distinct
    // authorizer from the address-credential entry.
    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(payer.publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(
        StellarSdk.Operation.invokeHostFunction({
          func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
            invocation("transfer", transferArgs),
          ),
          auth: [addressAuth, sourceAuth],
          source: cosigner.publicKey(),
        }),
      )
      .setTimeout(0)
      .build();
    tx.sign(payer, cosigner);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState(), accountState(cosigner)],
      result: { auth: [addressAuth, sourceAuth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(tx.toXDR());
    expect(result.requiredSigners).toEqual([
      payer.publicKey(),
      cosigner.publicKey(),
    ]);
    expect(result.authEntries).toHaveLength(2);
    expect(result.authEntries?.[0].credentialsType).toBe(
      "sorobanCredentialsAddress",
    );
    expect(result.authEntries?.[1].credentialsType).toBe(
      "sorobanCredentialsSourceAccount",
    );
    expect(result.signerThresholdReports).toHaveLength(2);
  });

  it("deduplicates identical auth entries in requiredSigners", async () => {
    const auth = authorization(tree(), [payer, cosigner]);
    mockSimulate.mockResolvedValue({
      ...success(),
      stateChanges: [accountState()],
      result: { auth: [auth, auth], retval: StellarSdk.xdr.ScVal.scvVoid() },
    });
    const result = await simulateTransaction(transaction().toXDR());
    expect(result.requiredSigners).toEqual([payer.publicKey()]);
    expect(result.authEntries).toHaveLength(1);
    expect(result.threshold).toBe(1);
  });
});
