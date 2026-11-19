import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import {
  contractDataKey,
  footprintTransaction,
  TEST_ACCOUNT,
} from "../../tests/fixtures/footprints";
import {
  extractFootprint,
  extractEnvelopeFootprint,
} from "../footprintExtractor";
import * as footprintParser from "../footprintParser";

jest.mock("../../config/stellar", () => ({
  ...jest.requireActual("../../config/stellar"),
  getRpcServer: jest.fn(),
  getNetworkConfig: jest.fn((network: string) => ({
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
  })),
}));

const mockedGetRpcServer = stellarConfig.getRpcServer as jest.MockedFunction<
  typeof stellarConfig.getRpcServer
>;

const CONTRACT_DATA_XDR =
  "AAAABgAAAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQAAABQAAAAB";
const ACCOUNT_XDR = "AAAAAAAAAADguR/+6XokT71S6q9MqmMlG4l/aNbaHXc9W5sm6FD/1w==";

describe("extractFootprint", () => {
  const mockServer = {} as StellarSdk.rpc.Server;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRpcServer.mockReturnValue(mockServer);
  });

  it("throws when simulation response is missing transactionData", async () => {
    const malformedResponse = {
      id: "sim-missing",
      latestLedger: 100,
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

    await expect(
      extractFootprint(malformedResponse, "testnet"),
    ).rejects.toThrow("Simulation succeeded but transactionData is missing");
  });

  it("extracts raw/parsed footprint, optimizes duplicates, and detects contract type", async () => {
    const detectSpy = jest
      .spyOn(footprintParser, "detectTokenContract")
      .mockResolvedValue("sac");

    const contractKey = StellarSdk.xdr.LedgerKey.fromXDR(
      CONTRACT_DATA_XDR,
      "base64",
    );
    const accountKey = StellarSdk.xdr.LedgerKey.fromXDR(ACCOUNT_XDR, "base64");

    const sorobanData = new StellarSdk.SorobanDataBuilder()
      .setReadOnly([accountKey, contractKey])
      .setReadWrite([contractKey]);

    const response = {
      id: "sim-ok",
      latestLedger: 500,
      transactionData: sorobanData,
      minResourceFee: "100",
      events: [],
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

    const extracted = await extractFootprint(response, "testnet");

    expect(extracted.rawFootprint.readOnly).toEqual([
      ACCOUNT_XDR,
      CONTRACT_DATA_XDR,
    ]);
    expect(extracted.rawFootprint.readWrite).toEqual([CONTRACT_DATA_XDR]);
    expect(extracted.parsedFootprint.readOnly).toHaveLength(2);
    expect(extracted.parsedFootprint.readWrite).toHaveLength(1);
    expect(extracted.optimizationResult.optimized).toBe(true);
    expect(extracted.optimizationResult.readOnly).toHaveLength(1);
    expect(extracted.contracts).toEqual(["01".repeat(32)]);
    expect(extracted.contractType).toBe("sac");
    expect(detectSpy).toHaveBeenCalledWith(
      "01".repeat(32),
      mockServer,
      StellarSdk.Networks.TESTNET,
    );

    detectSpy.mockRestore();
  });

  it("skips token detection and returns unknown when no contract keys exist", async () => {
    const detectSpy = jest.spyOn(footprintParser, "detectTokenContract");
    const accountKey = StellarSdk.xdr.LedgerKey.fromXDR(ACCOUNT_XDR, "base64");
    const sorobanData = new StellarSdk.SorobanDataBuilder().setReadOnly([
      accountKey,
    ]);

    const response = {
      id: "sim-account-only",
      latestLedger: 500,
      transactionData: sorobanData,
      minResourceFee: "100",
      events: [],
    } as unknown as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse;

    const extracted = await extractFootprint(response, "mainnet");

    expect(extracted.contracts).toEqual([]);
    expect(extracted.contractType).toBe("unknown");
    expect(detectSpy).not.toHaveBeenCalled();

    detectSpy.mockRestore();
  });
});

describe("multi operation footprints", () => {
  beforeEach(() => {
    mockedGetRpcServer.mockReturnValue({} as StellarSdk.rpc.Server);
    jest
      .spyOn(footprintParser, "detectTokenContract")
      .mockResolvedValue("unknown");
  });
  afterEach(() => jest.restoreAllMocks());

  it.each([2, 5, 10])(
    "unions footprints for %i invocations and promotes writes",
    async (count) => {
      const shared = contractDataKey(42);
      const keys = Array.from({ length: count }, (_, i) =>
        contractDataKey(i + 1),
      );
      const responses = keys.map(
        (key, i) =>
          ({
            transactionData: new StellarSdk.SorobanDataBuilder()
              .setReadOnly([key, shared, key])
              .setReadWrite(i === count - 1 ? [shared, shared] : []),
          }) as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse,
      );
      const extracted = await extractFootprint(responses, "testnet");
      const expectedReadOnly = keys.map((key) => key.toXDR("base64"));
      expect(
        extracted.optimizationResult.readOnly.map((key) => key.xdr),
      ).toEqual(expectedReadOnly);
      expect(
        extracted.optimizationResult.readWrite.map((key) => key.xdr),
      ).toEqual([shared.toXDR("base64")]);
      expect(extracted.optimizationResult.optimized).toBe(true);

      const data = new StellarSdk.SorobanDataBuilder()
        .setReadOnly([...keys].reverse().concat([shared]))
        .setReadWrite([shared]);
      const tx = footprintTransaction(count, data, true);
      // Round trip the real XDR envelope, including Payment and ChangeTrust.
      const envelope = StellarSdk.xdr.TransactionEnvelope.fromXDR(
        tx.toXDR(),
        "base64",
      );
      expect(extractEnvelopeFootprint(envelope)).toEqual({
        readOnly: expectedReadOnly,
        readWrite: [shared.toXDR("base64")],
      });
      expect(
        (await extractFootprint([...responses].reverse(), "testnet"))
          .optimizationResult,
      ).toEqual(extracted.optimizationResult);
    },
  );

  it("sorts by bytes rather than base64 text", () => {
    const keys = [
      contractDataKey(208),
      contractDataKey(1),
      contractDataKey(255),
    ];
    const data = new StellarSdk.SorobanDataBuilder().setReadOnly(keys);
    const result = extractEnvelopeFootprint(
      footprintTransaction(2, data).toEnvelope(),
    );
    expect(result.readOnly).toEqual(
      [keys[1], keys[0], keys[2]].map((key) => key.toXDR("base64")),
    );
    expect(result.readOnly).not.toEqual([...result.readOnly].sort());
  });

  it("uses the inner shared footprint for fee bumps", () => {
    const data = new StellarSdk.SorobanDataBuilder().setReadWrite([
      contractDataKey(1),
    ]);
    const inner = footprintTransaction(5, data);
    const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      TEST_ACCOUNT,
      "100",
      inner,
      StellarSdk.Networks.TESTNET,
    );
    expect(extractEnvelopeFootprint(feeBump.toEnvelope())).toEqual(
      extractEnvelopeFootprint(inner.toEnvelope()),
    );
  });

  it("returns an empty footprint without Soroban transaction data", () => {
    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(TEST_ACCOUNT, "0"),
      {
        fee: "100",
        networkPassphrase: StellarSdk.Networks.TESTNET,
      },
    )
      .addOperation(
        StellarSdk.Operation.payment({
          destination: TEST_ACCOUNT,
          asset: StellarSdk.Asset.native(),
          amount: "1",
        }),
      )
      .setTimeout(0)
      .build();
    expect(extractEnvelopeFootprint(tx.toEnvelope())).toEqual({
      readOnly: [],
      readWrite: [],
    });
  });

  it("rejects a missing footprint among multiple responses", async () => {
    await expect(
      extractFootprint(
        [
          { transactionData: new StellarSdk.SorobanDataBuilder() },
          {},
        ] as StellarSdk.rpc.Api.SimulateTransactionSuccessResponse[],
        "testnet",
      ),
    ).rejects.toThrow(/transactionData is missing/);
  });
});
