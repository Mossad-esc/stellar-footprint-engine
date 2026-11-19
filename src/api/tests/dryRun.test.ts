import * as StellarSdk from "@stellar/stellar-sdk";
import request from "supertest";

import * as stellarConfig from "../../config/stellar";
import app from "../../index";
import { SOROBAN_INVOKE_XDR } from "../../tests/fixtures/xdr";

beforeEach(() => {
  jest.spyOn(stellarConfig, "getRpcServer").mockImplementation(() => {
    throw new Error("Dry run must not create an RPC server");
  });
});
afterEach(() => jest.restoreAllMocks());

describe("POST /api/v1/simulate/dry-run", () => {
  it("returns invocation arguments and interface estimates without RPC configuration", async () => {
    const from = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
    const to = StellarSdk.Keypair.fromRawEd25519Seed(Buffer.alloc(32, 2));
    const contract = StellarSdk.Address.contract(
      Buffer.alloc(32, 3),
    ).toString();
    const tx = new StellarSdk.TransactionBuilder(
      new StellarSdk.Account(from.publicKey(), "1"),
      { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
    )
      .addOperation(
        StellarSdk.Operation.invokeContractFunction({
          contract,
          function: "transfer",
          args: [
            new StellarSdk.Address(from.publicKey()).toScVal(),
            new StellarSdk.Address(to.publicKey()).toScVal(),
            StellarSdk.nativeToScVal(123456789012345678901234567890n, {
              type: "i128",
            }),
          ],
        }),
      )
      .setTimeout(0)
      .build();
    const response = await request(app)
      .post("/api/v1/simulate/dry-run")
      .send({ xdr: tx.toXDR() });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      dryRun: true,
      network: "testnet",
      sourceAccount: from.publicKey(),
      sequence: "2",
      operationCount: 1,
      operations: [
        {
          type: "invokeHostFunction",
          invocation: {
            contractId: contract,
            functionName: "transfer",
            args: [
              from.publicKey(),
              to.publicKey(),
              "123456789012345678901234567890",
            ],
            argTypes: ["scvAddress", "scvAddress", "scvI128"],
            interfaceEstimation: { name: "SEP-41" },
          },
          authEntries: [],
          requiredSigners: [],
        },
      ],
    });
    expect(stellarConfig.getRpcServer).not.toHaveBeenCalled();
  });
  it.each([
    {},
    { xdr: "AAAAAA==" },
    { xdr: SOROBAN_INVOKE_XDR, network: "invalid" },
  ])("rejects invalid input with HTTP 400", async (body) => {
    const response = await request(app)
      .post("/api/v1/simulate/dry-run")
      .send(body);
    expect(response.status).toBe(400);
    expect(stellarConfig.getRpcServer).not.toHaveBeenCalled();
  });
});
