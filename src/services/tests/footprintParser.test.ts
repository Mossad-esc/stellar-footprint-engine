import * as StellarSdk from "@stellar/stellar-sdk";

import {
  deploymentHostFunction,
  deploymentTransaction,
  PREDICTED_CONTRACT,
} from "../../tests/fixtures/deployment";
import {
  parseFootprint,
  parseContractInvocation,
  hasContractCreationInstance,
  extractContracts,
  detectTokenContract,
  isSacContract,
  detectSacContracts,
  calculateFootprintStats,
} from "../footprintParser";

// ── XDR Fixtures ─────────────────────────────────────────────────────────────

/** ContractData ledger key — contract address = 32 bytes of 0x01, persistent */
const CONTRACT_DATA_XDR =
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
const CONTRACT_DATA_ID = "01".repeat(32);

/** ContractCode ledger key — hash = 32 bytes of 0x02 */
const CONTRACT_CODE_XDR = "AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";
const CONTRACT_CODE_ID = "02".repeat(32);

/** Account ledger key */
const ACCOUNT_XDR = "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==";

/** TrustLine ledger key */
const TRUSTLINE_XDR =
  "AAAAAQAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1wAAAAFVU0RDAAAAAOC5H/7peiRPvVLqr0yqYyUbiX9o1toddz1bmyboUP/X";

const TEST_ACCOUNT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

// ── Helper builders ───────────────────────────────────────────────────────────

function contractDataKey(
  contractByte: number,
  key: StellarSdk.xdr.ScVal = StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
  durability?: StellarSdk.xdr.ContractDataDurability,
  contractId?: string,
): StellarSdk.xdr.LedgerKey {
  const address = contractId
    ? StellarSdk.xdr.ScAddress.scAddressTypeContract(
        Buffer.from(StellarSdk.StrKey.decodeContract(contractId)),
      )
    : StellarSdk.xdr.ScAddress.scAddressTypeContract(
        Buffer.alloc(32, contractByte),
      );
  const dur =
    durability ?? StellarSdk.xdr.ContractDataDurability.fromName("persistent");
  return StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: address,
      key,
      durability: dur,
    }),
  );
}

function sacFootprint(asset: StellarSdk.Asset): StellarSdk.SorobanDataBuilder {
  return new StellarSdk.SorobanDataBuilder()
    .setReadOnly([
      contractDataKey(
        0,
        StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
        undefined,
        StellarSdk.StrKey.decodeContract(
          asset.contractId(StellarSdk.Networks.TESTNET),
        ).toString("hex")
          ? asset.contractId(StellarSdk.Networks.TESTNET)
          : undefined,
      ),
      StellarSdk.xdr.LedgerKey.fromXDR(ACCOUNT_XDR, "base64"),
    ])
    .setReadWrite([
      contractDataKey(
        0,
        StellarSdk.xdr.ScVal.scvVec([
          StellarSdk.xdr.ScVal.scvSymbol("Balance"),
          StellarSdk.xdr.ScVal.scvAddress(
            StellarSdk.xdr.ScAddress.scAddressTypeAccount(
              StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
                Buffer.alloc(32, 0xe0),
              ),
            ),
          ),
        ]),
        StellarSdk.xdr.ContractDataDurability.fromName("persistent"),
        StellarSdk.StrKey.decodeContract(
          asset.contractId(StellarSdk.Networks.TESTNET),
        ).toString("hex")
          ? asset.contractId(StellarSdk.Networks.TESTNET)
          : undefined,
      ),
    ]);
}

// ---------------------------------------------------------------------------
// Issue #21: Storage Entry Lifetime Classification
// ---------------------------------------------------------------------------

describe("issue #21 — storage entry lifetime classification", () => {
  it("separates instance, code, persistent and temporary keys with exact XDR sizes", () => {
    const instance = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    ).toXDR("base64");
    const persistent = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("settings"),
    ).toXDR("base64");
    const temporary = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("session"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    ).toXDR("base64");
    const footprint = {
      readOnly: [CONTRACT_CODE_XDR, persistent, ACCOUNT_XDR],
      readWrite: [instance, temporary, TRUSTLINE_XDR],
    };
    const parsed = parseFootprint(footprint);
    for (const [category, key, mode] of [
      ["contractCode", CONTRACT_CODE_XDR, "readOnly"],
      ["contractInstance", instance, "readWrite"],
      ["persistentData", persistent, "readOnly"],
      ["temporaryData", temporary, "readWrite"],
    ] as const) {
      expect(parsed.breakdown[category]).toEqual({
        count: 1,
        estimatedSizeBytes: Buffer.from(key, "base64").length,
        readOnly: mode === "readOnly" ? [key] : [],
        readWrite: mode === "readWrite" ? [key] : [],
      });
    }
    const stats = calculateFootprintStats(footprint, parsed);
    expect(stats.breakdown).toEqual(parsed.breakdown);
    expect(stats.totalEntries).toBe(6);
    expect(parsed.readOnly.map((entry) => entry.xdr)).toEqual(
      footprint.readOnly,
    );
    expect(parsed.readWrite.map((entry) => entry.xdr)).toEqual(
      footprint.readWrite,
    );
  });

  it("treats symbols named INSTANCE as ordinary storage and uses durability", () => {
    const persistent = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvSymbol("INSTANCE"),
    );
    const temporary = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvSymbol("INSTANCE"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    );
    const result = parseFootprint({
      readOnly: [persistent.toXDR("base64"), temporary.toXDR("base64")],
      readWrite: [],
    });
    expect(result.breakdown.contractInstance.count).toBe(0);
    expect(result.readOnly.map((entry) => entry.storageType)).toEqual([
      "persistentData",
      "temporaryData",
    ]);
  });

  it("returns zeroed categories for empty and unsupported footprints", () => {
    for (const footprint of [
      { readOnly: [], readWrite: [] },
      { readOnly: ["bad-xdr", ACCOUNT_XDR], readWrite: [TRUSTLINE_XDR] },
    ]) {
      const stats = calculateFootprintStats(footprint);
      expect(
        Object.values(stats.breakdown).every(
          (category) =>
            category.count === 0 && category.estimatedSizeBytes === 0,
        ),
      ).toBe(true);
    }
  });

  it("returns temporaryEntryCount and persistentEntryCount in FootprintStats", () => {
    const persistent = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("config"),
    ).toXDR("base64");
    const temporary = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("session"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    ).toXDR("base64");
    const stats = calculateFootprintStats({
      readOnly: [persistent],
      readWrite: [temporary],
    });
    expect(stats.persistentEntryCount).toBe(1);
    expect(stats.temporaryEntryCount).toBe(1);
    expect(stats.persistentEntrySizeBytes).toBeGreaterThan(0);
    expect(stats.temporaryEntrySizeBytes).toBeGreaterThan(0);
  });

  it("includes a persistent storage optimization hint when persistent entries are present", () => {
    const persistent = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("config"),
    ).toXDR("base64");
    const stats = calculateFootprintStats({
      readOnly: [persistent],
      readWrite: [],
    });
    expect(stats.persistentStorageOptimizationHint).toBeDefined();
    expect(stats.persistentStorageOptimizationHint).toContain(
      "temporary storage",
    );
  });

  it("omits optimization hint when no persistent entries are present", () => {
    const temporary = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("session"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    ).toXDR("base64");
    const stats = calculateFootprintStats({
      readOnly: [],
      readWrite: [temporary],
    });
    expect(stats.persistentStorageOptimizationHint).toBeUndefined();
  });

  it("correctly identifies mixed temporary and persistent storage in a contract footprint", () => {
    // Simulate a contract with both temporary (transient) and persistent (archived) keys
    const persistentConfig = contractDataKey(
      5,
      StellarSdk.xdr.ScVal.scvString("config"),
    ).toXDR("base64");
    const persistentCounter = contractDataKey(
      5,
      StellarSdk.xdr.ScVal.scvString("counter"),
    ).toXDR("base64");
    const tempSession = contractDataKey(
      5,
      StellarSdk.xdr.ScVal.scvString("session"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    ).toXDR("base64");
    const tempNonce = contractDataKey(
      5,
      StellarSdk.xdr.ScVal.scvString("nonce"),
      StellarSdk.xdr.ContractDataDurability.fromName("temporary"),
    ).toXDR("base64");

    const stats = calculateFootprintStats({
      readOnly: [persistentConfig, persistentCounter],
      readWrite: [tempSession, tempNonce],
    });

    expect(stats.persistentEntryCount).toBe(2);
    expect(stats.temporaryEntryCount).toBe(2);
    expect(stats.persistentStorageOptimizationHint).toBeDefined();
    expect(stats.breakdown.persistentData.count).toBe(2);
    expect(stats.breakdown.temporaryData.count).toBe(2);
    expect(stats.breakdown.temporaryData.readWrite).toHaveLength(2);
    expect(stats.breakdown.persistentData.readOnly).toHaveLength(2);
  });
});

// ── parseFootprint ────────────────────────────────────────────────────────────

describe("parseFootprint", () => {
  it("classifies ContractData entries correctly", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_DATA_XDR],
      readWrite: [],
    });
    expect(result.readOnly[0].type).toBe("ContractData");
    expect(result.readOnly[0].xdr).toBe(CONTRACT_DATA_XDR);
  });

  it("classifies ContractCode entries correctly", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_CODE_XDR],
      readWrite: [],
    });
    expect(result.readOnly[0].type).toBe("ContractCode");
  });

  it("classifies Account entries correctly", () => {
    const result = parseFootprint({ readOnly: [ACCOUNT_XDR], readWrite: [] });
    expect(result.readOnly[0].type).toBe("Account");
    expect(result.readOnly[0].contractId).toBeUndefined();
  });

  it("classifies TrustLine entries correctly", () => {
    const result = parseFootprint({ readOnly: [TRUSTLINE_XDR], readWrite: [] });
    expect(result.readOnly[0].type).toBe("TrustLine");
    expect(result.readOnly[0].contractId).toBeUndefined();
  });

  it("parses readWrite entries separately", () => {
    const result = parseFootprint({
      readOnly: [],
      readWrite: [CONTRACT_DATA_XDR],
    });
    expect(result.readWrite[0].type).toBe("ContractData");
  });

  it("returns Unknown type for invalid XDR", () => {
    const result = parseFootprint({
      readOnly: ["not-valid-xdr"],
      readWrite: [],
    });
    expect(result.readOnly[0].type).toBe("Unknown");
  });

  it("extracts contractId for ContractData", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_DATA_XDR],
      readWrite: [],
    });
    expect(result.readOnly[0].contractId).toBe(CONTRACT_DATA_ID);
  });

  it("extracts contractId for ContractCode", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_CODE_XDR],
      readWrite: [],
    });
    expect(result.readOnly[0].contractId).toBe(CONTRACT_CODE_ID);
  });

  it("collects unique contracts from both readOnly and readWrite", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_DATA_XDR],
      readWrite: [CONTRACT_CODE_XDR],
    });
    expect(result.contracts).toContain(CONTRACT_DATA_ID);
    expect(result.contracts).toContain(CONTRACT_CODE_ID);
    expect(result.contracts).toHaveLength(2);
  });

  it("deduplicates the same contract appearing in both arrays", () => {
    const result = parseFootprint({
      readOnly: [CONTRACT_DATA_XDR],
      readWrite: [CONTRACT_DATA_XDR],
    });
    expect(result.contracts).toHaveLength(1);
  });

  it("returns empty arrays for empty input", () => {
    const result = parseFootprint({ readOnly: [], readWrite: [] });
    expect(result.readOnly).toEqual([]);
    expect(result.readWrite).toEqual([]);
    expect(result.contracts).toEqual([]);
  });
});

// ── extractContracts ──────────────────────────────────────────────────────────

describe("extractContracts", () => {
  it("returns contract IDs from ContractData and ContractCode entries", () => {
    const ids = extractContracts([CONTRACT_DATA_XDR, CONTRACT_CODE_XDR]);
    expect(ids).toContain(CONTRACT_DATA_ID);
    expect(ids).toContain(CONTRACT_CODE_ID);
  });

  it("ignores Account and TrustLine entries", () => {
    const ids = extractContracts([ACCOUNT_XDR, TRUSTLINE_XDR]);
    expect(ids).toHaveLength(0);
  });

  it("deduplicates repeated contract IDs", () => {
    const ids = extractContracts([CONTRACT_DATA_XDR, CONTRACT_DATA_XDR]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(CONTRACT_DATA_ID);
  });

  it("returns empty array for empty input", () => {
    expect(extractContracts([])).toEqual([]);
  });

  it("skips invalid XDR without throwing", () => {
    const ids = extractContracts(["bad-xdr", CONTRACT_DATA_XDR]);
    expect(ids).toEqual([CONTRACT_DATA_ID]);
  });
});

// ── detectTokenContract ───────────────────────────────────────────────────────

describe("detectTokenContract", () => {
  const makeMockServer = (entries: unknown[]) =>
    ({
      getLedgerEntries: jest.fn().mockResolvedValue({ entries }),
    }) as unknown as StellarSdk.rpc.Server;

  it("returns 'unknown' when no ledger entry is found", async () => {
    const id = "aa".repeat(32);
    const server = makeMockServer([]);
    const result = await detectTokenContract(id, server);
    expect(result).toBe("unknown");
  });

  it("returns 'token' when WASM contains >= 6 SEP-41 function names", async () => {
    const id = "bb".repeat(32);
    const sep41Wasm = Buffer.from(
      "transfer transfer_from burn burn_from balance allowance approve decimals name symbol",
    );
    const mockEntry = {
      val: { type: "contractCode", contractCode: { code: sep41Wasm } },
    };
    const server = makeMockServer([mockEntry]);
    const result = await detectTokenContract(id, server);
    expect(result).toBe("token");
  });

  it("returns 'unknown' when WASM contains fewer than 6 SEP-41 function names", async () => {
    const id = "cc".repeat(32);
    const sparseWasm = Buffer.from("transfer balance");
    const mockEntry = {
      val: { type: "contractCode", contractCode: { code: sparseWasm } },
    };
    const server = makeMockServer([mockEntry]);
    const result = await detectTokenContract(id, server);
    expect(result).toBe("unknown");
  });

  it("returns cached result on second call without hitting the server again", async () => {
    const id = "dd".repeat(32);
    const server = makeMockServer([]);
    await detectTokenContract(id, server);
    await detectTokenContract(id, server);
    expect(server.getLedgerEntries).toHaveBeenCalledTimes(1);
  });

  it("returns 'unknown' when getLedgerEntries throws", async () => {
    const id = "ee".repeat(32);
    const server = {
      getLedgerEntries: jest.fn().mockRejectedValue(new Error("RPC error")),
    } as unknown as StellarSdk.rpc.Server;
    const result = await detectTokenContract(id, server);
    expect(result).toBe("unknown");
  });
});

// ── isSacContract ─────────────────────────────────────────────────────────────

describe("isSacContract", () => {
  it("returns false for undefined assetInfo", () => {
    expect(isSacContract("01".repeat(32), undefined)).toBe(false);
  });

  it("returns true for XLM native SAC on testnet", () => {
    const id = StellarSdk.StrKey.decodeContract(
      StellarSdk.Asset.native().contractId(StellarSdk.Networks.TESTNET),
    );
    expect(
      isSacContract(
        Buffer.from(id).toString("hex"),
        { code: "XLM" },
        StellarSdk.Networks.TESTNET,
      ),
    ).toBe(true);
  });

  it("returns false for mismatched network", () => {
    const id = StellarSdk.StrKey.decodeContract(
      StellarSdk.Asset.native().contractId(StellarSdk.Networks.TESTNET),
    );
    expect(
      isSacContract(
        Buffer.from(id).toString("hex"),
        { code: "XLM" },
        StellarSdk.Networks.PUBLIC,
      ),
    ).toBe(false);
  });

  it("returns false for invalid contract ID", () => {
    expect(isSacContract("invalid", { code: "XLM" })).toBe(false);
  });
});

// ── contract creation and constructor invocation ───────────────────────────────

describe("contract creation and constructor invocation", () => {
  it.each([false, true])(
    "derives the known contract address from deployment XDR with constructor=%s",
    (constructor) => {
      const envelope = deploymentTransaction(constructor).toXDR();
      const tx = StellarSdk.TransactionBuilder.fromXDR(
        envelope,
        StellarSdk.Networks.TESTNET,
      ) as StellarSdk.Transaction;
      const op = tx.operations[0];
      if (op.type !== "invokeHostFunction")
        throw new Error("Unexpected fixture operation");
      const invocation = parseContractInvocation(
        op.func,
        StellarSdk.Networks.TESTNET,
      );
      expect(invocation).toMatchObject({
        contractId: PREDICTED_CONTRACT,
        isContractCreation: true,
        functionName: constructor ? "__constructor" : "createContract",
      });
      expect(invocation?.args).toEqual(constructor ? ["AAAAAwAAACo="] : []);
      const instance = new StellarSdk.Contract(PREDICTED_CONTRACT)
        .getFootprint()
        .toXDR("base64");
      if (!invocation) throw new Error("Missing invocation");
      expect(hasContractCreationInstance(invocation, [instance])).toBe(true);
      expect(hasContractCreationInstance(invocation, [])).toBe(false);
    },
  );

  it("uses the network passphrase in address derivation", () => {
    const host = deploymentHostFunction(true);
    expect(
      parseContractInvocation(host, StellarSdk.Networks.PUBLIC)?.contractId,
    ).not.toBe(PREDICTED_CONTRACT);
  });

  it("handles asset contract preimages", () => {
    const host = StellarSdk.xdr.HostFunction.hostFunctionTypeCreateContract(
      new StellarSdk.xdr.CreateContractArgs({
        contractIdPreimage:
          StellarSdk.xdr.ContractIdPreimage.contractIdPreimageFromAsset(
            StellarSdk.Asset.native().toXDRObject(),
          ),
        executable:
          StellarSdk.xdr.ContractExecutable.contractExecutableStellarAsset(),
      }),
    );
    expect(
      parseContractInvocation(host, StellarSdk.Networks.TESTNET)?.contractId,
    ).toBe(StellarSdk.Asset.native().contractId(StellarSdk.Networks.TESTNET));
  });

  it("extracts ordinary initialization invocation details", () => {
    const op = new StellarSdk.Contract(PREDICTED_CONTRACT).call(
      "__constructor",
      StellarSdk.nativeToScVal(42, { type: "u32" }),
    );
    const host = op.body().invokeHostFunctionOp().hostFunction();
    expect(parseContractInvocation(host, StellarSdk.Networks.TESTNET)).toEqual({
      contractId: PREDICTED_CONTRACT,
      functionName: "__constructor",
      args: ["AAAAAwAAACo="],
    });
  });

  it("does not describe WASM uploads as contract invocations", () => {
    expect(
      parseContractInvocation(
        StellarSdk.xdr.HostFunction.hostFunctionTypeUploadContractWasm(
          Buffer.from("wasm"),
        ),
        StellarSdk.Networks.TESTNET,
      ),
    ).toBeUndefined();
  });
});
