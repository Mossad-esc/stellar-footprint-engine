import * as StellarSdk from "@stellar/stellar-sdk";

import { getRpcServer } from "../../config/stellar";
import {
  deploymentTransaction,
  PREDICTED_CONTRACT,
} from "../../tests/fixtures/deployment";
import { simulateTransaction } from "../simulator";

jest.mock("@config/stellar", () => ({
  getNetworkConfig: jest.fn().mockReturnValue({
    networkPassphrase: "Test SDF Network ; September 2015",
  }),
  getRpcServer: jest.fn(),
}));
jest.mock("../cache", () => ({
  buildCacheKey: jest.fn().mockReturnValue("deployment"),
  getCache: () => ({ get: jest.fn().mockResolvedValue(null), set: jest.fn() }),
}));

describe("deployment simulation", () => {
  const instance = new StellarSdk.Contract(PREDICTED_CONTRACT).getFootprint();
  const mockSimulate = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (getRpcServer as jest.Mock).mockReturnValue({
      simulateTransaction: mockSimulate,
      getLedgerEntries: jest
        .fn()
        .mockResolvedValue({ entries: [], latestLedger: 12345 }),
    });
  });
  it.each([false, true])(
    "returns the predicted contract and constructor details for constructor=%s",
    async (constructor) => {
      mockSimulate.mockResolvedValue({
        transactionData: new StellarSdk.SorobanDataBuilder().setReadWrite([
          instance,
        ]),
        minResourceFee: "100",
        latestLedger: 12345,
        events: [],
      });
      const result = await simulateTransaction(
        deploymentTransaction(constructor).toXDR(),
      );
      expect(result.success).toBe(true);
      expect(result.contractId).toBe(PREDICTED_CONTRACT);
      expect(result.invocation).toMatchObject({
        contractId: PREDICTED_CONTRACT,
        isContractCreation: true,
        functionName: constructor ? "__constructor" : "createContract",
      });
      expect(result.rawFootprint?.readWrite).toContain(
        instance.toXDR("base64"),
      );
      expect(result.footprintStats?.estimatedSizeBytes).toBe(56);
    },
  );
  it.each([{ readOnly: [] }, { readOnly: [instance] }])(
    "rejects a deployment whose instance is missing from readWrite",
    async ({ readOnly }) => {
      mockSimulate.mockResolvedValue({
        transactionData: new StellarSdk.SorobanDataBuilder().setReadOnly(
          readOnly,
        ),
        minResourceFee: "100",
        latestLedger: 12345,
        events: [],
      });
      const result = await simulateTransaction(deploymentTransaction().toXDR());
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/writable contract instance/);
    },
  );
});
