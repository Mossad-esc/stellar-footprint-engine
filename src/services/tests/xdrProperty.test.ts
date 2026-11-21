import * as StellarSdk from "@stellar/stellar-sdk";
import * as fc from "fast-check";

import { decodeXdr } from "../decoder";
import type { FootprintEntry } from "../footprintParser";
import { optimizeFootprint } from "../optimizer";

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbBytes32 = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((arr) =>
  Buffer.from(arr),
);

const arbPublicKey = arbBytes32.map((buf) =>
  StellarSdk.StrKey.encodeEd25519PublicKey(buf),
);

const arbContractId = arbBytes32.map((buf) =>
  StellarSdk.StrKey.encodeContract(buf),
);

const arbScAddress: fc.Arbitrary<StellarSdk.xdr.ScAddress> = fc.oneof(
  arbPublicKey.map((pk) => StellarSdk.Address.fromString(pk).toScAddress()),
  arbContractId.map((cid) => StellarSdk.Address.fromString(cid).toScAddress()),
);

const arbAssetCode = fc.stringMatching(/^[A-Za-z0-9]{1,12}$/);

const arbAsset: fc.Arbitrary<StellarSdk.Asset> = fc.oneof(
  fc.constant(StellarSdk.Asset.native()),
  fc
    .tuple(arbAssetCode, arbPublicKey)
    .map(([code, issuer]) => new StellarSdk.Asset(code, issuer)),
);

const arbTrustLineAsset: fc.Arbitrary<StellarSdk.xdr.TrustLineAsset> =
  arbAsset.map((asset) => asset.toTrustLineXDRObject());

const arbScValPrimitive: fc.Arbitrary<StellarSdk.xdr.ScVal> = fc.oneof(
  fc.boolean().map((b) => StellarSdk.xdr.ScVal.scvBool(b)),
  fc.constant(StellarSdk.xdr.ScVal.scvVoid()),
  fc
    .integer({ min: 0, max: 0xffffffff })
    .map((n) => StellarSdk.xdr.ScVal.scvU32(n)),
  fc
    .integer({ min: -0x80000000, max: 0x7fffffff })
    .map((n) => StellarSdk.xdr.ScVal.scvI32(n)),
  fc
    .bigInt({ min: 0n, max: 0xffffffffffffffffn })
    .map((n) => StellarSdk.xdr.ScVal.scvU64(StellarSdk.xdr.Uint64.fromString(n.toString()))),
  fc
    .bigInt({ min: -0x8000000000000000n, max: 0x7fffffffffffffffn })
    .map((n) => StellarSdk.xdr.ScVal.scvI64(StellarSdk.xdr.Int64.fromString(n.toString()))),
  fc
    .stringMatching(/^[a-zA-Z0-9_]{1,16}$/)
    .map((s) => StellarSdk.xdr.ScVal.scvSymbol(s)),
  fc
    .string({ minLength: 0, maxLength: 32 })
    .map((s) => StellarSdk.xdr.ScVal.scvString(s)),
  fc
    .uint8Array({ minLength: 0, maxLength: 32 })
    .map((arr) => StellarSdk.xdr.ScVal.scvBytes(Buffer.from(arr))),
);

const arbScVal: fc.Arbitrary<StellarSdk.xdr.ScVal> = fc.oneof(
  arbScValPrimitive,
  fc
    .array(arbScValPrimitive, { minLength: 0, maxLength: 5 })
    .map((items) => StellarSdk.xdr.ScVal.scvVec(items)),
  fc
    .array(fc.tuple(arbScValPrimitive, arbScValPrimitive), {
      minLength: 0,
      maxLength: 4,
    })
    .map((pairs) =>
      StellarSdk.xdr.ScVal.scvMap(
        pairs.map(([key, val]) => new StellarSdk.xdr.ScMapEntry({ key, val })),
      ),
    ),
);

const arbDurability: fc.Arbitrary<StellarSdk.xdr.ContractDataDurability> =
  fc.constantFrom(
    StellarSdk.xdr.ContractDataDurability.temporary(),
    StellarSdk.xdr.ContractDataDurability.persistent(),
  );

const arbLedgerKey: fc.Arbitrary<StellarSdk.xdr.LedgerKey> = fc.oneof(
  arbPublicKey.map((pk) =>
    StellarSdk.xdr.LedgerKey.account(
      new StellarSdk.xdr.LedgerKeyAccount({
        accountId: StellarSdk.Keypair.fromPublicKey(pk).xdrAccountId(),
      }),
    ),
  ),
  fc.tuple(arbPublicKey, arbTrustLineAsset).map(([pk, asset]) =>
    StellarSdk.xdr.LedgerKey.trustline(
      new StellarSdk.xdr.LedgerKeyTrustLine({
        accountId: StellarSdk.Keypair.fromPublicKey(pk).xdrAccountId(),
        asset,
      }),
    ),
  ),
  fc
    .tuple(arbPublicKey, fc.stringMatching(/^[a-zA-Z0-9_]{1,32}$/))
    .map(([pk, dataName]) =>
      StellarSdk.xdr.LedgerKey.data(
        new StellarSdk.xdr.LedgerKeyData({
          accountId: StellarSdk.Keypair.fromPublicKey(pk).xdrAccountId(),
          dataName,
        }),
      ),
    ),
  fc
    .tuple(arbScAddress, arbScValPrimitive, arbDurability)
    .map(([contract, key, durability]) =>
      StellarSdk.xdr.LedgerKey.contractData(
        new StellarSdk.xdr.LedgerKeyContractData({
          contract,
          key,
          durability,
        }),
      ),
    ),
  arbBytes32.map((hash) =>
    StellarSdk.xdr.LedgerKey.contractCode(
      new StellarSdk.xdr.LedgerKeyContractCode({ hash }),
    ),
  ),
  arbBytes32.map((keyHash) =>
    StellarSdk.xdr.LedgerKey.ttl(
      new StellarSdk.xdr.LedgerKeyTtl({ keyHash }),
    ),
  ),
);

const arbAmount = fc
  .integer({ min: 1, max: 1_000_000 })
  .map((n) => `${n}.0000000`);

const arbOperation: fc.Arbitrary<StellarSdk.xdr.Operation> = fc.oneof(
  fc
    .tuple(arbPublicKey, arbAsset, arbAmount, fc.option(arbPublicKey))
    .map(([destination, asset, amount, source]) =>
      StellarSdk.Operation.payment({
        destination,
        asset,
        amount,
        ...(source ? { source } : {}),
      }),
    ),
  fc
    .tuple(arbPublicKey, arbAmount, fc.option(arbPublicKey))
    .map(([destination, startingBalance, source]) =>
      StellarSdk.Operation.createAccount({
        destination,
        startingBalance,
        ...(source ? { source } : {}),
      }),
    ),
  fc
    .tuple(
      fc.stringMatching(/^[a-zA-Z0-9_]{1,32}$/),
      fc.option(fc.string({ minLength: 1, maxLength: 32 })),
    )
    .map(([name, value]) =>
      StellarSdk.Operation.manageData({
        name,
        value: value ?? null,
      }),
    ),
);

function shuffleWithOrder<T>(items: T[], weights: number[]): T[] {
  return items
    .map((item, idx) => ({ item, weight: weights[idx] ?? 0 }))
    .sort((a, b) => a.weight - b.weight)
    .map(({ item }) => item);
}

// ── Property Tests ───────────────────────────────────────────────────────────

describe("XDR serialization and optimizer property-based tests", () => {
  it("LedgerKey: decode(encode(arbitraryKey)) === arbitraryKey", () => {
    fc.assert(
      fc.property(arbLedgerKey, (key) => {
        const encoded = key.toXDR("base64");
        const decodedKey = StellarSdk.xdr.LedgerKey.fromXDR(encoded, "base64");

        expect(decodedKey.toXDR("base64")).toBe(encoded);
        expect(decodedKey.switch().name).toBe(key.switch().name);

        const decodedResult = decodeXdr(encoded, "ledger_key");
        expect(decodedResult.success).toBe(true);
        expect(decodedResult.type).toBe("ledger_key");
        expect(decodedResult.decoded).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("ScVal: decode(encode(arbitraryScVal)) === arbitraryScVal", () => {
    fc.assert(
      fc.property(arbScVal, (val) => {
        const encoded = val.toXDR("base64");
        const decodedVal = StellarSdk.xdr.ScVal.fromXDR(encoded, "base64");

        expect(decodedVal.toXDR("base64")).toBe(encoded);
        expect(decodedVal.switch().name).toBe(val.switch().name);
      }),
      { numRuns: 100 },
    );
  });

  it("Operation: decode(encode(arbitraryOperation)) === arbitraryOperation", () => {
    fc.assert(
      fc.property(arbOperation, (op) => {
        const encoded = op.toXDR("base64");
        const decodedOp = StellarSdk.xdr.Operation.fromXDR(encoded, "base64");

        expect(decodedOp.toXDR("base64")).toBe(encoded);

        const decodedResult = decodeXdr(encoded, "operation");
        expect(decodedResult.success).toBe(true);
        expect(decodedResult.type).toBe("operation");
        expect(decodedResult.decoded).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("Footprint optimizer never deletes read-write keys under any random key permutation", () => {
    fc.assert(
      fc.property(
        fc.array(arbLedgerKey, { minLength: 0, maxLength: 10 }),
        fc.array(arbLedgerKey, { minLength: 0, maxLength: 10 }),
        fc.array(fc.integer(), { minLength: 10, maxLength: 10 }),
        (readOnlyKeys, readWriteKeys, permWeights) => {
          const toEntry = (k: StellarSdk.xdr.LedgerKey): FootprintEntry => ({
            xdr: k.toXDR("base64"),
            type: "Unknown",
          });

          const readOnlyEntries = readOnlyKeys.map(toEntry);
          const permutedReadWrite = shuffleWithOrder(
            readWriteKeys.map(toEntry),
            permWeights,
          );

          const result = optimizeFootprint(readOnlyEntries, permutedReadWrite);

          // Invariant 1: Every read-write key is preserved in exact count and order
          expect(result.readWrite).toHaveLength(permutedReadWrite.length);
          expect(result.readWrite.map((e) => e.xdr)).toEqual(
            permutedReadWrite.map((e) => e.xdr),
          );

          // Invariant 2: rawFootprint preserves original inputs
          expect(result.rawFootprint.readWrite).toEqual(permutedReadWrite);
          expect(result.rawFootprint.readOnly).toEqual(readOnlyEntries);

          // Invariant 3: No key present in readWrite remains in optimized readOnly
          const rwXdrSet = new Set(permutedReadWrite.map((e) => e.xdr));
          for (const ro of result.readOnly) {
            expect(rwXdrSet.has(ro.xdr)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
