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
// Generated with @stellar/stellar-sdk v15 against known byte patterns.

/** ContractData ledger key — contract address = 32 bytes of 0x01 */
const CONTRACT_DATA_XDR =
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
const CONTRACT_DATA_ID = "0".repeat(0) + "01".repeat(32); // 32 bytes of 0x01

/** ContractCode ledger key — hash = 32 bytes of 0x02 */
const CONTRACT_CODE_XDR = "AAAABwICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC";
const CONTRACT_CODE_ID = "02".repeat(32);

/** Account ledger key */
const ACCOUNT_XDR = "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==";

/** TrustLine ledger key */
const TRUSTLINE_XDR =
  "AAAAAQAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1wAAAAFVU0RDAAAAAOC5H/7peiRPvVLqr0yqYyUbiX9o1toddz1bmyboUP/X";

describe("storage breakdown", () => {
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
      StellarSdk.xdr.ContractDataDurability.temporary(),
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
    expect(stats.estimatedSizeBytes).toBe(
      [...footprint.readOnly, ...footprint.readWrite].reduce(
        (sum, key) =>
          sum + StellarSdk.xdr.LedgerKey.fromXDR(key, "base64").toXDR().length,
        0,
      ),
    );
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
      StellarSdk.xdr.ContractDataDurability.temporary(),
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
});

describe("Stellar Asset Contract metadata", () => {
  function raw(data: StellarSdk.SorobanDataBuilder) {
    const footprint = data.build().resources().footprint();
    return {
      readOnly: footprint.readOnly().map((key) => key.toXDR("base64")),
      readWrite: footprint.readWrite().map((key) => key.toXDR("base64")),
    };
  }

  it.each([
    StellarSdk.Asset.native(),
    new StellarSdk.Asset("USDC", TEST_ACCOUNT),
    new StellarSdk.Asset("LONGASSET", TEST_ACCOUNT),
  ])(
    "recognizes %s balances from real SAC and classic ledger keys",
    (asset) => {
      const footprint = raw(sacFootprint(asset));
      const result = parseFootprint(footprint);
      const assetInfo = asset.isNative()
        ? { code: "XLM" }
        : { code: asset.getCode(), issuer: TEST_ACCOUNT };
      expect(result.isSAC).toBe(true);
      expect(result.assetInfo).toEqual(assetInfo);
      expect(result.sacContracts).toEqual([
        {
          contractId: StellarSdk.StrKey.decodeContract(
            asset.contractId(StellarSdk.Networks.TESTNET),
          ).toString("hex"),
          isSAC: true,
          assetInfo,
        },
      ]);
      expect(
        [...result.readOnly, ...result.readWrite].every(
          (entry) =>
            entry.isSAC &&
            JSON.stringify(entry.assetInfo) === JSON.stringify(assetInfo),
        ),
      ).toBe(true);
      expect(result.readOnly.map((entry) => entry.xdr)).toEqual(
        footprint.readOnly,
      );
      expect(result.readWrite.map((entry) => entry.xdr)).toEqual(
        footprint.readWrite,
      );
    },
  );

  it("uses the selected network when checking asset-derived addresses", () => {
    const asset = StellarSdk.Asset.native();
    const mainnetId = asset.contractId(StellarSdk.Networks.PUBLIC);
    const footprint = {
      readOnly: [
        contractDataKey(0, undefined, undefined, mainnetId).toXDR("base64"),
      ],
      readWrite: [],
    };
    expect(parseFootprint(footprint).isSAC).toBe(false);
    expect(
      parseFootprint(footprint, StellarSdk.Networks.PUBLIC).assetInfo,
    ).toEqual({ code: "XLM" });
    expect(
      isSacContract(mainnetId, { code: "XLM" }, StellarSdk.Networks.PUBLIC),
    ).toBe(true);
    expect(isSacContract("invalid")).toBe(false);
    expect(
      isSacContract(mainnetId, { code: "OTHER" }, StellarSdk.Networks.PUBLIC),
    ).toBe(false);
  });

  it("does not label arbitrary Balance keys or standalone classic trustlines as SAC", () => {
    const key = contractDataKey(
      99,
      StellarSdk.xdr.ScVal.scvVec([StellarSdk.xdr.ScVal.scvSymbol("Balance")]),
    );
    const result = parseFootprint({
      readOnly: [key.toXDR("base64"), TRUSTLINE_XDR, ACCOUNT_XDR],
      readWrite: [],
    });
    expect(result.isSAC).toBe(false);
    expect(result.assetInfo).toBeUndefined();
    expect(result.readOnly.every((entry) => entry.isSAC === false)).toBe(true);
  });

  it("keeps metadata for every asset in a multiasset footprint", () => {
    const native = raw(sacFootprint(StellarSdk.Asset.native()));
    const credit = raw(
      sacFootprint(new StellarSdk.Asset("USDC", TEST_ACCOUNT)),
    );
    const result = parseFootprint({
      readOnly: [...native.readOnly, ...credit.readOnly],
      readWrite: [...native.readWrite, ...credit.readWrite],
    });
    expect(result.sacContracts).toHaveLength(2);
    expect(result.assetInfo).toBeUndefined();
  });

  it.each([
    new StellarSdk.Asset("USDC", TEST_ACCOUNT),
    new StellarSdk.Asset("LONGASSET", TEST_ACCOUNT),
  ])(
    "reads %s AssetInfo from the actual SAC executable without a classic trustline",
    async (asset) => {
      const footprint = raw(sacFootprint(asset));
      footprint.readWrite = footprint.readWrite.slice(0, 1);
      const initial = parseFootprint(footprint);
      expect(initial.isSAC).toBe(false);
      const instance = sacInstanceEntry(asset);
      const server = {
        getLedgerEntries: jest.fn().mockResolvedValue({
          entries: [
            { val: StellarSdk.xdr.LedgerEntryData.fromXDR(instance.toXDR()) },
          ],
        }),
      } as unknown as StellarSdk.rpc.Server;
      const sacs = await detectSacContracts(
        [...initial.readOnly, ...initial.readWrite],
        server,
        StellarSdk.Networks.TESTNET,
      );
      const parsed = parseFootprint(
        footprint,
        StellarSdk.Networks.TESTNET,
        sacs,
      );
      expect(parsed.isSAC).toBe(true);
      expect(parsed.assetInfo).toEqual({
        code: asset.getCode(),
        issuer: TEST_ACCOUNT,
      });
      expect(server.getLedgerEntries).toHaveBeenCalledWith(
        StellarSdk.xdr.LedgerKey.fromXDR(footprint.readOnly[0], "base64"),
      );
    },
  );

  it("keeps footprints usable when SAC metadata lookup fails", async () => {
    const entries = parseFootprint({
      readOnly: [CONTRACT_DATA_XDR],
      readWrite: [],
    }).readOnly;
    const server = {
      getLedgerEntries: jest.fn().mockRejectedValue(new Error("unavailable")),
    } as unknown as StellarSdk.rpc.Server;
    await expect(
      detectSacContracts(entries, server, StellarSdk.Networks.TESTNET),
    ).resolves.toEqual([]);
  });

  it("recognizes the native SAC contract type without requesting WASM", async () => {
    const server = {
      getLedgerEntries: jest.fn(),
    } as unknown as StellarSdk.rpc.Server;
    expect(
      await detectTokenContract(
        StellarSdk.Asset.native().contractId(StellarSdk.Networks.TESTNET),
        server,
      ),
    ).toBe("sac");
    expect(server.getLedgerEntries).not.toHaveBeenCalled();
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
    // Use a unique ID to avoid hitting the module-level cache
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
