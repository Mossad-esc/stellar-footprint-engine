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
import * as footprintParser from "../footprintParser";
import {
  simulateTransaction,
  simulateDryRun,
  measureCallDepth,
  parseDiagnosticEvents,
} from "../simulator";

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
  } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
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
    ),
    lastModifiedLedgerSeq: 100,
  } as unknown as StellarSdk.rpc.Api.LedgerEntryResult;
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
  } as unknown as StellarSdk.rpc.Api.LedgerEntryChange;
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  await getCache().flush();
  jest.mocked(getRpcServer).mockReturnValue(server);
  jest
    .spyOn(footprintParser, "detectTokenContract")
    .mockResolvedValue("unknown");
  jest.spyOn(footprintParser, "detectSacContracts").mockResolvedValue([]);
  mockSimulate.mockResolvedValue(success());
  mockEntries.mockResolvedValue({
    entries: [],
    latestLedger: 999,
  } as unknown as StellarSdk.rpc.Api.GetLedgerEntriesResponse);
});

// ---------------------------------------------------------------------------
// simulateTransaction core
// ---------------------------------------------------------------------------

describe("simulateTransaction", () => {
  it("extracts a successful footprint and cost", async () => {
    const response = {
      ...success(),
      cost: { cpuInsns: "1000", memBytes: "2000" },
    };
    mockSimulate.mockResolvedValue(response);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(true);
    expect(result.cost).toMatchObject({
      cpuInsns: "1000",
      memBytes: "2000",
    });
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
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse);
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

// ---------------------------------------------------------------------------
// storage TTL analysis
// ---------------------------------------------------------------------------

describe("storage TTL analysis", () => {
  it("matches reordered and omitted entries by key using simulation latestLedger", async () => {
    const second = codeKey(3);
    mockSimulate.mockResolvedValue(success([codeKey(), second, dataKey]));
    mockEntries.mockResolvedValue({
      latestLedger: 999,
      entries: [ledgerEntry(dataKey, 150), ledgerEntry(second, 240_101)],
    } as unknown as StellarSdk.rpc.Api.GetLedgerEntriesResponse);
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
    } as unknown as StellarSdk.rpc.Api.GetLedgerEntriesResponse);
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
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.ttl?.[raw(dataKey)]?.expiresInLedgers).toBe(49);
    expect(mockEntries).not.toHaveBeenCalled();
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
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse);
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
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    mockEntries.mockRejectedValue(new Error("unavailable"));
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(true);
    expect(result.ttl?.[raw(dataKey)]?.expiresInLedgers).toBe(49);
  });
});

// ---------------------------------------------------------------------------
// Issue #19: Call stack depth analyzer
// ---------------------------------------------------------------------------

describe("issue #19 — call stack depth analyzer", () => {
  const payer = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
  const contract = StellarSdk.Address.contract(Buffer.alloc(32, 7)).toString();

  function makeInvocation(
    depth: number,
  ): StellarSdk.xdr.SorobanAuthorizedInvocation {
    const leaf = new StellarSdk.xdr.SorobanAuthorizedInvocation({
      function:
        StellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new StellarSdk.xdr.InvokeContractArgs({
            contractAddress: new StellarSdk.Address(contract).toScAddress(),
            functionName: "leaf",
            args: [],
          }),
        ),
      subInvocations: [],
    });
    let current = leaf;
    for (let i = 1; i < depth; i++) {
      current = new StellarSdk.xdr.SorobanAuthorizedInvocation({
        function:
          StellarSdk.xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
            new StellarSdk.xdr.InvokeContractArgs({
              contractAddress: new StellarSdk.Address(contract).toScAddress(),
              functionName: `level${i}`,
              args: [],
            }),
          ),
        subInvocations: [current],
      });
    }
    return current;
  }

  function makeAuthEntry(
    depth: number,
  ): StellarSdk.xdr.SorobanAuthorizationEntry {
    return new StellarSdk.xdr.SorobanAuthorizationEntry({
      credentials: StellarSdk.xdr.SorobanCredentials.sorobanCredentialsAddress(
        new StellarSdk.xdr.SorobanAddressCredentials({
          address: new StellarSdk.Address(payer.publicKey()).toScAddress(),
          nonce: 1n,
          signatureExpirationLedger: 1000,
          signature: StellarSdk.xdr.ScVal.scvVoid(),
        }),
      ),
      rootInvocation: makeInvocation(depth),
    });
  }

  it("returns depth 1 for a flat invocation (no nesting)", () => {
    const response = {
      ...success(),
      result: {
        auth: [makeAuthEntry(1)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
    expect(measureCallDepth(response)).toBe(1);
  });

  it("returns depth 3 for three nested contract calls", () => {
    const response = {
      ...success(),
      result: {
        auth: [makeAuthEntry(3)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
    expect(measureCallDepth(response)).toBe(3);
  });

  it("returns depth 9 for nine nested contract calls", () => {
    const response = {
      ...success(),
      result: {
        auth: [makeAuthEntry(9)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;
    expect(measureCallDepth(response)).toBe(9);
  });

  it("populates maxCallDepth in the simulation result", async () => {
    mockSimulate.mockResolvedValue({
      ...success(),
      result: {
        auth: [makeAuthEntry(3)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.maxCallDepth).toBe(3);
  });

  it("emits a warning when call depth >= 8", async () => {
    mockSimulate.mockResolvedValue({
      ...success(),
      result: {
        auth: [makeAuthEntry(9)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.maxCallDepth).toBe(9);
    expect(result.warnings).toEqual([
      expect.stringContaining("Call stack depth 9"),
    ]);
  });

  it("does not emit a call depth warning when depth < 8", async () => {
    mockSimulate.mockResolvedValue({
      ...success(),
      result: {
        auth: [makeAuthEntry(3)],
        retval: StellarSdk.xdr.ScVal.scvVoid(),
      },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.warnings?.some((w) => w.includes("Call stack depth"))).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// Issue #20: Diagnostic events parser
// ---------------------------------------------------------------------------

describe("issue #20 — diagnostic events parser", () => {
  function makeDiagEvent(
    topics: StellarSdk.xdr.ScVal[],
    data: StellarSdk.xdr.ScVal,
  ): StellarSdk.xdr.DiagnosticEvent {
    return new StellarSdk.xdr.DiagnosticEvent({
      inSuccessfulContractCall: true,
      event: new StellarSdk.xdr.ContractEvent({
        ext: StellarSdk.xdr.ExtensionPoint.v0(),
        contractId: null,
        type: StellarSdk.xdr.ContractEventType.contract(),
        body: StellarSdk.xdr.ContractEventBody.v0(
          new StellarSdk.xdr.ContractEventV0({
            topics,
            data,
          }),
        ),
      }),
    });
  }

  it("classifies fn_call topic as debug", () => {
    const ev = makeDiagEvent(
      [StellarSdk.xdr.ScVal.scvSymbol("fn_call")],
      StellarSdk.xdr.ScVal.scvVoid(),
    );
    const [parsed] = parseDiagnosticEvents([ev.toXDR("base64")]);
    expect(parsed.logLevel).toBe("debug");
    expect(parsed.topic).toBe("fn_call");
  });

  it("classifies error topic as error level", () => {
    const ev = makeDiagEvent(
      [
        StellarSdk.xdr.ScVal.scvSymbol("error"),
        StellarSdk.nativeToScVal(123, { type: "u32" }),
      ],
      StellarSdk.xdr.ScVal.scvVoid(),
    );
    const [parsed] = parseDiagnosticEvents([ev.toXDR("base64")]);
    expect(parsed.logLevel).toBe("error");
    expect(parsed.errorCode).toBe(123);
  });

  it("classifies log topic as info level", () => {
    const ev = makeDiagEvent(
      [StellarSdk.xdr.ScVal.scvSymbol("log")],
      StellarSdk.xdr.ScVal.scvString("hello from contract"),
    );
    const [parsed] = parseDiagnosticEvents([ev.toXDR("base64")]);
    expect(parsed.logLevel).toBe("info");
    expect(parsed.topic).toBe("log");
    expect(parsed.data).toBe("hello from contract");
  });

  it("falls back gracefully for unparseable XDR", () => {
    const [parsed] = parseDiagnosticEvents(["not-valid-xdr-at-all"]);
    expect(parsed.logLevel).toBe("debug");
    expect(parsed.topic).toBe("unknown");
    expect(parsed.xdr).toBe("not-valid-xdr-at-all");
  });

  it("returns empty array for empty input", () => {
    expect(parseDiagnosticEvents([])).toEqual([]);
  });

  it("includes parsedDiagnosticEvents in a simulation error response", async () => {
    const ev = makeDiagEvent(
      [StellarSdk.xdr.ScVal.scvSymbol("error")],
      StellarSdk.xdr.ScVal.scvVoid(),
    );
    mockSimulate.mockResolvedValue({
      id: "test",
      _parsed: true,
      latestLedger: 101,
      events: [ev],
      error: "contract execution failed",
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(false);
    expect(result.parsedDiagnosticEvents).toBeDefined();
    expect(result.parsedDiagnosticEvents?.length).toBeGreaterThan(0);
    expect(result.parsedDiagnosticEvents?.[0].logLevel).toBe("error");
  });

  it("includes parsedDiagnosticEvents in a successful simulation response", async () => {
    const ev = makeDiagEvent(
      [StellarSdk.xdr.ScVal.scvSymbol("fn_call")],
      StellarSdk.xdr.ScVal.scvVoid(),
    );
    mockSimulate.mockResolvedValue({
      ...success(),
      events: [ev],
      result: { auth: [], retval: StellarSdk.xdr.ScVal.scvVoid() },
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse);
    const result = await simulateTransaction(SOROBAN_INVOKE_XDR);
    expect(result.success).toBe(true);
    expect(result.parsedDiagnosticEvents).toBeDefined();
    expect(result.parsedDiagnosticEvents?.[0].topic).toBe("fn_call");
  });
});

// ---------------------------------------------------------------------------
// static dry run
// ---------------------------------------------------------------------------

const payer = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 4));
const cosigner = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 5));
const recipient = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 6));
const contract = StellarSdk.Address.contract(Buffer.alloc(32, 7)).toString();
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

function transaction(
  functionName = "transfer",
  args = transferArgs,
  auth: StellarSdk.xdr.SorobanAuthorizationEntry[] = [],
): StellarSdk.Transaction {
  return new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(payer.publicKey(), "1"),
    { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
  )
    .addOperation(
      StellarSdk.Operation.invokeHostFunction({
        func: StellarSdk.xdr.HostFunction.hostFunctionTypeInvokeContract(
          invocation(functionName, args),
        ),
        auth,
      }),
    )
    .setTimeout(0)
    .build();
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

  it("handles fee-bump envelope payment operations", () => {
    expect(simulateDryRun(FEE_BUMP_XDR).operations[0].type).toBe("payment");
  });

  it("does not describe WASM uploads as invocations", () => {
    const upload = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(payer.publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(
        StellarSdk.Operation.uploadContractWasm({ wasm: Buffer.from("wasm") }),
      )
      .setTimeout(0)
      .build();
    expect(
      simulateDryRun(upload.toXDR()).operations[0].invocation,
    ).toBeUndefined();
  });
});
