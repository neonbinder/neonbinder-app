import { describe, expect, test } from "vitest";
import { dropTrailingMarkers } from "./print-run-markers";

describe("dropTrailingMarkers", () => {
  test.each([
    ["Old Teammates SP", "Old Teammates"],
    ["Old Teammates SSP", "Old Teammates"],
    ["Mike Trout SP /99", "Mike Trout"],
    ["Mike Trout RC SP", "Mike Trout"],
    ["Mike Trout, SP", "Mike Trout"],
    ["Ken Griffey Jr. HOF", "Ken Griffey Jr."],
  ])("%s -> %s", (raw, name) => {
    expect(dropTrailingMarkers(raw)).toBe(name);
  });

  test("a name that merely holds the letters, or has a marker first, stays", () => {
    for (const raw of ["Marcus Arcos", "Spencer Strider", "SP Hill", "Austin Riley", "Mike Trout"]) {
      expect(dropTrailingMarkers(raw)).toBe(raw);
    }
  });

  test("a name that is only a marker is kept", () => {
    expect(dropTrailingMarkers("SP")).toBe("SP");
  });
});
