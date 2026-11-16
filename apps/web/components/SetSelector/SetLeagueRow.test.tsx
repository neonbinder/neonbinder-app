/**
 * NEO-569 — SetLeagueRow: a set-side row's leagues, as chips and an "Add
 * league" type-ahead over the sport's leagues.
 *
 * Locks in:
 *   1. Chips read the abbreviation; the full name is the title and the text a
 *      screen reader hears; each × is "Remove {full name}".
 *   2. The add field offers the sport's leagues not already here, in the
 *      server's order, narrowed by name or abbreviation; Enter adds one and
 *      saves the whole list ("Saving" then "Saved League").
 *   3. Delete / Backspace on a chip's × removes it; focus moves to the chip
 *      that took its place, else the one before, else the add field.
 *   4. Removing the last league saves [] and says "Cleared League".
 *   5. Below the set, a row with no list of its own shows the inherited one
 *      (dashed, and said in words naming the row it comes from); changing it
 *      saves an own list and says so; "Use the set's leagues" ("Use the
 *      leagues above" from a nearer row) saves [] to return, and so does any
 *      change that leaves the row's list the same as the one above.
 *   6. A refusal goes to onFailed and the chips snap back to the server's.
 *   7. Twelve is the cap; the field says so instead of offering more.
 *
 * Convex is module-mocked: `useQuery` serves `currentData` for the row and
 * `parentData` for its parent (the list above), `useMutation` returns
 * `mockSetLeagues`. The Autocomplete is the real primitive.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { ConvexError } from "convex/values";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    selectorOptions: {
      getSelectorOptionLeagues: "selectorOptions.getSelectorOptionLeagues",
      setSelectorOptionLeagues: "selectorOptions.setSelectorOptionLeagues",
    },
  },
}));

const mockSetLeagues = vi.fn();
let currentData: unknown;
let parentData: unknown;
/** What a below-the-set row's effective list becomes when it saves []. */
let clearTo: unknown[] = [];
const queryArgs: unknown[] = [];

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (ref === "selectorOptions.getSelectorOptionLeagues") {
      queryArgs.push(args);
      if (args === "skip") return undefined;
      const id = (args as { selectorOptionId: string }).selectorOptionId;
      return id === "row-1" ? currentData : parentData;
    }
    return undefined;
  },
  useMutation: (ref: string) =>
    ref === "selectorOptions.setSelectorOptionLeagues" ? mockSetLeagues : vi.fn(),
}));

import SetLeagueRow, {
  addableLeagues,
  leagueChipText,
  MAX_SET_LEAGUES,
  SET_LEAGUE_LABELS,
  type LeagueSummary,
} from "./SetLeagueRow";
import type { Id } from "../../convex/_generated/dataModel";

const ROW_ID = "row-1" as unknown as Id<"selectorOptions">;
const SET_ID = "set-1" as unknown as Id<"selectorOptions">;

const lg = (id: string, name: string, abbreviation?: string, level = "major"): LeagueSummary => ({
  _id: id as unknown as Id<"leagues">,
  name,
  abbreviation,
  level,
});

const MLB = lg("lg-mlb", "Major League Baseball", "MLB");
const NPB = lg("lg-npb", "Nippon Professional Baseball", "NPB");
const IL = lg("lg-il", "International League", "IL", "minor");
const PCL = lg("lg-pcl", "Pacific Coast League", "PCL", "minor");
const SPORT = [MLB, NPB, IL, PCL];

function data(overrides: Partial<{
  own: LeagueSummary[] | null;
  effective: LeagueSummary[];
  inheritedFrom: Id<"selectorOptions"> | null;
  sportLeagues: LeagueSummary[];
}> = {}) {
  const own = overrides.own === undefined ? [MLB] : overrides.own;
  return {
    own,
    effective: overrides.effective ?? own ?? [],
    inheritedFrom: overrides.inheritedFrom ?? null,
    sportLeagues: overrides.sportLeagues ?? SPORT,
  };
}

const ANCESTORS = [
  { _id: "sport" as unknown as Id<"selectorOptions">, value: "Baseball", level: "sport" },
  { _id: SET_ID, value: "2024 Bowman", level: "setName" },
  { _id: ROW_ID, value: "Prospects", level: "insert" },
];

function renderRow(props: Partial<Parameters<typeof SetLeagueRow>[0]> = {}) {
  const onSaving = vi.fn();
  const onSaved = vi.fn();
  const onFailed = vi.fn();
  const utils = render(
    <SetLeagueRow
      selectorOptionId={ROW_ID}
      levelLabel="Set"
      isSet
      ancestors={ANCESTORS}
      onSaving={onSaving}
      onSaved={onSaved}
      onFailed={onFailed}
      {...props}
    />,
  );
  return { ...utils, onSaving, onSaved, onFailed };
}

const addField = () => screen.getByRole("combobox", { name: SET_LEAGUE_LABELS.add });
const group = () => screen.getByRole("group", { name: SET_LEAGUE_LABELS.group });
const optionNames = () =>
  within(screen.getByRole("listbox", { name: `${SET_LEAGUE_LABELS.add} suggestions` }))
    .getAllByRole("option")
    .map((o) => o.textContent);

/**
 * The server, as far as this row can see it: a save becomes the row's own
 * list (absent when empty) before the promise settles, as Convex delivers the
 * subscription ahead of the mutation's answer.
 */
function serverSaves() {
  mockSetLeagues.mockImplementation(async ({ leagueIds }: { leagueIds: string[] }) => {
    const before = currentData as ReturnType<typeof data>;
    const byId = new Map<string, LeagueSummary>(
      [...before.sportLeagues, ...before.effective].map((l) => [l._id, l]),
    );
    const own = leagueIds.length > 0 ? leagueIds.map((id) => byId.get(id)!) : null;
    currentData = { ...before, own, effective: own ?? clearTo };
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryArgs.length = 0;
  serverSaves();
  currentData = data();
  parentData = undefined;
  clearTo = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SetLeagueRow — pure helpers", () => {
  it("a chip reads the abbreviation, else the name", () => {
    expect(leagueChipText(MLB)).toBe("MLB");
    expect(leagueChipText(lg("x", "Negro National League"))).toBe("Negro National League");
    expect(leagueChipText(lg("x", "Northern League", "  "))).toBe("Northern League");
  });

  it("offers what is not already here, in order, narrowed by name or abbreviation", () => {
    expect(addableLeagues(SPORT, [MLB], "").map((l) => l.name)).toEqual([
      NPB.name,
      IL.name,
      PCL.name,
    ]);
    expect(addableLeagues(SPORT, [], "pac").map((l) => l._id)).toEqual([PCL._id]);
    expect(addableLeagues(SPORT, [], "npb").map((l) => l._id)).toEqual([NPB._id]);
    expect(addableLeagues(SPORT, [MLB], "major")).toEqual([]);
  });
});

describe("SetLeagueRow — reading", () => {
  it("asks for this row's leagues, and on the set nothing above it", () => {
    renderRow();
    expect(queryArgs[0]).toEqual({ selectorOptionId: ROW_ID });
    expect(queryArgs).toContain("skip");
  });

  it("below the set, it also reads the parent's list", () => {
    renderRow({ levelLabel: "Insert", isSet: false });
    expect(queryArgs).toContainEqual({ selectorOptionId: SET_ID });
  });

  it("says it is loading until the answer arrives", () => {
    currentData = undefined;
    renderRow();
    expect(group()).toBeTruthy();
    expect(screen.getByText("Loading leagues…")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("a chip shows the abbreviation, titled and spoken with the full name, and its × names the league", () => {
    currentData = data({ own: [MLB, lg("lg-x", "Federal League")] });
    renderRow();
    const chips = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(chips).toHaveLength(2);
    const abbr = within(chips[0]).getByText("MLB");
    expect(abbr.getAttribute("title")).toBe("Major League Baseball");
    expect(abbr.getAttribute("aria-hidden")).toBe("true");
    expect(within(chips[0]).getByText("Major League Baseball").className).toContain("sr-only");
    expect(screen.getByRole("button", { name: "Remove Major League Baseball" })).toBeTruthy();
    // No abbreviation: the name itself.
    expect(within(chips[1]).getAllByText("Federal League")).toHaveLength(2);
  });

  it("the set's hint says what the list is for, and the group is described by it", () => {
    renderRow();
    const hint = screen.getByText(
      "Every league this set's teams play in. Team pickers look here first.",
    );
    expect(group().getAttribute("aria-describedby")).toBe(hint.id);
    expect(addField().getAttribute("aria-describedby")).toBe(hint.id);
    // Nothing to go back to on the set itself.
    expect(screen.queryByRole("button", { name: SET_LEAGUE_LABELS.useInherited })).toBeNull();
  });

  it("a set with no league yet says why to add one", () => {
    currentData = data({ own: null, effective: [] });
    renderRow();
    expect(screen.getByText("No league yet. Add one so team pickers know where to look.")).toBeTruthy();
  });

  it("a sport with no leagues says where to add them", () => {
    currentData = data({ own: null, effective: [], sportLeagues: [] });
    renderRow();
    expect(
      screen.getByText("This sport has no leagues yet. Add them in Admin → Leagues first."),
    ).toBeTruthy();
  });
});

describe("SetLeagueRow — adding", () => {
  it("focus opens the sport's leagues not already here, under Major leagues then More leagues", () => {
    renderRow();
    fireEvent.focus(addField());
    expect(optionNames()).toEqual([
      "Nippon Professional BaseballNPB",
      "International LeagueIL",
      "Pacific Coast LeaguePCL",
    ]);
    const major = screen.getByRole("group", { name: "Major leagues" });
    const more = screen.getByRole("group", { name: "More leagues" });
    expect(within(major).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Nippon Professional BaseballNPB",
    ]);
    expect(within(more).getAllByRole("option")).toHaveLength(2);
  });

  it("typing narrows; Enter adds the highlighted one, saves the whole list and clears the field", async () => {
    const { onSaving, onSaved } = renderRow();
    act(() => addField().focus());
    fireEvent.change(addField(), { target: { value: "pacific" } });
    expect(optionNames()).toEqual(["Pacific Coast LeaguePCL"]);
    await act(async () => {
      fireEvent.keyDown(addField(), { key: "Enter" });
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({
      selectorOptionId: ROW_ID,
      leagueIds: [MLB._id, PCL._id],
    });
    expect(onSaving).toHaveBeenCalledWith("League");
    expect(onSaved).toHaveBeenCalledWith("Saved League");
    expect((addField() as HTMLInputElement).value).toBe("");
    // Focus stays in the field for the next one.
    expect(document.activeElement).toBe(addField());
  });

  it("shows the new chip at once, before the server answers", async () => {
    let resolve: (v: null) => void = () => {};
    mockSetLeagues.mockReturnValue(new Promise((r) => (resolve = r)));
    renderRow();
    fireEvent.focus(addField());
    fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    expect(screen.getByRole("button", { name: "Remove International League" })).toBeTruthy();
    await act(async () => resolve(null));
  });

  it("Escape closes the list without adding", () => {
    renderRow();
    fireEvent.focus(addField());
    expect(screen.getByRole("listbox")).toBeTruthy();
    fireEvent.keyDown(addField(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(mockSetLeagues).not.toHaveBeenCalled();
  });

  it("a name that matches nothing says so", () => {
    renderRow();
    fireEvent.focus(addField());
    fireEvent.change(addField(), { target: { value: "zzz" } });
    expect(screen.getByText("No league by that name in this sport")).toBeTruthy();
  });

  it(`stops at ${MAX_SET_LEAGUES}: the list says so and offers none`, () => {
    const many = Array.from({ length: MAX_SET_LEAGUES }, (_, i) => lg(`lg-${i}`, `League ${i}`));
    currentData = data({ own: many, sportLeagues: [...many, PCL] });
    renderRow();
    fireEvent.focus(addField());
    expect(screen.getByText(`That's the limit: ${MAX_SET_LEAGUES} leagues.`)).toBeTruthy();
    expect(screen.queryByRole("option", { name: /^Pacific/ })).toBeNull();
  });

  it("a refusal goes to onFailed with the server's words, and the chips go back", async () => {
    mockSetLeagues.mockRejectedValue(new ConvexError("That league belongs to another sport."));
    const { onFailed, onSaved } = renderRow();
    fireEvent.focus(addField());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    });
    expect(onFailed).toHaveBeenCalledWith("That league belongs to another sport.");
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Remove International League" })).toBeNull();
  });

  it("a refusal with no words for a person gets the fallback", async () => {
    mockSetLeagues.mockRejectedValue(new Error("[CONVEX M(x)] Server Error"));
    const { onFailed } = renderRow();
    fireEvent.focus(addField());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    });
    expect(onFailed).toHaveBeenCalledWith("Could not save League");
  });
});

describe("SetLeagueRow — removing", () => {
  it("Delete on a chip's × removes it and moves focus to the chip that took its place", async () => {
    vi.useFakeTimers();
    currentData = data({ own: [MLB, NPB, IL] });
    const { onSaved } = renderRow();
    const x = screen.getByRole("button", { name: "Remove Major League Baseball" });
    x.focus();
    await act(async () => {
      fireEvent.keyDown(x, { key: "Delete" });
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({
      selectorOptionId: ROW_ID,
      leagueIds: [NPB._id, IL._id],
    });
    expect(onSaved).toHaveBeenCalledWith("Saved League");
    await act(async () => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Nippon Professional Baseball" }),
    );
  });

  it("Backspace on the last chip moves focus to the one before", async () => {
    vi.useFakeTimers();
    currentData = data({ own: [MLB, NPB] });
    renderRow();
    const x = screen.getByRole("button", { name: "Remove Nippon Professional Baseball" });
    await act(async () => {
      fireEvent.keyDown(x, { key: "Backspace" });
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [MLB._id] });
    await act(async () => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Remove Major League Baseball" }),
    );
  });

  it("removing the only league clears it, says Cleared League, and parks focus in the add field without opening it", async () => {
    vi.useFakeTimers();
    const { onSaved } = renderRow();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove Major League Baseball" }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [] });
    expect(onSaved).toHaveBeenCalledWith("Cleared League");
    await act(async () => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(addField());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("other keys on a × do nothing", () => {
    renderRow();
    fireEvent.keyDown(screen.getByRole("button", { name: "Remove Major League Baseball" }), {
      key: "a",
    });
    expect(mockSetLeagues).not.toHaveBeenCalled();
  });
});

describe("SetLeagueRow — below the set", () => {
  const SET_LIST = [MLB, NPB];
  const inherited = () =>
    data({ own: null, effective: SET_LIST, inheritedFrom: SET_ID });

  beforeEach(() => {
    // The set's own list, as the parent row answers it.
    parentData = data({ own: SET_LIST });
    clearTo = SET_LIST;
  });

  it("shows the inherited leagues as inherited, naming the row they come from", () => {
    currentData = inherited();
    renderRow({ levelLabel: "Insert", isSet: false });
    const list = screen.getByRole("list", { name: "Leagues from above" });
    const chips = within(list).getAllByRole("listitem");
    expect(chips).toHaveLength(2);
    // Shape, not only colour: a dashed outline, in ink-3 for 3:1 in dark.
    expect(chips[0].className).toContain("border-dashed");
    expect(chips[0].className).toContain("border-ink-3");
    expect(
      screen.getByText(
        "Using the set's leagues. Adding or removing one here gives this insert its own list.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: SET_LEAGUE_LABELS.useInherited })).toBeNull();
  });

  it("adding one starts the row's own list: the inherited ones plus the new one", async () => {
    currentData = inherited();
    renderRow({ levelLabel: "Insert", isSet: false });
    fireEvent.focus(addField());
    // The inherited ones are not offered again.
    expect(optionNames()).toEqual(["International LeagueIL", "Pacific Coast LeaguePCL"]);
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({
      selectorOptionId: ROW_ID,
      leagueIds: [MLB._id, NPB._id, IL._id],
    });
  });

  it("starting an own list says so", async () => {
    currentData = inherited();
    const { onSaved } = renderRow({ levelLabel: "Insert", isSet: false });
    fireEvent.focus(addField());
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    });
    expect(onSaved).toHaveBeenCalledWith("Saved League. This insert has its own leagues now.");
    expect(screen.getByText("This insert has its own leagues instead of the set's leagues.")).toBeTruthy();
  });

  it("taking the added one away again goes back to the set's list rather than keeping a copy", async () => {
    currentData = data({ own: [MLB, NPB, IL] });
    const { onSaved } = renderRow({ levelLabel: "Insert", isSet: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove International League" }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [] });
    expect(onSaved).toHaveBeenCalledWith("Back to the set's leagues");
    expect(screen.getByRole("list", { name: "Leagues from above" })).toBeTruthy();
    expect(
      screen.getByText("Using the set's leagues. Adding or removing one here gives this insert its own list."),
    ).toBeTruthy();
  });

  it("the same leagues in another order are still the set's", async () => {
    currentData = data({ own: [NPB, IL, MLB] });
    renderRow({ levelLabel: "Insert", isSet: false });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove International League" }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [] });
  });

  it("taking one of two inherited leagues away starts an own list of the other, and its × says so first", async () => {
    currentData = inherited();
    const { onSaved } = renderRow({ levelLabel: "Parallel", isSet: false });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Nippon Professional Baseball from this parallel" }),
      );
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [MLB._id] });
    expect(onSaved).toHaveBeenCalledWith("Saved League. This parallel has its own leagues now.");
    // Its own now: the plain × name.
    expect(screen.getByRole("button", { name: "Remove Major League Baseball" })).toBeTruthy();
  });

  it("a lone inherited league has no ×: an empty list is how a row inherits, so it would change nothing", () => {
    currentData = data({ own: null, effective: [MLB], inheritedFrom: SET_ID });
    renderRow({ levelLabel: "Insert", isSet: false });
    expect(screen.getByText("MLB")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
  });

  it("nothing above either: says how to add one here or on the set", () => {
    parentData = data({ own: null, effective: [] });
    currentData = data({ own: null, effective: [] });
    renderRow({ levelLabel: "Variant", isSet: false });
    expect(screen.queryByRole("list")).toBeNull();
    expect(
      screen.getByText(
        "No league yet. Add one here for this variant alone, or on the set for everything in it.",
      ),
    ).toBeTruthy();
  });

  it("an own list says so, and one action returns the row to the set's", async () => {
    vi.useFakeTimers();
    currentData = data({ own: [IL], effective: [IL] });
    const { onSaved } = renderRow({ levelLabel: "Insert", isSet: false });
    expect(screen.getByRole("list", { name: "This row's leagues" })).toBeTruthy();
    expect(screen.getByText("This insert has its own leagues instead of the set's leagues.")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SET_LEAGUE_LABELS.useInherited }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [] });
    expect(onSaved).toHaveBeenCalledWith("Back to the set's leagues");
    // The set's chips show at once, inherited.
    expect(within(screen.getByRole("list", { name: "Leagues from above" })).getAllByRole("listitem")).toHaveLength(2);
    await act(async () => {
      vi.runAllTimers();
    });
    expect(document.activeElement).toBe(addField());
  });
});

describe("SetLeagueRow — overlapping saves", () => {
  it("only the latest save speaks, and the chips wait for it", async () => {
    const resolvers: Array<(v: null) => void> = [];
    mockSetLeagues.mockImplementation(() => new Promise((r) => resolvers.push(r)));
    const { onSaved } = renderRow();
    fireEvent.focus(addField());
    fireEvent.mouseDown(screen.getByRole("option", { name: /^International League/ }));
    fireEvent.focus(addField());
    fireEvent.mouseDown(screen.getByRole("option", { name: /^Pacific Coast League/ }));
    expect(mockSetLeagues).toHaveBeenLastCalledWith({
      selectorOptionId: ROW_ID,
      leagueIds: [MLB._id, IL._id, PCL._id],
    });
    // The first settles: nothing said, the newest list still shown.
    await act(async () => resolvers[0](null));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Remove Pacific Coast League" })).toBeTruthy();
    await act(async () => resolvers[1](null));
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved).toHaveBeenCalledWith("Saved League");
    await waitFor(() => expect(mockSetLeagues).toHaveBeenCalledTimes(2));
  });
});

describe("SetLeagueRow — a list from a nearer row than the set", () => {
  const TYPE_ID = "type-1" as unknown as Id<"selectorOptions">;
  const CHAIN = [
    { _id: "sport" as unknown as Id<"selectorOptions">, value: "Baseball", level: "sport" },
    { _id: SET_ID, value: "2024 Bowman", level: "setName" },
    { _id: TYPE_ID, value: "Chrome Prospects", level: "variantType" },
    { _id: ROW_ID, value: "Refractor", level: "parallel" },
  ];

  beforeEach(() => {
    // The variant type has its own list; this parallel's parent is that type.
    parentData = data({ own: [IL, PCL] });
    clearTo = [IL, PCL];
  });

  it("inheriting: the hint names the row, not the set", () => {
    currentData = data({ own: null, effective: [IL, PCL], inheritedFrom: TYPE_ID });
    renderRow({ levelLabel: "Parallel", isSet: false, ancestors: CHAIN });
    expect(queryArgs).toContainEqual({ selectorOptionId: TYPE_ID });
    expect(
      screen.getByText(
        "Using the leagues from Chrome Prospects. Adding or removing one here gives this parallel its own list.",
      ),
    ).toBeTruthy();
  });

  it("an own list goes back with \"Use the leagues above\", and the toast names the row", async () => {
    currentData = data({ own: [MLB] });
    const { onSaved } = renderRow({ levelLabel: "Parallel", isSet: false, ancestors: CHAIN });
    expect(
      screen.getByText("This parallel has its own leagues instead of the leagues from Chrome Prospects."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: SET_LEAGUE_LABELS.useInherited })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: SET_LEAGUE_LABELS.useAbove }));
    });
    expect(mockSetLeagues).toHaveBeenCalledWith({ selectorOptionId: ROW_ID, leagueIds: [] });
    expect(onSaved).toHaveBeenCalledWith("Back to the leagues from Chrome Prospects");
  });

  it("a parent that inherits from the set points the way back at the set", () => {
    parentData = data({ own: null, effective: [MLB], inheritedFrom: SET_ID });
    currentData = data({ own: [IL] });
    renderRow({ levelLabel: "Parallel", isSet: false, ancestors: CHAIN });
    expect(screen.getByRole("button", { name: SET_LEAGUE_LABELS.useInherited })).toBeTruthy();
  });
});
