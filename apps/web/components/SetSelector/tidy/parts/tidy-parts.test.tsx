/**
 * NEO-645 — the pure pieces the identity tiles share: the words, "Printed on",
 * and the write hook's error reading. (`.test.tsx`: the components project only
 * collects that suffix.)
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  careerHeading,
  chipYearsText,
  marketplaceHeading,
  noStintText,
  outcomeHeading,
  playedHere,
  preselectReasonLine,
  stintYears,
  stintYearsText,
} from "./copy";
import { cardsWaitingOn, printedOnOf, printedOnText } from "./printed-on";
import type { TidyRow } from "../tile-types";
import { errorMessage, useTidyWrite } from "./tidy-write";

describe("copy", () => {
  it("stint years: open, single-season, range, none", () => {
    expect(stintYears({ fromYear: 2024 })).toBe("2024–");
    expect(stintYears({ fromYear: 2023, toYear: 2023 })).toBe("2023");
    expect(stintYears({ fromYear: 2011, toYear: 2018 })).toBe("2011–2018");
    expect(stintYears({})).toBe("");
  });

  describe("stintYearsText (A15, main's format): the years a chip prints", () => {
    it("no dated stint prints nothing", () => {
      expect(stintYearsText([])).toBe("");
      expect(stintYearsText([{}, { toYear: 2020 }])).toBe("");
    });

    it("a closed stint prints its span; one season prints one year; an open stint runs to present", () => {
      expect(stintYearsText([{ fromYear: 2024, toYear: 2026 }])).toBe("2024–2026");
      expect(stintYearsText([{ fromYear: 2026, toYear: 2026 }])).toBe("2026");
      expect(stintYearsText([{ fromYear: 2024 }])).toBe("2024–present");
    });

    it("overlapping stints and stints that touch (next season) merge into one span", () => {
      expect(stintYearsText([{ fromYear: 2015, toYear: 2018 }, { fromYear: 2017, toYear: 2020 }])).toBe("2015–2020");
      expect(stintYearsText([{ fromYear: 2015, toYear: 2017 }, { fromYear: 2018, toYear: 2019 }])).toBe("2015–2019");
    });

    it("separate spans print oldest first, joined by a comma, whatever order they arrive in", () => {
      expect(
        stintYearsText([{ fromYear: 2021, toYear: 2022 }, { fromYear: 2015, toYear: 2017 }]),
      ).toBe("2015–2017, 2021–2022");
    });

    it("an open stint swallows a later closed one", () => {
      expect(stintYearsText([{ fromYear: 2020 }, { fromYear: 2022, toYear: 2023 }])).toBe("2020–present");
    });

    it("an end before its start (bad data) still prints the years between them", () => {
      expect(stintYearsText([{ fromYear: 2020, toYear: 2018 }])).toBe("2018–2020");
    });

    it("a stint with a non-finite year is ignored, never printed as NaN", () => {
      expect(stintYearsText([{ fromYear: Number.NaN }, { fromYear: 2020, toYear: Number.NaN }])).toBe("");
    });
  });

  describe("chipYearsText (A15): no name prefix with one player", () => {
    it("one player: the years bare", () => {
      expect(chipYearsText([{ name: "Jackson Merrill", stints: [{ fromYear: 2024 }] }])).toBe("2024–present");
    });

    it("several players: each with a dated stint, named, in card order; one with none is skipped", () => {
      expect(
        chipYearsText([
          { name: "Jackson Merrill", stints: [{ fromYear: 2024 }] },
          { name: "No Years", stints: [{}] },
          { name: "Somebody Else", stints: [{ fromYear: 2019, toYear: 2021 }] },
        ]),
      ).toBe("Jackson Merrill 2024–present; Somebody Else 2019–2021");
    });

    it("nobody with a dated stint prints nothing", () => {
      expect(chipYearsText([{ name: "A", stints: [] }])).toBe("");
      expect(chipYearsText([{ name: "A", stints: [] }, { name: "B", stints: [{}] }])).toBe("");
    });
  });

  describe("careerHeading (NEO-639, main's wizard order)", () => {
    const TIE = "From the career. More than one team that season, so pick the one on the card.";
    const NO_TEAM = "From the career. This set says No Team, so pick one only if it's on the card.";

    it("a tie in the window says so; it is not 'no year on this set'", () => {
      expect(careerHeading(false, { tie: true })).toBe(TIE);
      expect(careerHeading(false, { noYear: true })).toBe(
        "No year on this set. Here's the whole career, so pick the one on the card.",
      );
    });

    it("a career with nothing in the year still says so first, even beside a tie", () => {
      expect(careerHeading(false, { uncoveredSetYear: 2025, tie: true })).toBe(
        "No 2025 team on file. Here's the whole career, so pick the one on the card.",
      );
    });

    it("a tie shows its line even when a chip is in the set year, so the heading never falls through", () => {
      expect(careerHeading(true, { tie: true })).toBe(TIE);
      expect(careerHeading(true, { tie: false })).toBe("Suggested from career history.");
    });

    it("the set's No Team outranks a tie, in the year or out of it", () => {
      expect(careerHeading(false, { tie: true, held: "setNoTeam" })).toBe(NO_TEAM);
      expect(careerHeading(true, { tie: true, held: "setNoTeam" })).toBe(NO_TEAM);
    });

    it("the set's No Team says the team is offered, not picked", () => {
      expect(careerHeading(false, { held: "setNoTeam" })).toBe(NO_TEAM);
    });

    it("a listing that names a team, or a checklist that settled it, holds the pick back (B7, B8)", () => {
      expect(careerHeading(false, { held: "listing" })).toBe(
        "From the career. The listing names a team, so pick the one on the card.",
      );
      expect(careerHeading(false, { held: "checklist" })).toBe(
        "From the career. The official checklist settled the team, so pick the one on the card.",
      );
      expect(careerHeading(false, { held: "listing", otherCards: true })).toBe(
        "From the player's other cards. The listing names a team, so pick the one on the card.",
      );
    });

    it("the player's other cards disagreeing says so", () => {
      expect(careerHeading(false, { disagree: true })).toBe(
        "The player's other cards name different teams, so pick the one on the card.",
      );
    });

    it("a prefill names where it came from; nothing to say falls back to a plain ask", () => {
      expect(careerHeading(true)).toBe("Suggested from career history.");
      expect(careerHeading(true, { otherCards: true })).toBe("Suggested from the player's other cards.");
      expect(careerHeading(false)).toBe("Pick the one on the card.");
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
    expect(marketplaceHeading("Padres", 1)).toBe("The listing names “Padres”. Pick it if it matches the card.");
    expect(marketplaceHeading("Padres", 2)).toBe(
      "The listing names “Padres”, and 2 teams share that name. Pick the one on the card.",
    );
    expect(outcomeHeading("answered", false)).toMatch(/^The listing has no team/);
    expect(outcomeHeading("answered", true)).toBeNull();
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

describe("printedOnOf (NEO-656: counted from this checklist's cards)", () => {
  const card = (id: string, cardNumber: string, extra: Partial<TidyRow> = {}) =>
    ({ _id: id, cardNumber, ...extra }) as unknown as TidyRow;

  it("counts only the cards still waiting on the name, matched through the shared normaliser", () => {
    const cards = [
      card("a", "1", { pendingPlayerNames: ["José Ramírez"] }),
      card("b", "2", { pendingPlayerNames: ["jose ramirez"] }),
      card("c", "3", { pendingPlayerNames: ["Someone Else"] }),
      // Linked already: it no longer lists the name as pending, so it is not counted.
      card("d", "4", { pendingPlayerNames: [] }),
    ];
    expect(printedOnOf(cards, "player", "Jose Ramirez")).toEqual({
      cardNumbers: ["1", "2"],
      count: 2,
      more: false,
    });
  });

  it("is null for a name nobody waits on, so an answered name says nothing", () => {
    expect(printedOnOf([card("a", "1", { pendingPlayerNames: ["X Y"] })], "player", "Z W")).toBeNull();
    expect(printedOnOf([], "team", "Padres")).toBeNull();
  });

  it("a player name never counts a card whose TEAM is pending under the same words", () => {
    const cards = [card("a", "1", { pendingTeamNames: ["Padres"] })];
    expect(cardsWaitingOn(cards, "player", "Padres")).toEqual([]);
    expect(cardsWaitingOn(cards, "team", "Padres")).toHaveLength(1);
  });

  it("lists the first eight numbers and counts the rest exactly (never a '+')", () => {
    const cards = Array.from({ length: 11 }, (_, i) =>
      card(`c${i}`, String(i + 1), { pendingTeamNames: ["Padres"] }),
    );
    const on = printedOnOf(cards, "team", "Padres")!;
    expect(on.cardNumbers).toHaveLength(8);
    expect(on.count).toBe(11);
    expect(printedOnText(on)).toBe("Printed on #1, #2, #3, #4, #5, #6, #7, #8 and 3 more");
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
