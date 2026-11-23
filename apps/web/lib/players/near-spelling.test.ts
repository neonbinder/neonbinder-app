import { describe, expect, it } from "vitest";
import { boundedEditDistance, nearSpellingDistance } from "./near-spelling";

describe("boundedEditDistance", () => {
  it("counts insertions, deletions, substitutions and one swap as one edit each", () => {
    expect(boundedEditDistance("holiday", "holliday", 2)).toBe(1);
    expect(boundedEditDistance("jackson", "jakcson", 2)).toBe(1);
    expect(boundedEditDistance("merril", "merrill", 2)).toBe(1);
    expect(boundedEditDistance("abc", "xyz", 2)).toBe(3);
  });
  it("answers max + 1 for anything farther", () => {
    expect(boundedEditDistance("holiday", "holliwaye", 1)).toBe(2);
    expect(boundedEditDistance("smith", "johnson", 2)).toBe(3);
  });
});

describe("nearSpellingDistance", () => {
  it("offers a one- or two-edit misspelling of the whole name", () => {
    expect(nearSpellingDistance("Jackson Holiday", "Jackson Holliday")).toBe(1);
    expect(nearSpellingDistance("Jackson Hollday", "Jackson Holliday")).toBe(1);
    expect(nearSpellingDistance("Jackson Holiady", "Jackson Holliday")).toBe(2);
  });

  it("does not offer a name three edits away", () => {
    expect(nearSpellingDistance("Jackson Hallaway", "Jackson Holliday")).toBeNull();
    expect(nearSpellingDistance("Jaxon Holiaday", "Jackson Holliday")).toBeNull();
  });

  it("folds accents, case and punctuation like every other name match", () => {
    expect(nearSpellingDistance("jose ramirez", "José Ramírez")).toBeNull(); // the same name
    expect(nearSpellingDistance("JOSE RAMIREZZ", "José Ramírez")).toBe(1);
  });

  it("an exact fold, or the same words reordered, is an exact match and not near", () => {
    expect(nearSpellingDistance("Jackson Holliday", "jackson  holliday")).toBeNull();
    expect(nearSpellingDistance("Holliday, Jackson", "Jackson Holliday")).toBeNull();
  });

  it("reads the surname alone when the first names agree (an initial, a short form)", () => {
    expect(nearSpellingDistance("J. Holiday", "Jackson Holliday")).toBe(1);
    expect(nearSpellingDistance("Jack Hollidai", "Jackson Holliday")).toBe(1);
  });

  it("does not offer a different first name with a similar surname", () => {
    expect(nearSpellingDistance("Bob Holiday", "Jackson Holliday")).toBeNull();
  });

  it("allows nothing for a short name: two edits make 'Lee' into 'Kim'", () => {
    expect(nearSpellingDistance("Al Lee", "Al Kim")).toBeNull();
    expect(nearSpellingDistance("Bo Lee", "Bo Lea")).toBeNull();
  });
});
