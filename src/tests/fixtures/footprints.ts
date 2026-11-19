import * as StellarSdk from "@stellar/stellar-sdk";

export const TEST_ACCOUNT = StellarSdk.Keypair.fromRawEd25519Seed(
  Buffer.alloc(32, 7),
).publicKey();

export function sacFootprint(
  asset: StellarSdk.Asset,
): StellarSdk.SorobanDataBuilder {
  const contractId = asset.contractId(StellarSdk.Networks.TESTNET);
  const instance = contractDataKey(
    0,
    StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
    undefined,
    contractId,
  );
  const balance = contractDataKey(
    0,
    StellarSdk.xdr.ScVal.scvVec([
      StellarSdk.xdr.ScVal.scvSymbol("Balance"),
      StellarSdk.xdr.ScVal.scvAddress(
        StellarSdk.Address.fromString(
          StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 77)),
        ).toScAddress(),
      ),
    ]),
    undefined,
    contractId,
  );
  const accountId = StellarSdk.xdr.PublicKey.publicKeyTypeEd25519(
    StellarSdk.StrKey.decodeEd25519PublicKey(TEST_ACCOUNT),
  );
  const classicBalance = asset.isNative()
    ? StellarSdk.xdr.LedgerKey.account(
        new StellarSdk.xdr.LedgerKeyAccount({ accountId }),
      )
    : StellarSdk.xdr.LedgerKey.trustline(
        new StellarSdk.xdr.LedgerKeyTrustLine({
          accountId,
          asset: asset.toTrustLineXDRObject(),
        }),
      );
  return new StellarSdk.SorobanDataBuilder()
    .setReadOnly([instance])
    .setReadWrite([balance, classicBalance]);
}

export function sacInstanceEntry(
  asset: StellarSdk.Asset,
): StellarSdk.xdr.LedgerEntryData {
  const assetInfo = asset.isNative()
    ? StellarSdk.xdr.ScVal.scvVec([StellarSdk.xdr.ScVal.scvSymbol("Native")])
    : StellarSdk.xdr.ScVal.scvVec([
        StellarSdk.xdr.ScVal.scvSymbol(
          asset.getCode().length <= 4 ? "AlphaNum4" : "AlphaNum12",
        ),
        StellarSdk.xdr.ScVal.scvMap([
          new StellarSdk.xdr.ScMapEntry({
            key: StellarSdk.xdr.ScVal.scvSymbol("asset_code"),
            val: StellarSdk.xdr.ScVal.scvString(asset.getCode()),
          }),
          new StellarSdk.xdr.ScMapEntry({
            key: StellarSdk.xdr.ScVal.scvSymbol("issuer"),
            val: StellarSdk.xdr.ScVal.scvBytes(
              StellarSdk.StrKey.decodeEd25519PublicKey(asset.getIssuer()),
            ),
          }),
        ]),
      ]);
  return StellarSdk.xdr.LedgerEntryData.contractData(
    new StellarSdk.xdr.ContractDataEntry({
      ext: new StellarSdk.xdr.ExtensionPoint(0),
      contract: StellarSdk.Address.fromString(
        asset.contractId(StellarSdk.Networks.TESTNET),
      ).toScAddress(),
      key: StellarSdk.xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: StellarSdk.xdr.ContractDataDurability.persistent(),
      val: StellarSdk.xdr.ScVal.scvContractInstance(
        new StellarSdk.xdr.ScContractInstance({
          executable:
            StellarSdk.xdr.ContractExecutable.contractExecutableStellarAsset(),
          storage: [
            new StellarSdk.xdr.ScMapEntry({
              key: StellarSdk.xdr.ScVal.scvVec([
                StellarSdk.xdr.ScVal.scvSymbol("AssetInfo"),
              ]),
              val: assetInfo,
            }),
          ],
        }),
      ),
    }),
  );
}

export function contractDataKey(
  id: number,
  key: StellarSdk.xdr.ScVal = StellarSdk.xdr.ScVal.scvSymbol("value"),
  durability = StellarSdk.xdr.ContractDataDurability.persistent(),
  contractId = StellarSdk.StrKey.encodeContract(Buffer.alloc(32, id)),
): StellarSdk.xdr.LedgerKey {
  return StellarSdk.xdr.LedgerKey.contractData(
    new StellarSdk.xdr.LedgerKeyContractData({
      contract: StellarSdk.Address.fromString(contractId).toScAddress(),
      key,
      durability,
    }),
  );
}

export function footprintTransaction(
  operationCount: number,
  footprint: StellarSdk.SorobanDataBuilder,
  mixed = false,
): StellarSdk.Transaction {
  const builder = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(TEST_ACCOUNT, "0"),
    { fee: "100", networkPassphrase: StellarSdk.Networks.TESTNET },
  );
  if (mixed) {
    builder.addOperation(
      StellarSdk.Operation.payment({
        destination: TEST_ACCOUNT,
        asset: StellarSdk.Asset.native(),
        amount: "1",
      }),
    );
    builder.addOperation(
      StellarSdk.Operation.changeTrust({
        asset: new StellarSdk.Asset("USDC", TEST_ACCOUNT),
      }),
    );
  }
  for (let i = 0; i < operationCount; i++) {
    builder.addOperation(
      new StellarSdk.Contract(
        StellarSdk.StrKey.encodeContract(Buffer.alloc(32, i + 1)),
      ).call("test"),
    );
  }
  return builder.setSorobanData(footprint.build()).setTimeout(0).build();
}
