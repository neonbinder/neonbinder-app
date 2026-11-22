/**
 * NEO-645 — the autograph helpers moved out of entity-review-steps.ts. The old
 * module re-exports them, so CardChecklist and the review steps keep working.
 */
import { describe, expect, it } from "vitest";
import * as moved from "./autograph-format";
import * as legacy from "./entity-review-steps";

describe("autograph-format", () => {
  it("entity-review-steps re-exports the very same helpers", () => {
    expect(legacy.AUTOGRAPH_FORMATS).toBe(moved.AUTOGRAPH_FORMATS);
    expect(legacy.AUTOGRAPH_CHOICE_LABEL).toBe(moved.AUTOGRAPH_CHOICE_LABEL);
    expect(legacy.asAutographFormat).toBe(moved.asAutographFormat);
    expect(legacy.carriesAutograph).toBe(moved.carriesAutograph);
    expect(legacy.autographCardIndexes).toBe(moved.autographCardIndexes);
  });

  it("reads an autograph token and a stored format", () => {
    expect(moved.carriesAutograph(["RC", "AU"])).toBe(true);
    expect(moved.carriesAutograph(["RC"])).toBe(false);
    expect(moved.asAutographFormat("On Card")).toBe("On Card");
    expect(moved.asAutographFormat("Sticker/Label")).toBe("Sticker/Label");
    expect(moved.asAutographFormat("None")).toBeUndefined();
    expect(moved.AUTOGRAPH_CHOICE_LABEL["On Card"]).toBe("On card");
  });
});
