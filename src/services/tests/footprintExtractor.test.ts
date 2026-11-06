import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import { extractFootprint } from "../footprintExtractor";
import * as footprintParser from "../footprintParser";

jest.mock("../../config/stellar", () => ({
  ...jest.requireActual("../../config/stellar"),
  getRpcServer: jest.fn(),
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
    expect(detectSpy).toHaveBeenCalledWith("01".repeat(32), mockServer);

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
