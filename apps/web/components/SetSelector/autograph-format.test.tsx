/** NEO-645 — the autograph helpers the checklist, the prompt and the Autograph tile share. */
import { describe, expect, it } from "vitest";
import * as moved from "./autograph-format";

describe("autograph-format", () => {
  it("reads an autograph token and a stored format", () => {
    expect(moved.carriesAutograph(["RC", "AU"])).toBe(true);
    expect(moved.carriesAutograph(["RC"])).toBe(false);
    expect(moved.asAutographFormat("On Card")).toBe("On Card");
    expect(moved.asAutographFormat("Sticker/Label")).toBe("Sticker/Label");
    expect(moved.asAutographFormat("None")).toBeUndefined();
    expect(moved.AUTOGRAPH_CHOICE_LABEL["On Card"]).toBe("On card");
  });
});
