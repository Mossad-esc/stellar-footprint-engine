import * as StellarSdk from "@stellar/stellar-sdk";

import {
  parseFootprint,
  extractContracts,
  detectTokenContract,
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

describe("protocol ledger key compatibility", () => {
  // Stable wire fixtures: protocols 20, 21, and 22 use the same key union.
  it.each([
    [20, "ContractData", CONTRACT_DATA_XDR],
    [20, "ContractCode", CONTRACT_CODE_XDR],
    [20, "ConfigSetting", "AAAACAAAAAo="], // state archival settings
    [20, "Ttl", "AAAACQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC"],
    [21, "ContractCode", CONTRACT_CODE_XDR],
    [21, "ConfigSetting", "AAAACAAAAAY="], // CPU cost parameters
    [22, "ContractData", CONTRACT_DATA_XDR],
    [22, "ConfigSetting", "AAAACAAAAAc="], // memory cost parameters
    [22, "Ttl", "AAAACQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC"],
    [23, "ConfigSetting", "AAAACAAAAA4="], // parallel compute settings
  ])(
    "parses protocol %i %s keys without changing their raw bytes",
    (_protocol, type, raw) => {
      expect(
        parseFootprint({ readOnly: [raw], readWrite: [] }).readOnly[0],
      ).toMatchObject({ type, xdr: raw });
    },
  );

  it("covers every active ledger entry variant", () => {
    const keyBytes = (arm: number, rest: Buffer) => {
      const prefix = Buffer.alloc(4);
      prefix.writeInt32BE(arm);
      return Buffer.concat([prefix, rest]).toString("base64");
    };
    const account = Buffer.from(ACCOUNT_XDR, "base64").subarray(4);
    const fixtures = [
      ACCOUNT_XDR,
      TRUSTLINE_XDR,
      keyBytes(2, Buffer.concat([account, Buffer.alloc(8)])),
      keyBytes(3, Buffer.concat([account, Buffer.alloc(4)])),
      keyBytes(4, Buffer.alloc(36)),
      keyBytes(5, Buffer.alloc(32)),
      CONTRACT_DATA_XDR,
      CONTRACT_CODE_XDR,
      "AAAACAAAAAo=",
      "AAAACQICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIC",
    ];
    expect(
      parseFootprint({ readOnly: fixtures, readWrite: [] }).readOnly.map(
        (entry) => entry.type,
      ),
    ).toEqual([
      "Account",
      "TrustLine",
      "Offer",
      "Data",
      "ClaimableBalance",
      "LiquidityPool",
      "ContractData",
      "ContractCode",
      "ConfigSetting",
      "Ttl",
    ]);
  });

  it("preserves an unknown future arm and continues parsing other keys", () => {
    const future = "AAAAf2Z1dHVyZS1hcm0=";
    const result = parseFootprint({
      readOnly: [future, CONTRACT_CODE_XDR],
      readWrite: [future],
    });
    expect(result.readOnly[0]).toEqual({ type: "Unknown", xdr: future });
    expect(result.readWrite[0]).toEqual({ type: "Unknown", xdr: future });
    expect(result.readOnly[1].type).toBe("ContractCode");
    expect(result.contracts).toEqual([CONTRACT_CODE_ID]);
  });
});
