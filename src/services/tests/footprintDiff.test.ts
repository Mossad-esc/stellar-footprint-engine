import { footprintDiff, type FootprintInput } from "../footprintDiff";

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
