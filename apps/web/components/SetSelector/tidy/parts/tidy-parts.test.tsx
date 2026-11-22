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
