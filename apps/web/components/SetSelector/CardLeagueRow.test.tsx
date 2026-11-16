/**
 * NEO-569 — CardLeagueRow: the card's own league in the card drawer.
 *
 * Locks in:
 *   1. It reads `cardLeague.cardLeagueOptions` for this card.
 *   2. The field shows the card's league; focus opens "No league", the set's
 *      leagues, then the rest of the sport's (none twice), current one checked.
 *   3. A pick commits that league id; "No league" commits null; re-picking the
 *      current answer commits nothing.
 *   4. A blank says why, by `blankReason`, and the field is described by it.
 *   5. A refusal shows the commit's message in an alert and marks the field
 *      invalid.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: { cardLeague: { cardLeagueOptions: "cardLeague.cardLeagueOptions" } },
}));

let currentData: unknown;
const queryArgs: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (ref === "cardLeague.cardLeagueOptions") {
      queryArgs.push(args);
      return currentData;
    }
    return undefined;
  },
}));

import CardLeagueRow, {
  CARD_LEAGUE_LABEL,
  cardLeagueBlankCopy,
  cardLeagueOptions,
} from "./CardLeagueRow";
import type { LeagueSummary } from "./SetLeagueRow";
import type { Id } from "../../convex/_generated/dataModel";

const CARD_ID = "card-1" as unknown as Id<"cardChecklist">;
const lg = (id: string, name: string, abbreviation?: string): LeagueSummary => ({
  _id: id as unknown as Id<"leagues">,
  name,
  abbreviation,
});
const AL = lg("lg-al", "American League", "AL");
const NL = lg("lg-nl", "National League", "NL");
const IL = lg("lg-il", "International League", "IL");
const NPB = lg("lg-npb", "Nippon Professional Baseball", "NPB");
const NOR = lg("lg-nor", "Northern League");

function data(overrides: Partial<{
  current: LeagueSummary | null;
  setLeagues: LeagueSummary[];
  sportLeagues: LeagueSummary[];
  blankReason: string | null;
}> = {}) {
  return {
    current: overrides.current === undefined ? AL : overrides.current,
    setLeagues: overrides.setLeagues ?? [AL, NL],
    sportLeagues: overrides.sportLeagues ?? [AL, NL, IL],
    blankReason: overrides.blankReason ?? null,
  };
}

function renderRow(onCommit = vi.fn().mockResolvedValue(undefined)) {
  render(<CardLeagueRow cardId={CARD_ID} onCommit={onCommit} />);
  return { onCommit };
}

const field = () => screen.getByRole("combobox", { name: CARD_LEAGUE_LABEL }) as HTMLInputElement;
const options = () =>
  within(screen.getByRole("listbox", { name: `${CARD_LEAGUE_LABEL} suggestions` })).getAllByRole(
    "option",
  );

beforeEach(() => {
  queryArgs.length = 0;
  currentData = data();
});

describe("CardLeagueRow — pure helpers", () => {
  it("lists the blank, the set's leagues, then the sport's others, none twice", () => {
    expect(cardLeagueOptions([NL], [AL, NL, IL], null).map((o) => o.label)).toEqual([
      "No league",
      "National League",
      "American League",
      "International League",
    ]);
  });

  it("narrows by name or abbreviation, a match first; the blank only when its own words match, and last", () => {
    expect(cardLeagueOptions([AL, NL], [IL], "il").map((o) => o.label)).toEqual(["International League"]);
    expect(cardLeagueOptions([AL, NL], [IL], "nl").map((o) => o.label)).toEqual(["National League"]);
    // "no" names the blank, and still a league that matches comes first.
    expect(cardLeagueOptions([AL, NL], [IL, NPB], "no").map((o) => o.label)).toEqual([
      "No league",
    ]);
    expect(cardLeagueOptions([AL, NL], [IL, NOR], "no").map((o) => o.label)).toEqual([
      "Northern League",
      "No league",
    ]);
    // Text naming no league offers nothing to press, never a clear.
    expect(cardLeagueOptions([AL, NL], [IL], "zzz")).toEqual([]);
  });

  it("says why it is blank, and that listings wait", () => {
    expect(cardLeagueBlankCopy("teamsInDifferentLeagues")).toBe(
      "No league yet: its teams play in different leagues. Pick the one this card counts for. Listings are held back until it has one.",
    );
    expect(cardLeagueBlankCopy("noTeam")).toMatch(/^No league yet: this card has no team/);
    expect(cardLeagueBlankCopy("teamWithoutLeague")).toMatch(/Admin → Teams/);
    expect(cardLeagueBlankCopy(null)).toBe("No league yet. Pick one. Listings are held back until it has one.");
  });
});

describe("CardLeagueRow", () => {
  it("asks for this card's options and says it is loading until they arrive", () => {
    currentData = undefined;
    renderRow();
    expect(queryArgs[0]).toEqual({ cardId: CARD_ID });
    expect(screen.getByText("Loading leagues…")).toBeTruthy();
  });

  it("shows the card's league, and opens on the list with it checked", () => {
    renderRow();
    expect(field().value).toBe("American League");
    fireEvent.focus(field());
    const opts = options();
    expect(opts.map((o) => o.textContent)).toEqual([
      "No league",
      "✓American LeagueAL, in this set",
      "National LeagueNL, in this set",
      "International LeagueIL",
    ]);
    // The highlight starts on the current answer, so Enter re-confirms it.
    expect(opts[1].getAttribute("aria-selected")).toBe("true");
    // No why-blank line while it has one.
    expect(screen.queryByText(/^No league yet/)).toBeNull();
  });

  it("a pick commits that league", async () => {
    const { onCommit } = renderRow();
    fireEvent.focus(field());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^National League/ }));
    });
    expect(onCommit).toHaveBeenCalledWith(NL._id);
  });

  it("typing narrows; Enter takes the first match, never the blank", async () => {
    currentData = data({ sportLeagues: [AL, NL, IL, NPB] });
    const { onCommit } = renderRow();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "NPB" } });
    expect(options().map((o) => o.textContent)).toEqual(["Nippon Professional BaseballNPB"]);
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(NPB._id);
  });

  it("text that names no league says so, and Enter clears nothing", async () => {
    const { onCommit } = renderRow();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "zzz" } });
    expect(screen.getByText("No league by that name in this sport")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("No league commits null", async () => {
    const { onCommit } = renderRow();
    fireEvent.focus(field());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: "No league" }));
    });
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  it("re-picking the current league commits nothing", async () => {
    const { onCommit } = renderRow();
    fireEvent.focus(field());
    await act(async () => {
      fireEvent.keyDown(field(), { key: "Enter" });
    });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("Escape closes and puts the answer back", () => {
    renderRow();
    fireEvent.focus(field());
    fireEvent.change(field(), { target: { value: "nat" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(field().value).toBe("American League");
  });

  it("shows the pick while it saves", async () => {
    let resolve: () => void = () => {};
    const onCommit = vi.fn(() => new Promise<void>((r) => (resolve = r)));
    renderRow(onCommit);
    fireEvent.focus(field());
    fireEvent.mouseDown(screen.getByRole("option", { name: /^National League/ }));
    expect(field().value).toBe("National League");
    expect(screen.getByText("Saving…")).toBeTruthy();
    await act(async () => resolve());
    expect(screen.queryByText("Saving…")).toBeNull();
  });

  it("a blank says why, and the field is described by it", () => {
    currentData = data({ current: null, blankReason: "teamsInDifferentLeagues" });
    renderRow();
    expect(field().value).toBe("");
    const help = screen.getByText(/^No league yet: its teams play in different leagues\./);
    expect(field().getAttribute("aria-describedby")).toBe(help.id);
    fireEvent.focus(field());
    expect(options()[0].textContent).toBe("✓No league");
  });

  it("a refusal shows the commit's words and marks the field invalid", async () => {
    const onCommit = vi.fn().mockRejectedValue(new Error("That league isn't in this card's sport."));
    renderRow(onCommit);
    fireEvent.focus(field());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    });
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("That league isn't in this card's sport.");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(field().getAttribute("aria-describedby")).toBe(alert.id);
    // Back to the stored answer.
    expect(field().value).toBe("American League");
  });
});
