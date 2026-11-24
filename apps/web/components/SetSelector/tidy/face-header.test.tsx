import { describe, expect, it } from "vitest";
import { faceHeaderFromChain } from "./face-header";

const base = [
  { level: "sport", value: "Baseball" },
  { level: "year", value: "2024" },
  { level: "manufacturer", value: "Topps" },
  { level: "setName", value: "Chrome" },
];

describe("faceHeaderFromChain", () => {
  it("reads the set and season from their own levels, not the leaf", () => {
    const h = faceHeaderFromChain([...base, { level: "variantType", value: "Base" }]);
    expect(h).toEqual({ setName: "Chrome", season: "2024", variantName: null, variantKind: "base" });
  });

  it("names an insert by its own title", () => {
    const h = faceHeaderFromChain([
      ...base,
      { level: "variantType", value: "Inserts" },
      { level: "insert", value: "Image Variation" },
    ]);
    expect(h.variantKind).toBe("insert");
    expect(h.variantName).toBe("Image Variation");
  });

  it("reads a row under a Parallels type, and a sub-variant, as parallels", () => {
    expect(
      faceHeaderFromChain([
        ...base,
        { level: "variantType", value: "Parallels" },
        { level: "insert", value: "Gold" },
      ]).variantKind,
    ).toBe("parallel");
    expect(
      faceHeaderFromChain([
        ...base,
        { level: "variantType", value: "Inserts" },
        { level: "insert", value: "Stars" },
        { level: "parallel", value: "Gold" },
      ]).variantKind,
    ).toBe("parallel");
  });

  it("is empty-handed with no chain yet", () => {
    expect(faceHeaderFromChain(undefined)).toEqual({
      setName: "",
      season: "",
      variantName: null,
      variantKind: "other",
    });
  });
});
