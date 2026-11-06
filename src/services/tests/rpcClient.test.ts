import * as StellarSdk from "@stellar/stellar-sdk";

import * as stellarConfig from "../../config/stellar";
import { fetchTtlInfo, simulateViaRpc } from "../rpcClient";
import { parseXdr } from "../xdrParser";

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

function createSampleTx() {
  const kp = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(kp.publicKey(), "1");
  return new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: StellarSdk.Networks.TESTNET,
  })
    .addOperation(
      StellarSdk.Operation.manageData({ name: "ping", value: "pong" }),
    )
    .setTimeout(30)
    .build();
}

describe("rpcClient & xdrParser", () => {
  const mockSimulateTransaction = jest.fn();
  const mockGetLedgerEntries = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetRpcServer.mockReturnValue({
      simulateTransaction: mockSimulateTransaction,
      getLedgerEntries: mockGetLedgerEntries,
    } as unknown as StellarSdk.rpc.Server);
  });

  describe("parseXdr", () => {
    it("parses valid base64 XDR into a Stellar Transaction", () => {
      const tx = createSampleTx();
      const parsed = parseXdr(tx.toXDR(), StellarSdk.Networks.TESTNET);

      expect(parsed).toBeInstanceOf(StellarSdk.Transaction);
      expect(parsed.toXDR()).toBe(tx.toXDR());
    });

    it("throws on malformed XDR strings", () => {
      expect(() =>
        parseXdr("not-a-valid-xdr", StellarSdk.Networks.TESTNET),
      ).toThrow();
    });
  });

  describe("simulateViaRpc", () => {
    it("forwards signal without ledger option when ledgerSequence is omitted", async () => {
      const tx = createSampleTx();
      const controller = new AbortController();
      const fakeResponse = { id: "sim-1", latestLedger: 123 };
      mockSimulateTransaction.mockResolvedValue(fakeResponse);

      const res = await simulateViaRpc(tx, "testnet", controller.signal);

      expect(res).toBe(fakeResponse);
      expect(mockSimulateTransaction).toHaveBeenCalledWith(tx, {
        signal: controller.signal,
      });
    });

    it("includes ledger option when ledgerSequence is provided", async () => {
      const tx = createSampleTx();
      mockSimulateTransaction.mockResolvedValue({
        id: "sim-hist",
        latestLedger: 900,
      });

      await simulateViaRpc(tx, "mainnet", undefined, 900);

      expect(mockSimulateTransaction).toHaveBeenCalledWith(tx, {
        signal: undefined,
        ledger: 900,
      });
    });
  });

  describe("fetchTtlInfo", () => {
    it("returns an empty map immediately when footprintEntries is empty", async () => {
      const result = await fetchTtlInfo("testnet", []);

      expect(result).toEqual({});
      expect(mockedGetRpcServer).not.toHaveBeenCalled();
    });

    it("computes liveUntilLedger and expiresInLedgers for entries with TTLs", async () => {
      mockGetLedgerEntries.mockResolvedValue({
        latestLedger: 1000,
        entries: [
          { liveUntilLedgerSeq: 1250 },
          { liveUntilLedgerSeq: undefined },
        ],
      });

      const result = await fetchTtlInfo("testnet", [
        CONTRACT_DATA_XDR,
        ACCOUNT_XDR,
      ]);

      expect(mockGetLedgerEntries).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        [CONTRACT_DATA_XDR]: {
          liveUntilLedger: 1250,
          expiresInLedgers: 250,
        },
      });
    });

    it("returns an empty map when RPC getLedgerEntries or XDR decoding fails", async () => {
      mockGetLedgerEntries.mockRejectedValue(new Error("RPC unavailable"));

      const rpcFailure = await fetchTtlInfo("testnet", [CONTRACT_DATA_XDR]);
      expect(rpcFailure).toEqual({});

      const badXdrFailure = await fetchTtlInfo("testnet", ["bad-xdr"]);
      expect(badXdrFailure).toEqual({});
    });
  });
});
