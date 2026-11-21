import { describe, expect, test } from "vitest";
import { findChoice, pickChoices, pickRadioOptions } from "./pick-options";

describe("pickChoices", () => {
  test("one pill per distinct value, in source order, any number of sources", () => {
    const choices = pickChoices([
      { source: "bsc", value: "Dax Kilby" },
      { source: "sportlots", value: "Dax Kilbey" },
      { source: "checklist", value: "Max Kilby", own: true },
      { source: "checklist-2", value: "Mac Kilby", own: true },
      { source: "ebay", value: "D. Kilby" },
    ]);
    expect(choices.map((c) => c.value)).toEqual([
      "Dax Kilby",
      "Dax Kilbey",
      "Max Kilby",
      "Mac Kilby",
      "D. Kilby",
    ]);
  });

  test("case-folded de-dupe keeps the first spelling and every source", () => {
    const [one] = pickChoices([
      { source: "bsc", value: "Max Kilby" },
      { source: "checklist", value: " max kilby ", own: true },
    ]);
    expect(one.value).toBe("Max Kilby");
    expect(one.sources).toEqual(["bsc", "checklist"]);
    // A marketplace said it too: not the operator's alone.
    expect(one.own).toBe(false);
  });

  test("a value only the operator's own sources said is theirs", () => {
    const [one] = pickChoices([
      { source: "checklist", value: "Max", own: true },
      { source: "checklist-2", value: "MAX", own: true },
    ]);
    expect(one.own).toBe(true);
  });

  test("a typed value keeps its case unless a source spells it exactly so", () => {
    const choices = pickChoices([
      { source: "bsc", value: "Mike" },
      { source: "typed", value: "mike", exact: true },
      { source: "typed", value: "Mike", exact: true },
    ]);
    expect(choices.map((c) => c.value)).toEqual(["Mike", "mike"]);
    expect(findChoice(choices, "mike")?.value).toBe("mike");
    expect(findChoice(choices, "MIKE")?.value).toBe("Mike");
  });

  test("the radio options mark only an operator-only value, with the scope in the name", () => {
    const options = pickRadioOptions(
      pickChoices([
        { source: "bsc", value: "Dax Kilby" },
        { source: "checklist", value: "Max Kilby", own: true },
      ]),
      "name",
      "#OV-MAKI",
    );
    expect(options.map((o) => o.label)).toEqual(["Dax Kilby", "Max Kilby · your checklist"]);
    expect(options[1].ariaLabel).toBe("Max Kilby · your checklist — use this name for #OV-MAKI");
  });
});
