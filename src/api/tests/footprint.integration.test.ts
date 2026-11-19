import * as StellarSdk from "@stellar/stellar-sdk";
import express from "express";
import request from "supertest";

import { clearRpcPool } from "../../config/stellar";
import {
  contractDataKey,
  footprintTransaction,
  sacFootprint,
} from "../../tests/fixtures/footprints";
import {
  startMockRpcServer,
  type MockRpcServerInstance,
} from "../../tests/mocks/rpcServer";
import { simulate, footprintDiffController } from "../controllers";

describe("footprint endpoints", () => {
  const app = express();
  app.use(express.json());
  app.post("/simulate", simulate);
  app.post("/footprint/diff", footprintDiffController);
  let rpc: MockRpcServerInstance;
  const previousUrl = process.env.TESTNET_RPC_URL;
  const previousAllowHttp = process.env.ALLOW_HTTP;

  beforeAll(async () => {
    rpc = await startMockRpcServer();
    process.env.TESTNET_RPC_URL = rpc.url;
    process.env.ALLOW_HTTP = "true";
    clearRpcPool();
  });

  afterAll(async () => {
    await rpc.stop();
    if (previousUrl === undefined) delete process.env.TESTNET_RPC_URL;
    else process.env.TESTNET_RPC_URL = previousUrl;
    if (previousAllowHttp === undefined) delete process.env.ALLOW_HTTP;
    else process.env.ALLOW_HTTP = previousAllowHttp;
    clearRpcPool();
  });

  it("returns storage breakdown and keeps the existing footprint and raw arrays", async () => {
    const code = StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash: Buffer.alloc(32, 2) }),
    );
    const instance = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    );
    const persistent = contractDataKey(1);
    const temporary = contractDataKey(
      1,
      StellarSdk.xdr.ScVal.scvString("session"),
      StellarSdk.xdr.ContractDataDurability.temporary(),
    );
    const data = new StellarSdk.SorobanDataBuilder()
      .setReadOnly([code, instance])
      .setReadWrite([persistent, temporary]);
    rpc.configure({ transactionData: data.build().toXDR("base64") });
    const response = await request(app)
      .post("/simulate")
      .send({
        xdr: footprintTransaction(2, data, true).toXDR(),
        network: "testnet",
      });
    expect(response.status).toBe(200);
    expect(response.body.rawFootprint).toEqual({
      readOnly: [code, instance].map((key) => key.toXDR("base64")),
      readWrite: [persistent, temporary].map((key) => key.toXDR("base64")),
    });
    expect(
      response.body.footprint.readOnly.map(
        (entry: { xdr: string }) => entry.xdr,
      ),
    ).toEqual([instance, code].map((key) => key.toXDR("base64")));
    expect(
      response.body.footprint.readWrite.map(
        (entry: { xdr: string }) => entry.xdr,
      ),
    ).toEqual([temporary, persistent].map((key) => key.toXDR("base64")));
    expect(response.body.footprint.breakdown).toEqual(
      response.body.footprintStats.breakdown,
    );
    for (const [category, key] of [
      ["contractCode", code],
      ["contractInstance", instance],
      ["persistentData", persistent],
      ["temporaryData", temporary],
    ] as const) {
      expect(response.body.footprint.breakdown[category]).toMatchObject({
        count: 1,
        estimatedSizeBytes: key.toXDR().length,
      });
    }
  });

  it("exposes native SAC metadata in the HTTP simulation response", async () => {
    const data = sacFootprint(StellarSdk.Asset.native());
    rpc.configure({ transactionData: data.build().toXDR("base64") });
    const response = await request(app)
      .post("/simulate")
      .send({ xdr: footprintTransaction(1, data).toXDR() });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      contractType: "sac",
      isSAC: true,
      assetInfo: { code: "XLM" },
      footprintStats: { isSAC: true, assetInfo: { code: "XLM" } },
    });
  });

  it("returns Markdown on request with the correct content type", async () => {
    const key = contractDataKey(1).toXDR("base64");
    const response = await request(app)
      .post("/footprint/diff?format=markdown")
      .send({
        before: { readOnly: [key], readWrite: [] },
        after: { readOnly: [], readWrite: [key] },
      });
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(
      /^text\/markdown; charset=utf-8$/,
    );
    expect(response.text).toContain(
      "| Change Type | Entry Type | Contract ID / Account | Access Mode |",
    );
    expect(response.text).toContain("| modified | ContractData |");
    expect(response.text).toContain("RO → RW");
  });

  it("preserves the exact default JSON response", async () => {
    const key = contractDataKey(1).toXDR("base64");
    const body = {
      before: { readOnly: [key], readWrite: [] },
      after: { readOnly: [], readWrite: [key] },
    };
    const response = await request(app).post("/footprint/diff").send(body);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^application\/json/);
    expect(response.body).toEqual({
      success: true,
      data: {
        added: { readOnly: [], readWrite: [key] },
        removed: { readOnly: [key], readWrite: [] },
        unchanged: { readOnly: [], readWrite: [] },
      },
    });
  });
});
