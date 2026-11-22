/**
 * NEO-645 — the pure pieces the identity tiles share: the words, "Printed on",
 * and the write hook's error reading. (`.test.tsx`: the components project only
 * collects that suffix.)
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  careerHeading,
  linkedForText,
  teamLinkedForText,
  marketplaceHeading,
  mergedStintYears,
  noStintText,
  outcomeHeading,
  playedHere,
  preselectReasonLine,
  stintYears,
  teamFillText,
} from "./copy";
import { printedOnText } from "./printed-on";
import { errorMessage, useTidyWrite } from "./tidy-write";

describe("copy", () => {
  it("says why a name was linked for the operator, in the approved words", () => {
    expect(linkedForText("exact")).toBe("Linked for you: exact name, plays in this set's sport");
    expect(linkedForText("setHistory")).toBe("Linked for you: another card in this set is already linked to them");
    expect(linkedForText("hallOfFame")).toBe(
      "Linked for you: none of the others on file played that year, but this one is in the Hall of Fame",
    );
    expect(linkedForText("careerTeam")).toBe("Linked for you: the only one on file who played for this card's team");
  });

  it("a team row's 'Linked for you' note is about the team, never a player's wording", () => {
    expect(teamLinkedForText("careerTeam", "Jackson Merrill")).toBe("Linked for you: Jackson Merrill played here");
    expect(teamLinkedForText("careerTeam")).toBe("Linked for you: a player on this card played here");
    expect(teamLinkedForText("careerTeam", "  ")).toBe("Linked for you: a player on this card played here");
    // The team row never says "the only one on file", which is the player row's sentence.
    expect(teamLinkedForText("careerTeam", "Jackson Merrill")).not.toMatch(/only one on file/);
    // Every other reason reads as it does everywhere else.
    expect(teamLinkedForText("setHistory")).toBe(linkedForText("setHistory"));
    // The player row keeps its own wording.
    expect(linkedForText("careerTeam")).toBe("Linked for you: the only one on file who played for this card's team");
  });

  it("the team-fill note uses no gendered words", () => {
    expect(teamFillText("career")).toBe("Team filled from the player's career");
    expect(teamFillText("otherCards")).toBe("Team filled from the player's other cards");
  });

  it("stint years: open, single-season, range, none", () => {
    expect(stintYears({ fromYear: 2024 })).toBe("2024–");
    expect(stintYears({ fromYear: 2023, toYear: 2023 })).toBe("2023");
    expect(stintYears({ fromYear: 2011, toYear: 2018 })).toBe("2011–2018");
    expect(stintYears({})).toBe("");
  });

  describe("mergedStintYears (NEO-639): the years a chip prints", () => {
    it("no dated stint prints nothing", () => {
      expect(mergedStintYears([])).toBe("");
      expect(mergedStintYears([{}, { toYear: 2020 }])).toBe("");
    });

    it("a closed stint prints its span; one season prints one year; an open stint runs on", () => {
      expect(mergedStintYears([{ fromYear: 2024, toYear: 2026 }])).toBe("2024–2026");
      expect(mergedStintYears([{ fromYear: 2026, toYear: 2026 }])).toBe("2026");
      expect(mergedStintYears([{ fromYear: 2024 }])).toBe("2024–");
    });

    it("overlapping stints and stints that touch (next season) merge into one span", () => {
      expect(mergedStintYears([{ fromYear: 2015, toYear: 2018 }, { fromYear: 2017, toYear: 2020 }])).toBe("2015–2020");
      expect(mergedStintYears([{ fromYear: 2015, toYear: 2017 }, { fromYear: 2018, toYear: 2019 }])).toBe("2015–2019");
    });

    it("separate spans print oldest first, joined by a comma, whatever order they arrive in", () => {
      expect(
        mergedStintYears([{ fromYear: 2021, toYear: 2022 }, { fromYear: 2015, toYear: 2017 }]),
      ).toBe("2015–2017, 2021–2022");
    });

    it("an open stint swallows a later closed one", () => {
      expect(mergedStintYears([{ fromYear: 2020 }, { fromYear: 2022, toYear: 2023 }])).toBe("2020–");
    });

    it("an end before its start (bad data) still prints the years between them", () => {
      expect(mergedStintYears([{ fromYear: 2020, toYear: 2018 }])).toBe("2018–2020");
    });

    it("a stint with a non-finite year is ignored, never printed as NaN", () => {
      expect(mergedStintYears([{ fromYear: Number.NaN }, { fromYear: 2020, toYear: Number.NaN }])).toBe("");
    });
  });

  describe("careerHeading (NEO-639)", () => {
    it("a tie in the window says so; it is not 'no year on this set'", () => {
      expect(careerHeading(false, false, undefined, { tie: true })).toBe(
        "From the career. More than one team that season, so pick the one on the card.",
      );
      expect(careerHeading(false, false, undefined)).toBe(
        "No year on this set. Here's the whole career, so pick the one on the card.",
      );
    });

    it("a career with nothing in the year still says so first, even beside a tie", () => {
      expect(careerHeading(false, false, 2025, { tie: true })).toBe(
        "No 2025 team on file. Here's the whole career, so pick the one on the card.",
      );
    });

    it("the set's No Team says the team is offered, not picked", () => {
      expect(careerHeading(true, false, undefined, { setNoTeam: true })).toBe(
        "From the career. This set says No Team, so pick one only if it's on the card.",
      );
    });

    it("the listing disagreeing outranks the set's No Team; a plain suggestion has neither", () => {
      expect(careerHeading(true, true, undefined, { setNoTeam: true })).toBe(
        "From the career. The listing names a different team, so pick the one on the card.",
      );
      expect(careerHeading(true, false)).toBe("Suggested from career history.");
    });
  });

  it("names a preselected player with the basis for it", () => {
    expect(
      preselectReasonLine({ name: "Sam Smith", sportValue: "Baseball", reason: "onlyNamesake" }),
    ).toBe("We've only got one Sam Smith (Baseball) on file. Same one?");
  });

  it("the career gap line never invents a year", () => {
    expect(noStintText("San Diego Padres", 2024)).toBe("No San Diego Padres in the career by 2024.");
    expect(noStintText("San Diego Padres", undefined)).toBe("No San Diego Padres in the career.");
    expect(noStintText(undefined, 2024)).toBe("This team isn't in the career by 2024.");
  });

  it("chip lines name full names and never the marketplace", () => {
    expect(playedHere(["A"])).toBe("A played here");
    expect(playedHere(["A", "B"])).toBe("A & B played here");
    expect(playedHere(["A", "B", "C"])).toBe("A, B & C played here");
    expect(marketplaceHeading("Padres", 1, false)).toBe("The listing names “Padres”. Pick it if it matches the card.");
    expect(marketplaceHeading("Padres", 2, false)).toBe(
      "The listing names “Padres”, and 2 teams share that name. Pick the one on the card.",
    );
    expect(marketplaceHeading("Padres", 1, true)).toBe("The listing names “Padres” and the career agrees.");
    expect(outcomeHeading("answered", false)).toMatch(/^The listing has no team/);
    expect(outcomeHeading("answered", true)).toBeNull();
    expect(careerHeading(true, false)).toBe("Suggested from career history.");
    expect(careerHeading(false, false)).toBe("No year on this set. Here's the whole career, so pick the one on the card.");
  });
});

describe("printedOnText", () => {
  it("lists the cards, and says how many more", () => {
    expect(printedOnText(null)).toBeNull();
    expect(printedOnText({ cardNumbers: [], count: 0, more: false })).toBeNull();
    expect(printedOnText({ cardNumbers: ["1", "17"], count: 2, more: false })).toBe("Printed on #1, #17");
    expect(printedOnText({ cardNumbers: ["1", "17"], count: 5, more: false })).toBe("Printed on #1, #17 and 3 more");
    expect(printedOnText({ cardNumbers: ["1", "17"], count: 30, more: true })).toBe("Printed on #1, #17 and 28+ more");
  });
});

describe("errorMessage", () => {
  it("prefers what the server wrote for the operator, hides a redacted one", () => {
    expect(errorMessage({ data: "That team is taken." }, "fallback")).toBe("That team is taken.");
    expect(errorMessage(new Error("Server Error"), "fallback")).toBe("fallback");
    expect(errorMessage(new Error("Nope"), "fallback")).toBe("Nope");
    expect(errorMessage("x", "fallback")).toBe("fallback");
  });
});

describe("useTidyWrite", () => {
  it("swallows a second press while one is in flight, and keeps the refusal", async () => {
    const { result } = renderHook(() => useTidyWrite());
    let release: () => void = () => {};
    const slow = () => new Promise<void>((resolve) => (release = resolve));
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.run(slow, "x");
    });
    expect(result.current.busy).toBe(true);
    let second = true;
    await act(async () => {
      second = await result.current.run(async () => {}, "x");
    });
    expect(second).toBe(false);
    await act(async () => {
      release();
      await first;
    });
    expect(result.current.busy).toBe(false);

    await act(async () => {
      await result.current.run(async () => {
        throw new Error("Server Error");
      }, "Couldn't do that.");
    });
    expect(result.current.error).toBe("Couldn't do that.");
    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
