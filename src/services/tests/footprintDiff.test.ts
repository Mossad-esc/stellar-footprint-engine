import * as StellarSdk from "@stellar/stellar-sdk";

import {
  contractDataKey,
  sacFootprint,
  TEST_ACCOUNT,
} from "../../tests/fixtures/footprints";
import {
  footprintDiff,
  formatDiffAsMarkdown,
  type FootprintInput,
} from "../footprintDiff";

describe("footprintDiff", () => {
  const xdrA = "AAAA1";
  const xdrB = "AAAA2";
  const xdrC = "AAAA3";
  const b64xdrA = "BBBB1";
  const b64xdrB = "BBBB2";

  it("returns added entries correctly", () => {
    const before: FootprintInput = { readOnly: [xdrA], readWrite: [] };
    const after: FootprintInput = { readOnly: [xdrA, xdrB], readWrite: [] };

    const result = footprintDiff(before, after);

    expect(result.added.readOnly).toEqual([xdrB]);
    expect(result.added.readWrite).toEqual([]);
    expect(result.removed.readOnly).toEqual([]);
    expect(result.removed.readWrite).toEqual([]);
    expect(result.unchanged.readOnly).toEqual([xdrA]);
  });

  it("returns removed entries correctly", () => {
    const before: FootprintInput = { readOnly: [xdrA, xdrB], readWrite: [] };
    const after: FootprintInput = { readOnly: [xdrA], readWrite: [] };

    const result = footprintDiff(before, after);

    expect(result.added.readOnly).toEqual([]);
    expect(result.removed.readOnly).toEqual([xdrB]);
    expect(result.unchanged.readOnly).toEqual([xdrA]);
  });

  it("returns unchanged entries correctly", () => {
    const before: FootprintInput = {
      readOnly: [xdrA, xdrB],
      readWrite: [b64xdrA],
    };
    const after: FootprintInput = {
      readOnly: [xdrA, xdrB, xdrC],
      readWrite: [b64xdrA, b64xdrB],
    };

    const result = footprintDiff(before, after);

    expect(result.added.readOnly).toEqual([xdrC]);
    expect(result.added.readWrite).toEqual([b64xdrB]);
    expect(result.removed.readOnly).toEqual([]);
    expect(result.removed.readWrite).toEqual([]);
    expect(result.unchanged.readOnly).toEqual([xdrA, xdrB]);
    expect(result.unchanged.readWrite).toEqual([b64xdrA]);
  });

  it("handles undefined footprints as empty arrays", () => {
    const result = footprintDiff({} as FootprintInput, {} as FootprintInput);

    expect(result.added.readOnly).toEqual([]);
    expect(result.added.readWrite).toEqual([]);
    expect(result.removed.readOnly).toEqual([]);
    expect(result.removed.readWrite).toEqual([]);
    expect(result.unchanged.readOnly).toEqual([]);
    expect(result.unchanged.readWrite).toEqual([]);
  });

  it("handles completely equal footprints", () => {
    const footprint: FootprintInput = {
      readOnly: [xdrA, xdrB],
      readWrite: [b64xdrA],
    };

    const result = footprintDiff(footprint, footprint);

    expect(result.added.readOnly).toEqual([]);
    expect(result.added.readWrite).toEqual([]);
    expect(result.removed.readOnly).toEqual([]);
    expect(result.removed.readWrite).toEqual([]);
    expect(result.unchanged.readOnly).toEqual([xdrA, xdrB]);
    expect(result.unchanged.readWrite).toEqual([b64xdrA]);
  });

  it("handles complete replacement of entries", () => {
    const before: FootprintInput = { readOnly: [xdrA], readWrite: [] };
    const after: FootprintInput = { readOnly: [xdrB, xdrC], readWrite: [] };

    const result = footprintDiff(before, after);

    expect(result.added.readOnly).toEqual([xdrB, xdrC]);
    expect(result.removed.readOnly).toEqual([xdrA]);
    expect(result.unchanged.readOnly).toEqual([]);
  });
});

describe("formatDiffAsMarkdown", () => {
  const contract = contractDataKey(1).toXDR("base64");
  const otherContract = contractDataKey(2).toXDR("base64");
  const account = sacFootprint(StellarSdk.Asset.native())
    .build()
    .resources()
    .footprint()
    .readWrite()[1]
    .toXDR("base64");
  const trustline = sacFootprint(new StellarSdk.Asset("USDC", TEST_ACCOUNT))
    .build()
    .resources()
    .footprint()
    .readWrite()[1]
    .toXDR("base64");

  it("renders additions and removals with contract and account identifiers", () => {
    const diff = footprintDiff(
      { readOnly: [contract], readWrite: [account] },
      { readOnly: [otherContract], readWrite: [trustline] },
    );
    expect(formatDiffAsMarkdown(diff)).toBe(
      [
        "| Change Type | Entry Type | Contract ID / Account | Access Mode |",
        "| --- | --- | --- | --- |",
        `| + | ContractData | ${StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 2))} | RO |`,
        `| + | TrustLine | ${TEST_ACCOUNT} | RW |`,
        `| - | ContractData | ${StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1))} | RO |`,
        `| - | Account | ${TEST_ACCOUNT} | RW |`,
        "",
      ].join("\n"),
    );
  });

  it.each([
    [
      { readOnly: [contract], readWrite: [] },
      { readOnly: [], readWrite: [contract] },
      "RO → RW",
    ],
    [
      { readOnly: [], readWrite: [contract] },
      { readOnly: [contract], readWrite: [] },
      "RW → RO",
    ],
  ] as const)(
    "renders access changes as a single modified row",
    (before, after, mode) => {
      const diff = footprintDiff(
        before as FootprintInput,
        after as FootprintInput,
      );
      const original = JSON.stringify(diff);
      const markdown = formatDiffAsMarkdown(diff);
      expect(markdown).toContain(
        `| modified | ContractData | ${StellarSdk.StrKey.encodeContract(Buffer.alloc(32, 1))} | ${mode} |`,
      );
      expect(markdown).not.toContain("| + |");
      expect(markdown).not.toContain("| - |");
      expect(JSON.stringify(diff)).toBe(original);
    },
  );

  it("does not include unchanged entries", () => {
    const footprint = { readOnly: [contract], readWrite: [account] };
    const markdown = formatDiffAsMarkdown(footprintDiff(footprint, footprint));
    expect(markdown).toContain("No footprint changes.");
    expect(markdown).not.toContain(TEST_ACCOUNT);
  });

  it("renders unknown keys safely and deduplicates table rows", () => {
    const unsafe = "<script>|\nnot xdr";
    const diff = footprintDiff(
      { readOnly: [], readWrite: [] },
      { readOnly: [unsafe, unsafe], readWrite: [] },
    );
    const markdown = formatDiffAsMarkdown(diff);
    expect(markdown).toContain("| + | Unknown | — | RO |");
    expect(markdown).not.toContain(unsafe);
    expect(markdown.match(/\| \+ \|/g)).toHaveLength(1);
  });
});
