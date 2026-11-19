/**
 * NEO-92 follow-up / NEO-212: coverage for `CareerTeamEntry` — the manual
 * career-team mini-form used by EntityReviewWizard for player rows.
 *
 * Locks in:
 *   1. Free-text add: a name that matches no existing team is still accepted
 *      (unlike EntityLinkSearch, which is pick-existing-only) — that name
 *      becomes a new team via get-or-create at commit time.
 *   2. Typeahead: STAGED names (teams this review will create) come first, then
 *      `teams.pickerCandidates` results the staged list does not already
 *      cover, IN THE SERVER'S ORDER (NEO-331: ranked by the set under review,
 *      never re-sorted here). Picking one fills the name field without adding.
 *   3. The "Did you mean {existing}?" prompt for a name that is close to
 *      something already in play but not equal to it — the "NY Yankees" vs
 *      "New York Yankees" case no substring filter catches.
 *   4. Year bounds mirror the server validation — Add is disabled for an
 *      out-of-bounds / inverted year range.
 *   5. onAdd emits the trimmed {name, fromYear, toYear?} shape and the form
 *      clears afterward.
 *
 * NEO-212 replaced the `teams.list` + `limit: 500` client filter with the
 * debounced search index, for the same reason as EntityLinkSearch: 500 is a
 * cap, and past it the team you needed was simply invisible.
 *
 * Every accessible name asserted here that predates NEO-212 ("Career team
 * name", "From year", "To year (optional)", "Add career team", "Use existing
 * team {name}") is a Maestro matcher and is unchanged. The staged suggestion
 * and the "did you mean" prompt are new controls and carry new names.
 *
 * Mocking mirrors EntityLinkSearch.test.tsx / PlayerPicker.test.tsx:
 * convex/react's useQuery is module-mocked, routed by the string-mocked
 * teams.pickerCandidates reference. `currentTeams` holds team rows in the
 * server's order; the mock wraps each as `{ team, tier: 4 }` (the context-free
 * answer) unless a test hands it ranked rows itself.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

// NEO-96: the sport-level selectorOptions ROW ID, not a display string.
const SPORT_ID = "selopt-sport-1" as unknown as Id<"selectorOptions">;
/** NEO-331: the set under review — a 2022 Donruss baseball variant row. */
const SET_ID = "selopt-set-1" as unknown as Id<"selectorOptions">;

/** Matches SEARCH_DEBOUNCE_MS in the component. */
const DEBOUNCE_MS = 200;

vi.mock("../../convex/_generated/api", () => ({
  api: { teams: { pickerCandidates: "teams.pickerCandidates" } },
}));

let currentTeams: unknown;
let mapped: { source: unknown; rows: unknown[] } | undefined;
let queryCalls: Array<{ ref: string; args: unknown }>;

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    queryCalls.push({ ref, args });
    if (args === "skip") return undefined;
    if (ref === "teams.pickerCandidates") {
      if (!Array.isArray(currentTeams)) return currentTeams;
      // Stable between renders, as Convex's is: the component holds the last
      // answer by identity, so a fresh array per call would never settle.
      if (mapped?.source !== currentTeams) {
        mapped = {
          source: currentTeams,
          rows: currentTeams.map((row: Record<string, unknown>) =>
            "team" in row ? row : { team: row, tier: 4 },
          ),
        };
      }
      return mapped.rows;
    }
    return undefined;
  },
}));

import CareerTeamEntry, { UNKNOWN_TEAM_AMBIGUOUS, UNKNOWN_TEAM_TEXT } from "./CareerTeamEntry";

function makeTeam(name: string, id: string) {
  return { _id: id, name };
}

function renderEntry(
  props: Partial<Parameters<typeof CareerTeamEntry>[0]> = {},
) {
  const onAdd = vi.fn();
  const utils = render(
    <CareerTeamEntry sportId={SPORT_ID} stagedNames={[]} onAdd={onAdd} {...props} />,
  );
  return { ...utils, onAdd };
}

/** Type a team name and let the search debounce elapse. */
function typeName(value: string) {
  fireEvent.change(screen.getByLabelText("Career team name"), {
    target: { value },
  });
  act(() => {
    vi.advanceTimersByTime(DEBOUNCE_MS);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  currentTeams = [];
  mapped = undefined;
  queryCalls = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Adding entries — unchanged behavior, unchanged labels
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — adding", () => {
  it("accepts a free-text team name that matches nothing and emits it via onAdd", () => {
    const { onAdd } = renderEntry();

    typeName("Brand New Club");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2021" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));

    expect(onAdd).toHaveBeenCalledWith({ name: "Brand New Club", fromYear: 2021 });
    // Form cleared for the next entry.
    expect((screen.getByLabelText("Career team name") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("From year") as HTMLInputElement).value).toBe("");
  });

  it("includes toYear when provided", () => {
    const { onAdd } = renderEntry();

    typeName("Arizona Diamondbacks");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2020" } });
    fireEvent.change(screen.getByLabelText("To year (optional)"), { target: { value: "2022" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));

    expect(onAdd).toHaveBeenCalledWith({
      name: "Arizona Diamondbacks",
      fromYear: 2020,
      toYear: 2022,
    });
  });

  it("disables Add for an out-of-bounds fromYear", () => {
    const { onAdd } = renderEntry();

    typeName("Ancient Club");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "1200" } });

    expect(
      (screen.getByRole("button", { name: "Add career team" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("disables Add when toYear precedes fromYear", () => {
    renderEntry();

    typeName("Backwards Club");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2022" } });
    fireEvent.change(screen.getByLabelText("To year (optional)"), { target: { value: "2019" } });

    expect(
      (screen.getByRole("button", { name: "Add career team" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("disables Add when the name is blank even if the year is valid", () => {
    renderEntry();

    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2021" } });

    expect(
      (screen.getByRole("button", { name: "Add career team" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// NEO-212 — the search-index data path
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — search source", () => {
  it("queries teams.pickerCandidates with the typed name and sport", () => {
    renderEntry();
    typeName("Blue");

    const lastSearch = queryCalls
      .filter((c) => c.ref === "teams.pickerCandidates")
      .pop();
    expect(lastSearch?.args).toEqual({
      query: "Blue",
      sportId: SPORT_ID,
      contextOptionId: undefined,
    });
  });

  it("NEO-331: passes the set under review as contextOptionId", () => {
    renderEntry({ contextOptionId: SET_ID });
    typeName("pad");

    const lastSearch = queryCalls
      .filter((c) => c.ref === "teams.pickerCandidates")
      .pop();
    expect(lastSearch?.args).toEqual({
      query: "pad",
      sportId: SPORT_ID,
      contextOptionId: SET_ID,
    });
  });

  it("skips the query while the field is blank", () => {
    renderEntry({ contextOptionId: SET_ID });

    const lastSearch = queryCalls
      .filter((c) => c.ref === "teams.pickerCandidates")
      .pop();
    expect(lastSearch?.args).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// NEO-331 — the saved half keeps the server's tiered order
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — set-ranked order (NEO-331)", () => {
  const SAN_DIEGO = { _id: "t-sd", location: "San Diego", name: "Padres" };
  const ARIZONA_LEAGUE = {
    _id: "t-azl",
    location: "Arizona League",
    name: "Padres",
  };

  it("lists the tier-1 team first even though it sorts after a tier-4 one A–Z", () => {
    // Jason's repro: Baseball › 2022 › Donruss, League MLB, typing "pad".
    // "Arizona League Padres" < "San Diego Padres" alphabetically, and both
    // are prefix-less for "pad", so the old client sort put Arizona first.
    currentTeams = [
      { team: SAN_DIEGO, tier: 1 },
      { team: ARIZONA_LEAGUE, tier: 4 },
    ];
    renderEntry({ contextOptionId: SET_ID });

    typeName("pad");

    expect(
      screen.getAllByRole("option").map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Use San Diego Padres", "Use Arizona League Padres"]);
  });

  it("does not promote a client-side prefix match over a higher tier", () => {
    // "Paducah Chiefs" STARTS WITH "pad"; "San Diego Padres" does not. The old
    // client sort put every prefix hit first — the server ranks prefix only
    // WITHIN a tier, and that is the order shown.
    const PADUCAH = { _id: "t-pad", location: "Paducah", name: "Chiefs" };
    currentTeams = [
      { team: SAN_DIEGO, tier: 1 },
      { team: PADUCAH, tier: 4 },
      { team: ARIZONA_LEAGUE, tier: 4 },
    ];
    renderEntry({ contextOptionId: SET_ID });

    typeName("pad");

    expect(
      screen.getAllByRole("option").map((el) => el.getAttribute("aria-label")),
    ).toEqual([
      "Use San Diego Padres",
      "Use Paducah Chiefs",
      "Use Arizona League Padres",
    ]);
  });

  it("still puts staged names ahead of the ranked saved half", () => {
    currentTeams = [
      { team: SAN_DIEGO, tier: 1 },
      { team: ARIZONA_LEAGUE, tier: 4 },
    ];
    renderEntry({ contextOptionId: SET_ID, stagedNames: ["Padres Prospects"] });

    typeName("pad");

    expect(
      screen.getAllByRole("option").map((el) => el.getAttribute("aria-label")),
    ).toEqual([
      "Use Padres Prospects",
      "Use San Diego Padres",
      "Use Arizona League Padres",
    ]);
  });

  it("Enter takes the top-ranked saved team", () => {
    currentTeams = [
      { team: SAN_DIEGO, tier: 1 },
      { team: ARIZONA_LEAGUE, tier: 4 },
    ];
    renderEntry({ contextOptionId: SET_ID });

    typeName("pad");
    fireEvent.keyDown(screen.getByLabelText("Career team name"), {
      key: "Enter",
    });

    expect(
      (screen.getByLabelText("Career team name") as HTMLInputElement).value,
    ).toBe("San Diego Padres");
  });
});

// ---------------------------------------------------------------------------
// NEO-212 — staged names come first
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — staged suggestions", () => {
  it("lists staged names BEFORE search results, with no tag of their own", () => {
    // The ordering is the point: a saved team is discoverable by typing its
    // full name; one that exists only as a pending decision in this batch is
    // not, so it has to be the thing the operator sees first.
    currentTeams = [makeTeam("Toronto Maple Leafs", "t1")];
    renderEntry({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto");

    const options = screen.getAllByRole("option");
    expect(options[0].getAttribute("aria-label")).toBe(
      "Use Toronto Blue Jays",
    );
    expect(options[1].getAttribute("aria-label")).toBe(
      "Use Toronto Maple Leafs",
    );
    // NEO-236: neither row says anything about WHERE it came from. A staged
    // name still sorts first — it is the one the operator cannot find any other
    // way — but "not saved yet" told them nothing they could act on, so both
    // rows now read as the plain team name.
    expect(options[0].textContent).toBe("Toronto Blue Jays");
    expect(options[1].textContent).toBe("Toronto Maple Leafs");
  });

  it("appends search results without duplicating a staged name", () => {
    // A team already staged AND already saved must appear once — the same name
    // twice, once tagged and once not, reads as two different teams.
    currentTeams = [makeTeam("Toronto Blue Jays", "t1"), makeTeam("Tampa Bay Rays", "t2")];
    renderEntry({ stagedNames: ["Toronto Blue Jays"] });

    typeName("T");

    const labels = screen
      .getAllByRole("option")
      .map((el) => el.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Use Toronto Blue Jays",
      "Use Tampa Bay Rays",
    ]);
  });

  it("dedupes a staged name against a saved one by the normalized key, not raw text", () => {
    currentTeams = [makeTeam("toronto blue jays", "t1")];
    renderEntry({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto");

    expect(screen.getAllByRole("option")).toHaveLength(1);
  });

  it("picking a staged suggestion fills the name field without adding", () => {
    const { onAdd } = renderEntry({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto");
    fireEvent.click(
      screen.getByRole("option", { name: "Use Toronto Blue Jays" }),
    );

    expect((screen.getByLabelText("Career team name") as HTMLInputElement).value).toBe(
      "Toronto Blue Jays",
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("picking a saved suggestion fills the name field without adding (label unchanged)", () => {
    currentTeams = [
      makeTeam("Toronto Blue Jays", "t1"),
      makeTeam("Tampa Bay Rays", "t2"),
      makeTeam("Boston Red Sox", "t3"),
    ];
    const { onAdd } = renderEntry();

    typeName("T");
    fireEvent.click(
      screen.getByRole("option", { name: "Use Toronto Blue Jays" }),
    );

    expect((screen.getByLabelText("Career team name") as HTMLInputElement).value).toBe(
      "Toronto Blue Jays",
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("shows no suggestions while the field is blank", () => {
    currentTeams = [makeTeam("Toronto Blue Jays", "t1")];
    renderEntry({ stagedNames: ["Tampa Bay Rays"] });

    fireEvent.focus(screen.getByLabelText("Career team name"));

    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// NEO-212 — the "did you mean" prompt
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — 'Did you mean' prompt", () => {
  it("offers a close staged match, and picking it fills the input", () => {
    // "NY Yankees" is not a substring of "New York Yankees" — they share
    // "yankees", which is exactly the rung rankTeamCandidates adds and the old
    // substring filter never had.
    const { onAdd } = renderEntry({ stagedNames: ["New York Yankees"] });

    typeName("NY Yankees");

    // The accessible name IS the visible text — the old `aria-label="Use
    // {name}"` shared not one word with what the operator could read, so a
    // voice-control user saying it matched nothing (WCAG 2.2 SC 2.5.3).
    const hint = screen.getByRole("button", {
      name: "Did you mean New York Yankees?",
    });
    expect(hint.textContent).toBe("Did you mean New York Yankees?");
    expect(hint.getAttribute("aria-label")).toBeNull();
    expect(screen.queryByLabelText("Use New York Yankees")).toBeNull();

    fireEvent.click(hint);
    expect((screen.getByLabelText("Career team name") as HTMLInputElement).value).toBe(
      "New York Yankees",
    );
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("offers a close SEARCHED match too, not just a staged one", () => {
    currentTeams = [makeTeam("New York Yankees", "t1")];
    renderEntry();

    typeName("NY Yankees");
    // The list is open and already offers that team, so the prompt waits...
    expect(screen.getByRole("option", { name: "Use New York Yankees" })).toBeTruthy();
    expect(screen.queryByText(/Did you mean/)).toBeNull();

    // ...and shows once the list is closed.
    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Escape" });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(
      screen.getByRole("button", { name: "Did you mean New York Yankees?" }),
    ).toBeTruthy();
  });

  it("says nothing while the open list already offers the team it would name", () => {
    renderEntry({ stagedNames: ["New York Yankees"] });

    typeName("New York Yankee");

    expect(screen.getByRole("option", { name: "Use New York Yankees" })).toBeTruthy();
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("shows beside an open list that offers a different team", () => {
    // The server returns a row that is not the near match: the list is open,
    // but it does not list the team the prompt would name.
    currentTeams = [makeTeam("Hudson Valley Renegades", "t9")];
    renderEntry({ stagedNames: ["New York Yankees"] });

    typeName("NY Yankees");

    expect(screen.getByRole("option", { name: "Use Hudson Valley Renegades" })).toBeTruthy();
    expect(screen.queryByRole("option", { name: "Use New York Yankees" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Did you mean New York Yankees?" }),
    ).toBeTruthy();
  });

  it("stays silent when the typed name EXACTLY matches something in play", () => {
    // Nothing to mean instead — the operator already typed the right name.
    renderEntry({ stagedNames: ["New York Yankees"] });

    typeName("new york yankees");

    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("stays silent when nothing is close", () => {
    currentTeams = [];
    renderEntry({ stagedNames: ["New York Yankees"] });

    typeName("Brand New Club");

    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });

  it("stays silent while the field is blank", () => {
    renderEntry({ stagedNames: ["New York Yankees"] });

    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });
});
// ---------------------------------------------------------------------------
// NEO-236 — ONE box, and the split happens on the team's own step
//
// Jason, 2026-09-05: "we should also remove the Location box from New Players
// as we should only be selecting existing teams or entering it in the singular
// field which would trigger that new team dialog."
//
// An earlier pass put a Location field beside the name here. It asked the
// operator to split a team while they were dating a stint, in a form with no
// room for the League, and it asked it in a different place from every other
// team creation in the product. What this component reports upward is a STINT;
// the team it names is either one we already hold or one the batch is about to
// ask about on a New Team step of its own.
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — one box", () => {
  it("has no Location field at all", () => {
    renderEntry();

    expect(
      screen.queryByLabelText("Career team location (optional)"),
    ).toBeNull();
    // ...and no composed preview either: there is nothing here to compose, and
    // the "Shows as" line belongs to the New Team step that does the splitting.
    expect(screen.queryByText(/Shows as:/)).toBeNull();
    expect(screen.getByLabelText("Career team name")).toBeTruthy();
  });

  it("emits the WHOLE typed name, trimmed, and never a location key", () => {
    const { onAdd } = renderEntry();

    typeName("  San Diego Padres  ");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2004" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));

    // Exactly this shape: a `location` key here would be a second place the
    // split could be decided, and two places recording the same answer is how
    // they end up disagreeing.
    expect(onAdd).toHaveBeenCalledWith({ name: "San Diego Padres", fromYear: 2004 });
  });

  it("still refuses to add without a name, however valid the years are", () => {
    const { onAdd } = renderEntry();

    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2004" } });

    const addButton = screen.getByRole("button", {
      name: "Add career team",
    }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
    fireEvent.click(addButton);
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("clears the single box after adding", () => {
    renderEntry();

    typeName("San Diego Padres");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2004" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));

    expect(
      (screen.getByLabelText("Career team name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("suggests a split saved team by its FULL name, and picks the whole thing", () => {
    // A suggestion is something the operator can pick to LINK to, and "Padres"
    // does not identify the row it belongs to. What lands in the box is
    // byte-for-byte the existing row's composed name, which is what makes the
    // commit link rather than create.
    currentTeams = [{ _id: "t1", name: "Padres", location: "San Diego" }];
    renderEntry();

    typeName("Padres");
    fireEvent.click(
      screen.getByRole("option", { name: "Use San Diego Padres" }),
    );

    expect(
      (screen.getByLabelText("Career team name") as HTMLInputElement).value,
    ).toBe("San Diego Padres");
  });

  it("compares the duplicate warning against the saved row's COMPOSED name", () => {
    currentTeams = [{ _id: "t1", name: "Padres", location: "San Diego" }];
    renderEntry();

    // The nickname alone is a near match against "San Diego Padres"...
    typeName("Padres");
    // The open list offers it already; the prompt shows once the list is closed.
    expect(screen.queryByText(/Did you mean/)).toBeNull();
    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Escape" });
    expect(screen.getByText("Did you mean San Diego Padres?")).toBeTruthy();

    // ...and typing the whole name is an EXACT one, so there is nothing to
    // mean instead. Ranking against the stored `name` ("Padres") would report a
    // near match where there is an exact one.
    typeName("San Diego Padres");
    expect(screen.queryByText(/Did you mean/)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEO-220 — Escape is the field's, and never the dialog's
//
// The old handler swallowed Escape only while the dropdown had suggestions in
// it. Type a team neither Wikidata nor `teams` has heard of — the exact case
// this field exists for — and Escape bubbled to the wizard root and cancelled
// the whole review batch. The operator pressed a key that means "clear this"
// and lost every decision they had made.
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — Escape", () => {
  /** Renders the field inside a spy container, standing in for the dialog root. */
  function renderInDialog(props: Partial<Parameters<typeof CareerTeamEntry>[0]> = {}) {
    const onRootKeyDown = vi.fn();
    const onAdd = vi.fn();
    render(
      <div onKeyDown={onRootKeyDown}>
        <CareerTeamEntry sportId={SPORT_ID} stagedNames={[]} onAdd={onAdd} {...props} />
      </div>,
    );
    return { onRootKeyDown, onAdd };
  }

  it("closes an open dropdown and stops there", () => {
    const { onRootKeyDown } = renderInDialog({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto");
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);

    const input = screen.getByLabelText("Career team name") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    // The typed name survives — closing a dropdown is not discarding the entry.
    expect(input.value).toBe("Toronto");
    expect(onRootKeyDown).not.toHaveBeenCalled();
  });

  it("clears the name once the dropdown is closed", () => {
    const { onRootKeyDown } = renderInDialog({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto");
    const input = screen.getByLabelText("Career team name") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" }); // closes the dropdown
    fireEvent.keyDown(input, { key: "Escape" }); // clears the field

    expect(input.value).toBe("");
    expect(onRootKeyDown).not.toHaveBeenCalled();
  });

  it("clears a name that matched nothing — the case that used to cancel the batch", () => {
    // No suggestions at all, so the old guard (`suggestionsOpen &&
    // suggestions.length > 0`) was false and Escape bubbled straight out.
    currentTeams = [];
    const { onRootKeyDown } = renderInDialog();

    typeName("Brand New Club");
    expect(screen.queryAllByRole("option")).toHaveLength(0);

    const input = screen.getByLabelText("Career team name") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Escape" });

    expect(input.value).toBe("");
    expect(onRootKeyDown).not.toHaveBeenCalled();
  });

  it("never reaches the dialog even with nothing to clear", () => {
    // `stopPropagation` is unconditional on purpose: the guarantee must not
    // depend on which branch of the handler ran.
    const { onRootKeyDown } = renderInDialog();

    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Escape" });

    expect(onRootKeyDown).not.toHaveBeenCalled();
  });

  it("leaves the year fields alone — they are not this handler's business", () => {
    const { onRootKeyDown } = renderInDialog();

    typeName("Toronto Blue Jays");
    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2023" } });
    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Escape" });

    expect((screen.getByLabelText("From year") as HTMLInputElement).value).toBe("2023");
    expect(onRootKeyDown).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// NEO-236 — the suggestion list has to go away
//
// Jason, 2026-09-06, on player "Rob Blake" after typing "Buffalo Sabres":
// "I can't find any way to dismiss the green list. it should go away once I've
// selected a team or the box has lost focus."
//
// Root cause: `pickSuggestion` closed the list and then called
// `nameInputRef.current.focus()`, while the input carried
// `onFocus={() => setSuggestionsOpen(true)}` — so the refocus reopened what the
// line above had just closed. The list then covered the From/To year fields,
// which are the very next thing to fill in, and blur was unhandled entirely.
// ===========================================================================

describe("CareerTeamEntry — dismissing the suggestion list", () => {
  const listbox = () => screen.queryByRole("listbox", { name: "Existing team suggestions" });

  it("closes on picking a suggestion, and puts focus in From year", () => {
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    renderEntry();
    typeName("Buffalo");

    expect(listbox()).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "Use Buffalo Sabres" }));

    expect(listbox()).toBeNull();
    // The team is chosen; the stint is not finished until it has a year.
    expect(document.activeElement).toBe(screen.getByLabelText("From year"));
    expect((screen.getByLabelText("Career team name") as HTMLInputElement).value).toBe(
      "Buffalo Sabres",
    );
  });

  it("stays closed after picking — focusing the box again must not reopen it", () => {
    // The regression itself: the list is opened by TYPING, never by focus.
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    renderEntry();
    typeName("Buffalo");
    fireEvent.click(screen.getByRole("option", { name: "Use Buffalo Sabres" }));

    fireEvent.focus(screen.getByLabelText("Career team name"));
    expect(listbox()).toBeNull();
  });

  it("closes when focus leaves the combobox for the year field", () => {
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    renderEntry();
    typeName("Buffalo");
    expect(listbox()).toBeTruthy();

    // jsdom does not move focus on `fireEvent.blur`, so drive the real move.
    screen.getByLabelText("From year").focus();
    fireEvent.blur(screen.getByLabelText("Career team name"));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(listbox()).toBeNull();
  });

  it("does NOT close while focus moves within the combobox", () => {
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    renderEntry();
    typeName("Buffalo");

    screen.getByRole("option", { name: "Use Buffalo Sabres" }).focus();
    fireEvent.blur(screen.getByLabelText("Career team name"));
    act(() => {
      vi.advanceTimersByTime(0);
    });

    expect(listbox()).toBeTruthy();
  });

  it("closes on Escape without letting it reach the wizard", () => {
    // NEO-220: Escape at the dialog root discards the whole review session, so
    // this field's Escape must never get there.
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    const onEscape = vi.fn();
    render(
      <div onKeyDown={onEscape}>
        <CareerTeamEntry sportId={SPORT_ID} stagedNames={[]} onAdd={vi.fn()} />
      </div>,
    );
    fireEvent.change(screen.getByLabelText("Career team name"), {
      target: { value: "Buffalo" },
    });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
    expect(listbox()).toBeTruthy();

    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Escape" });

    expect(listbox()).toBeNull();
    expect(onEscape).not.toHaveBeenCalled();
  });

  it("reopens on ArrowDown, for a keyboard operator who wants it back", () => {
    currentTeams = [{ _id: "t1", name: "Buffalo Sabres" }];
    renderEntry();
    typeName("Buffalo");
    fireEvent.click(screen.getByRole("option", { name: "Use Buffalo Sabres" }));
    expect(listbox()).toBeNull();

    fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "ArrowDown" });
    expect(listbox()).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// NEO-574 — a list that only echoes the box does not cover + Add
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — whole team name typed (NEO-574)", () => {
  const listbox = () => screen.queryByRole("listbox", { name: "Existing team suggestions" });
  const RIVERKINGS = makeTeam("Memphis RiverKings", "t-rk");
  const RIVERKINGS_II = makeTeam("Memphis RiverKings II", "t-rk2");
  const nameBox = () => screen.getByLabelText("Career team name") as HTMLInputElement;

  it("shows no list once the box holds a known team's whole name, so + Add is clickable", () => {
    // The list is an overlay under the field: it used to sit on the years and
    // + Add, and a click on + Add picked a suggestion instead of adding.
    currentTeams = [RIVERKINGS, RIVERKINGS_II];
    const { onAdd } = renderEntry();

    typeName("Memphis RiverKings");

    expect(listbox()).toBeNull();
    expect(nameBox().getAttribute("aria-expanded")).toBe("false");

    fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2012" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "Memphis RiverKings", fromYear: 2012 });
  });

  it("treats case and accents as the same name", () => {
    currentTeams = [RIVERKINGS];
    renderEntry();

    typeName("memphis riverkings");

    expect(listbox()).toBeNull();
  });

  it("applies to a staged name too", () => {
    renderEntry({ stagedNames: ["Toronto Blue Jays"] });

    typeName("Toronto Blue Jays");

    expect(listbox()).toBeNull();
  });

  it("still lists the team while the name is only part-typed", () => {
    currentTeams = [RIVERKINGS, RIVERKINGS_II];
    renderEntry();

    typeName("Memphis River");

    expect(listbox()).toBeTruthy();
    expect(nameBox().getAttribute("aria-expanded")).toBe("true");
  });

  it("brings the list back when typing moves off the whole name", () => {
    currentTeams = [RIVERKINGS, RIVERKINGS_II];
    renderEntry();
    typeName("Memphis RiverKings");
    expect(listbox()).toBeNull();

    typeName("Memphis RiverKings I");

    expect(
      screen.getByRole("option", { name: "Use Memphis RiverKings II" }),
    ).toBeTruthy();
  });

  it("Enter moves to From year and leaves the typed name alone", () => {
    // The sibling ranked first must not replace what the operator typed.
    currentTeams = [RIVERKINGS_II, RIVERKINGS];
    const { onAdd } = renderEntry();
    typeName("Memphis RiverKings");

    fireEvent.keyDown(nameBox(), { key: "Enter" });

    expect(nameBox().value).toBe("Memphis RiverKings");
    expect(document.activeElement).toBe(screen.getByLabelText("From year"));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("ArrowDown still shows the list on purpose, and typing hides it again", () => {
    currentTeams = [RIVERKINGS, RIVERKINGS_II];
    renderEntry();
    typeName("Memphis RiverKings");
    expect(listbox()).toBeNull();

    fireEvent.keyDown(nameBox(), { key: "ArrowDown" });
    expect(listbox()).toBeTruthy();

    typeName("Memphis RiverKing");
    typeName("Memphis RiverKings");
    expect(listbox()).toBeNull();
  });

  it("Escape on a whole name with the list hidden clears the name, as for any closed list", () => {
    currentTeams = [RIVERKINGS];
    renderEntry();
    typeName("Memphis RiverKings");

    fireEvent.keyDown(nameBox(), { key: "Escape" });

    expect(nameBox().value).toBe("");
  });
});

// ---------------------------------------------------------------------------
// NEO-574 — keyboard, stale results, combobox semantics, in-flow list
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — list behaviour after the audit (NEO-574)", () => {
  const listbox = () => screen.queryByRole("listbox", { name: "Existing team suggestions" });
  const RK = makeTeam("Memphis RiverKings", "t-rk");
  const RK2 = makeTeam("Memphis RiverKings II", "t-rk2");
  const nameBox = () => screen.getByLabelText("Career team name") as HTMLInputElement;
  const typeNow = (value: string) =>
    fireEvent.change(nameBox(), { target: { value } });
  const settle = (ms = 0) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  describe("ArrowDown", () => {
    it("first press on a whole name opens the list on that team, not the row after it", () => {
      currentTeams = [RK2, RK];
      renderEntry();
      typeName("Memphis RiverKings");
      expect(listbox()).toBeNull();

      fireEvent.keyDown(nameBox(), { key: "ArrowDown" });

      expect(
        screen.getByRole("option", { name: "Use Memphis RiverKings" }).getAttribute("aria-selected"),
      ).toBe("true");
      expect(
        screen.getByRole("option", { name: "Use Memphis RiverKings II" }).getAttribute("aria-selected"),
      ).toBe("false");
    });

    it("with the list already showing, moves down a row", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis River");

      fireEvent.keyDown(nameBox(), { key: "ArrowDown" });

      expect(
        screen.getByRole("option", { name: "Use Memphis RiverKings II" }).getAttribute("aria-selected"),
      ).toBe("true");
    });

    it("after ArrowDown then Escape, Enter on the whole name moves on to From year", () => {
      currentTeams = [RK2, RK];
      renderEntry();
      typeName("Memphis RiverKings");
      fireEvent.keyDown(nameBox(), { key: "ArrowDown" });
      fireEvent.keyDown(nameBox(), { key: "Escape" });
      expect(listbox()).toBeNull();

      fireEvent.keyDown(nameBox(), { key: "Enter" });

      expect(nameBox().value).toBe("Memphis RiverKings");
      expect(document.activeElement).toBe(screen.getByLabelText("From year"));
    });

    it("picking a row ends the browsing: the list stays away from the same name", () => {
      currentTeams = [RK2, RK];
      renderEntry();
      typeName("Memphis RiverKings");
      // Whole name, list hidden: this ArrowDown is what starts the browsing.
      fireEvent.keyDown(nameBox(), { key: "ArrowDown" });
      fireEvent.click(screen.getByRole("option", { name: "Use Memphis RiverKings" }));

      // Back in the name box: Enter on the whole name goes on to From year, as
      // it would had the operator never pressed ArrowDown.
      nameBox().focus();
      expect(document.activeElement).toBe(nameBox());
      fireEvent.keyDown(nameBox(), { key: "Enter" });
      expect(listbox()).toBeNull();
      expect(document.activeElement).toBe(screen.getByLabelText("From year"));
    });
  });

  describe("results that have not caught up", () => {
    it("keeps the list mounted while a keystroke still matches the rows it holds", () => {
      // Hiding stale rows used to make the in-flow list vanish and return on
      // every keystroke: aria-expanded flipping, the status re-read, + Add
      // jumping.
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis");
      const list = listbox()!;
      const status = screen.getByRole("status");
      expect(nameBox().getAttribute("aria-expanded")).toBe("true");
      expect(status.textContent).toBe("2 suggestions");

      // Debounce not elapsed: the mock still answers for "Memphis".
      for (const text of ["Memphis R", "Memphis Ri", "Memphis Riv"]) {
        typeNow(text);
        expect(listbox()).toBe(list);
        expect(nameBox().getAttribute("aria-expanded")).toBe("true");
        expect(status.textContent).toBe("2 suggestions");
      }

      settle(DEBOUNCE_MS);
      expect(listbox()).toBe(list);
      expect(nameBox().getAttribute("aria-expanded")).toBe("true");
    });

    it("drops stale rows that no longer match the text, keeps those that do, and closes when none are left", () => {
      currentTeams = [RK, makeTeam("Memphis Mud Hens", "t-mh")];
      renderEntry();
      typeName("Memphis");
      expect(screen.getAllByRole("option")).toHaveLength(2);

      typeNow("Memphis River");
      expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
        "Use Memphis RiverKings",
      ]);
      expect(nameBox().getAttribute("aria-expanded")).toBe("true");

      typeNow("Zzz");
      expect(listbox()).toBeNull();
      expect(nameBox().getAttribute("aria-expanded")).toBe("false");
    });

    it("keeps matching rows, and the list open, while a query with new arguments loads", () => {
      // Convex returns undefined for the new arguments until they answer; the
      // last answer, narrowed to the text, stands in so the list does not blink.
      currentTeams = [RK, RK2, makeTeam("Memphis Mud Hens", "t-mh")];
      renderEntry();
      typeName("Memphis");
      const list = listbox()!;
      expect(screen.getAllByRole("option")).toHaveLength(3);

      currentTeams = undefined;
      typeNow("Memphis River");
      settle(DEBOUNCE_MS);

      expect(listbox()).toBe(list);
      expect(nameBox().getAttribute("aria-expanded")).toBe("true");
      expect(screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"))).toEqual([
        "Use Memphis RiverKings",
        "Use Memphis RiverKings II",
      ]);

      // Nothing held matches: now it closes.
      typeNow("Zzz");
      settle(DEBOUNCE_MS);
      expect(listbox()).toBeNull();
    });

    it("offers no saved rows while the query has not answered at all", () => {
      currentTeams = undefined;
      renderEntry();
      typeName("Memphis");
      expect(listbox()).toBeNull();

      currentTeams = [RK];
      typeNow("Memphis R");
      settle(DEBOUNCE_MS);
      expect(screen.getByRole("option", { name: "Use Memphis RiverKings" })).toBeTruthy();
    });

    it("keeps a staged match instant, without the stale saved rows", () => {
      currentTeams = [RK, RK2];
      renderEntry({ stagedNames: ["Memphis Mud Hens"] });
      typeName("Memphis");

      typeNow("Memphis M");

      expect(screen.getByRole("option", { name: "Use Memphis Mud Hens" })).toBeTruthy();
      expect(screen.queryByRole("option", { name: "Use Memphis RiverKings" })).toBeNull();
    });
  });

  describe("combobox semantics", () => {
    it("wires aria-controls, aria-activedescendant and unique option ids", () => {
      currentTeams = [RK, RK2];
      renderEntry();

      // Closed: nothing active, and the list is not claimed as open.
      expect(nameBox().getAttribute("aria-expanded")).toBe("false");
      expect(nameBox().getAttribute("aria-activedescendant")).toBeNull();

      typeName("Memphis River");
      const list = listbox()!;
      expect(nameBox().getAttribute("aria-controls")).toBe(list.id);
      expect(list.id).not.toBe("");

      const options = screen.getAllByRole("option");
      const ids = options.map((o) => o.id);
      expect(new Set(ids).size).toBe(2);
      expect(ids.every((id) => id !== "")).toBe(true);
      expect(nameBox().getAttribute("aria-activedescendant")).toBe(ids[0]);

      fireEvent.keyDown(nameBox(), { key: "ArrowDown" });
      expect(nameBox().getAttribute("aria-activedescendant")).toBe(ids[1]);
      expect(document.getElementById(ids[1])).toBe(options[1]);

      fireEvent.keyDown(nameBox(), { key: "Escape" });
      expect(nameBox().getAttribute("aria-activedescendant")).toBeNull();
    });

    it("keeps options out of the Tab order", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis River");

      for (const option of screen.getAllByRole("option")) {
        expect(option.getAttribute("tabindex")).toBe("-1");
      }
    });

    it("announces the count through a status region that stays mounted", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      const status = screen.getByRole("status");
      expect(status.textContent).toBe("");

      typeName("Memphis River");
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe("2 suggestions");

      fireEvent.keyDown(nameBox(), { key: "Escape" });
      expect(screen.getByRole("status")).toBe(status);
      expect(status.textContent).toBe("");
    });

    it("says '1 suggestion' for one row", () => {
      currentTeams = [RK];
      renderEntry();
      typeName("Memphis River");
      expect(screen.getByRole("status").textContent).toBe("1 suggestion");
    });
  });

  describe("in the flow, not over the years", () => {
    it("sits between the name box and the years row, not absolutely positioned", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis River");

      const list = listbox()!;
      expect(list.className).not.toMatch(/\babsolute\b/);
      expect(list.className).toMatch(/\bmax-h-32\b/);
      expect(list.className).toMatch(/max-sm:max-h-\[30vh\]/);
      const follows = (a: Element, b: Element) =>
        Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(nameBox(), list)).toBe(true);
      expect(follows(list, screen.getByLabelText("From year"))).toBe(true);
      expect(follows(list, screen.getByRole("button", { name: "Add career team" }))).toBe(true);
    });

    it("scrolls the entry into view when the list opens", () => {
      currentTeams = [RK, RK2];
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      try {
        renderEntry();
        typeName("Memphis River");
        expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it("keeps the list while + Add is pressed, so the click lands, then closes it", () => {
      // Blur from the name box used to close the list on mousedown, which pulled
      // + Add up from under the pointer before mouseup: no click.
      currentTeams = [RK, RK2];
      const { onAdd } = renderEntry();
      typeName("Memphis River");
      fireEvent.change(screen.getByLabelText("From year"), { target: { value: "2012" } });
      const add = screen.getByRole("button", { name: "Add career team" });

      fireEvent.mouseDown(add);
      add.focus();
      fireEvent.blur(nameBox());
      settle();
      expect(listbox()).toBeTruthy();

      fireEvent.mouseUp(window);
      fireEvent.click(add);
      settle();

      expect(onAdd).toHaveBeenCalledWith({ name: "Memphis River", fromYear: 2012 });
      expect(listbox()).toBeNull();
    });

    it("closes the list after a press on a year box is released", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis River");
      const from = screen.getByLabelText("From year");

      fireEvent.mouseDown(from);
      from.focus();
      fireEvent.blur(nameBox());
      settle();
      expect(listbox()).toBeTruthy();

      fireEvent.mouseUp(window);
      settle();
      expect(listbox()).toBeNull();
    });

    it("a blur with no press still closes at once", () => {
      currentTeams = [RK, RK2];
      renderEntry();
      typeName("Memphis River");

      screen.getByLabelText("From year").focus();
      fireEvent.blur(nameBox());
      settle();

      expect(listbox()).toBeNull();
    });
  });
});

// ===========================================================================
// NEO-326 — Enter in a year field is "+ Add"
//
// Jason, 2026-10-04: "When filling in the years, the enter key should have the
// same effect as 'add' as long as the data is valid."
//
// Same `commit()` as the button: emit, reset all three fields, focus back on
// the name for the next stint. Enter's default is prevented whether or not the
// data is valid, and invalid data adds nothing. The name field's own Enter
// (take a suggestion or close the list) is untouched.
// ===========================================================================

describe("CareerTeamEntry — Enter in a year field adds", () => {
  const nameInput = () => screen.getByLabelText("Career team name") as HTMLInputElement;
  const fromInput = () => screen.getByLabelText("From year") as HTMLInputElement;
  const toInput = () => screen.getByLabelText("To year (optional)") as HTMLInputElement;

  it("adds from From year with a valid name and year, resets, and refocuses the name", () => {
    const { onAdd } = renderEntry();

    typeName("Brand New Club");
    fireEvent.change(fromInput(), { target: { value: "2021" } });
    act(() => {
      fromInput().focus();
    });
    fireEvent.keyDown(fromInput(), { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({ name: "Brand New Club", fromYear: 2021 });
    expect(nameInput().value).toBe("");
    expect(fromInput().value).toBe("");
    expect(toInput().value).toBe("");
    expect(document.activeElement).toBe(nameInput());
  });

  it("adds from To year with a valid range", () => {
    const { onAdd } = renderEntry();

    typeName("Arizona Diamondbacks");
    fireEvent.change(fromInput(), { target: { value: "2020" } });
    fireEvent.change(toInput(), { target: { value: "2022" } });
    act(() => {
      toInput().focus();
    });
    fireEvent.keyDown(toInput(), { key: "Enter" });

    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith({
      name: "Arizona Diamondbacks",
      fromYear: 2020,
      toYear: 2022,
    });
    expect(nameInput().value).toBe("");
    expect(fromInput().value).toBe("");
    expect(toInput().value).toBe("");
    expect(document.activeElement).toBe(nameInput());
  });

  it.each([
    { label: "no name", name: "", from: "2021", to: "" },
    { label: "no From year", name: "Brand New Club", from: "", to: "" },
    { label: "a From year below the floor", name: "Ancient Club", from: "1200", to: "" },
    { label: "a From year past the ceiling", name: "Future Club", from: "9999", to: "" },
    { label: "To earlier than From", name: "Backwards Club", from: "2022", to: "2020" },
  ])("adds nothing on Enter with $label, from either year field", ({ name, from, to }) => {
    const { onAdd } = renderEntry();

    if (name) typeName(name);
    fireEvent.change(fromInput(), { target: { value: from } });
    fireEvent.change(toInput(), { target: { value: to } });
    fireEvent.keyDown(fromInput(), { key: "Enter" });
    fireEvent.keyDown(toInput(), { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    // Nothing reset: the operator's half-finished entry is still there to fix.
    expect(nameInput().value).toBe(name);
    expect(fromInput().value).toBe(from);
    expect(toInput().value).toBe(to);
  });

  it("prevents Enter's default in both year fields, valid or not", () => {
    renderEntry();

    // Invalid (blank) first: the default is still prevented.
    expect(fireEvent.keyDown(fromInput(), { key: "Enter" })).toBe(false);
    expect(fireEvent.keyDown(toInput(), { key: "Enter" })).toBe(false);

    typeName("Brand New Club");
    fireEvent.change(fromInput(), { target: { value: "2021" } });
    expect(fireEvent.keyDown(fromInput(), { key: "Enter" })).toBe(false);

    typeName("Arizona Diamondbacks");
    fireEvent.change(fromInput(), { target: { value: "2020" } });
    fireEvent.change(toInput(), { target: { value: "2022" } });
    expect(fireEvent.keyDown(toInput(), { key: "Enter" })).toBe(false);
  });

  it("leaves other keys alone in the year fields", () => {
    const { onAdd } = renderEntry();

    typeName("Brand New Club");
    fireEvent.change(fromInput(), { target: { value: "2021" } });

    expect(fireEvent.keyDown(fromInput(), { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(toInput(), { key: "a" })).toBe(true);
    expect(onAdd).not.toHaveBeenCalled();
    expect(fromInput().value).toBe("2021");
  });

  it("still never adds from the NAME field, even with valid years filled in", () => {
    const { onAdd } = renderEntry();

    typeName("Brand New Club");
    fireEvent.change(fromInput(), { target: { value: "2021" } });
    fireEvent.keyDown(nameInput(), { key: "Enter" });

    expect(onAdd).not.toHaveBeenCalled();
    expect(nameInput().value).toBe("Brand New Club");
    expect(fromInput().value).toBe("2021");
  });
});

// ---------------------------------------------------------------------------
// NEO-574 — a prefill (the card's team and the set's year) and quick picks
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — prefill and quick picks (NEO-574)", () => {
  const nameInput = () => screen.getByLabelText("Career team name") as HTMLInputElement;
  const fromInput = () => screen.getByLabelText("From year") as HTMLInputElement;

  it("opens with the team and year filled in, and adds nothing by itself", () => {
    const { onAdd } = renderEntry({ initialTeam: "San Diego Padres", initialFromYear: 2022 });
    expect(nameInput().value).toBe("San Diego Padres");
    expect(fromInput().value).toBe("2022");
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("a prefill left as it came is not dirty; a change to it is", () => {
    const onDirtyChange = vi.fn();
    renderEntry({ initialTeam: "San Diego Padres", initialFromYear: 2022, onDirtyChange });
    expect(onDirtyChange).not.toHaveBeenCalledWith(true);
    fireEvent.change(fromInput(), { target: { value: "2020" } });
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("+ Add sends the prefilled entry", () => {
    const { onAdd } = renderEntry({ initialTeam: "San Diego Padres", initialFromYear: 2022 });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "San Diego Padres", fromYear: 2022 });
  });

  it("follows a new prefill when the form is untouched, and focuses From year after an add", () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <CareerTeamEntry
        sportId={SPORT_ID}
        stagedNames={[]}
        onAdd={onAdd}
        initialTeam="San Diego Padres"
        initialFromYear={2022}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    rerender(
      <CareerTeamEntry
        sportId={SPORT_ID}
        stagedNames={[]}
        onAdd={onAdd}
        initialTeam="Chicago Cubs"
        initialFromYear={2022}
      />,
    );
    expect(nameInput().value).toBe("Chicago Cubs");
    expect(fromInput().value).toBe("2022");
    expect(document.activeElement).toBe(fromInput());
  });

  it("leaves a form the operator has typed in alone when the prefill changes", () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <CareerTeamEntry
        sportId={SPORT_ID}
        stagedNames={[]}
        onAdd={onAdd}
        initialTeam="San Diego Padres"
        initialFromYear={2022}
      />,
    );
    typeName("Somewhere Else");
    rerender(
      <CareerTeamEntry
        sportId={SPORT_ID}
        stagedNames={[]}
        onAdd={onAdd}
        initialTeam="Chicago Cubs"
        initialFromYear={2022}
      />,
    );
    expect(nameInput().value).toBe("Somewhere Else");
  });

  it("quick picks fill the team and year without adding, and move focus to From year", () => {
    const { onAdd } = renderEntry({
      quickPicks: [{ team: "Chicago Cubs", fromYear: 2022 }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Fill in Chicago Cubs" }));
    expect(nameInput().value).toBe("Chicago Cubs");
    expect(fromInput().value).toBe("2022");
    expect(document.activeElement).toBe(fromInput());
    expect(onAdd).not.toHaveBeenCalled();
    // Already in the form, so no longer offered.
    expect(screen.queryByRole("button", { name: "Fill in Chicago Cubs" })).toBeNull();
  });

  it("quick-pick chips are at least 24px tall on desktop and 44px on a phone (A7)", () => {
    renderEntry({ quickPicks: [{ team: "Chicago Cubs", fromYear: 2022 }] });
    const chip = screen.getByRole("button", { name: "Fill in Chicago Cubs" });
    expect(chip.className).toContain("min-h-6");
    expect(chip.className).toContain("max-sm:min-h-11");
    expect(chip.className).toContain("py-1");
    expect(chip.className).not.toContain("py-0.5");
  });

  it("the To year box says 'To year' and keeps (optional) in its name", () => {
    renderEntry();
    const to = screen.getByLabelText("To year (optional)");
    expect(to.getAttribute("placeholder")).toBe("To year");
  });

  it("shows no quick-pick group when there are none", () => {
    renderEntry({ quickPicks: [] });
    expect(screen.queryByRole("group", { name: "Also on the cards" })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// NEO-591 — "edit this stint": a load request fills the form
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — loading a stint to edit (NEO-591)", () => {
  const PADRES = makeTeam("San Diego Padres", "t-padres");
  const nameBox = () => screen.getByLabelText("Career team name") as HTMLInputElement;
  const fromBox = () => screen.getByLabelText("From year") as HTMLInputElement;
  const toBox = () => screen.getByLabelText("To year (optional)") as HTMLInputElement;
  const load = (token: number, rest: Partial<NonNullable<Parameters<typeof CareerTeamEntry>[0]["load"]>> = {}) => ({
    token,
    name: "San Diego Padres",
    teamId: PADRES._id,
    fromYear: 2019,
    toYear: 2021,
    ...rest,
  });
  const entry = (props: Partial<Parameters<typeof CareerTeamEntry>[0]>, onAdd = vi.fn()) => (
    <CareerTeamEntry sportId={SPORT_ID} stagedNames={[]} onAdd={onAdd} {...props} />
  );

  it("fills the team, From year and To year, and focuses From year", () => {
    const { rerender } = render(entry({}));
    rerender(entry({ load: load(1) }));
    expect(nameBox().value).toBe("San Diego Padres");
    expect(fromBox().value).toBe("2019");
    expect(toBox().value).toBe("2021");
    expect(document.activeElement).toBe(fromBox());
  });

  it("leaves To year empty for an open-ended stint", () => {
    const { rerender } = render(entry({}));
    rerender(entry({ load: load(1, { toYear: undefined }) }));
    expect(toBox().value).toBe("");
  });

  it("replaces what the form holds, a prefill or typed text alike", () => {
    const { rerender } = render(entry({ initialTeam: "Chicago Cubs", initialFromYear: 2022 }));
    fireEvent.change(toBox(), { target: { value: "2023" } });
    rerender(entry({ initialTeam: "Chicago Cubs", initialFromYear: 2022, load: load(1) }));
    expect(nameBox().value).toBe("San Diego Padres");
    expect(fromBox().value).toBe("2019");
    expect(toBox().value).toBe("2021");
  });

  it("loads again for the same stint when the token changes, and not when it does not", () => {
    const { rerender } = render(entry({ load: load(1) }));
    fireEvent.change(fromBox(), { target: { value: "2015" } });
    // Same token: a re-render never undoes the operator's change.
    rerender(entry({ load: load(1) }));
    expect(fromBox().value).toBe("2015");
    rerender(entry({ load: load(2) }));
    expect(fromBox().value).toBe("2019");
  });

  it("+ Add re-stages the loaded stint with the changed years, and reports its saved team", () => {
    const onAdd = vi.fn();
    const { rerender } = render(entry({ knownTeamsOnly: true }, onAdd));
    rerender(entry({ knownTeamsOnly: true, load: load(1) }, onAdd));
    fireEvent.change(fromBox(), { target: { value: "2018" } });
    fireEvent.change(toBox(), { target: { value: "2022" } });
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    expect(onAdd).toHaveBeenCalledWith({
      name: "San Diego Padres",
      fromYear: 2018,
      toYear: 2022,
      teamId: PADRES._id,
    });
  });

  it("re-adds a team the batch is creating by name, with no saved team behind it", () => {
    const onAdd = vi.fn();
    const staged = ["Memphis RiverKings"];
    const { rerender } = render(entry({ knownTeamsOnly: true, stagedNames: staged }, onAdd));
    rerender(
      entry(
        {
          knownTeamsOnly: true,
          stagedNames: staged,
          load: { token: 1, name: "Memphis RiverKings", fromYear: 2018, toYear: 2019 },
        },
        onAdd,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "Memphis RiverKings", fromYear: 2018, toYear: 2019 });
  });

  describe("what counts as started work once a stint is loaded", () => {
    const track = () => {
      const onDirtyChange = vi.fn();
      const view = render(entry({ onDirtyChange }));
      view.rerender(entry({ onDirtyChange, load: load(1) }));
      return { onDirtyChange, ...view };
    };

    it("a form holding exactly the loaded stint is not dirty: the stint is still staged", () => {
      const { onDirtyChange } = track();
      expect(onDirtyChange.mock.calls.map((c) => c[0])).toEqual([false]);
    });

    it("changing any of the three boxes makes it dirty, and putting it back makes it clean", () => {
      const { onDirtyChange } = track();
      fireEvent.change(toBox(), { target: { value: "2022" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      fireEvent.change(toBox(), { target: { value: "2021" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      fireEvent.change(fromBox(), { target: { value: "2018" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      fireEvent.change(fromBox(), { target: { value: "2019" } });
      fireEvent.change(nameBox(), { target: { value: "San Diego Padre" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it("emptying the form is not dirty (nothing is left to lose)", () => {
      const { onDirtyChange } = track();
      fireEvent.change(toBox(), { target: { value: "2022" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      fireEvent.change(nameBox(), { target: { value: "" } });
      fireEvent.change(fromBox(), { target: { value: "" } });
      fireEvent.change(toBox(), { target: { value: "" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });

    it("+ Add ends it: the form is empty and clean, and a later typing is dirty again", () => {
      const { onDirtyChange } = track();
      fireEvent.change(fromBox(), { target: { value: "2018" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      fireEvent.change(nameBox(), { target: { value: "Chi" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });

    it("a form with no stint loaded keeps the old rule: any typing is dirty", () => {
      const onDirtyChange = vi.fn();
      render(entry({ onDirtyChange }));
      fireEvent.change(nameBox(), { target: { value: "C" } });
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    });
  });

  describe("a reset request", () => {
    it("empties the name and both years, once per token, and not on mount", () => {
      const onDirtyChange = vi.fn();
      const { rerender } = render(entry({ onDirtyChange, resetToken: 0, load: load(1) }));
      expect(nameBox().value).toBe("San Diego Padres");
      rerender(entry({ onDirtyChange, resetToken: 1, load: load(1) }));
      expect([nameBox().value, fromBox().value, toBox().value]).toEqual(["", "", ""]);
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      // The same token again changes nothing the operator types afterwards.
      fireEvent.change(nameBox(), { target: { value: "Chi" } });
      rerender(entry({ onDirtyChange, resetToken: 1, load: load(1) }));
      expect(nameBox().value).toBe("Chi");
    });
  });

  it("wraps its years row, so From, To and + Add fit a 320px dialog", () => {
    render(entry({}));
    expect(fromBox().parentElement?.className).toContain("flex-wrap");
  });

  it("changes nothing for a caller that passes no load (the New Player step)", () => {
    const { onAdd } = renderEntry({ initialTeam: "San Diego Padres", initialFromYear: 2022 });
    expect(nameBox().value).toBe("San Diego Padres");
    expect(fromBox().value).toBe("2022");
    expect(toBox().value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Add career team" }));
    expect(onAdd).toHaveBeenCalledWith({ name: "San Diego Padres", fromYear: 2022 });
  });
});

// ---------------------------------------------------------------------------
// NEO-591 — the Career check step's use of the same form
// ---------------------------------------------------------------------------

describe("CareerTeamEntry — whose stint, and only teams that exist (NEO-591)", () => {
  const PADRES = makeTeam("San Diego Padres", "t-padres");
  const REDS = makeTeam("Cincinnati Reds", "t-reds");
  const suffix = " for Luis Rodriguez";
  const nameBox = () => screen.getByLabelText(`Career team name${suffix}`) as HTMLInputElement;
  const fromBox = () => screen.getByLabelText(`From year${suffix}`) as HTMLInputElement;
  const addButton = () => screen.getByRole("button", { name: `Add career team${suffix}` });
  const typeKnown = (value: string) => {
    fireEvent.change(nameBox(), { target: { value } });
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS);
    });
  };

  it("puts the player on every control's name, so two forms never read alike", () => {
    renderEntry({ label: "Luis Rodriguez" });
    expect(nameBox()).toBeTruthy();
    expect(fromBox()).toBeTruthy();
    expect(screen.getByLabelText(`To year (optional)${suffix}`)).toBeTruthy();
    expect(addButton()).toBeTruthy();
    // And the New Player names are not on it.
    expect(screen.queryByLabelText("Career team name")).toBeNull();
  });

  it("emits no team id outside knownTeamsOnly, even for an exact saved team", () => {
    currentTeams = [PADRES];
    const { onAdd } = renderEntry({ label: "Luis Rodriguez" });
    typeKnown("San Diego Padres");
    fireEvent.change(fromBox(), { target: { value: "2022" } });
    fireEvent.click(addButton());
    expect(onAdd).toHaveBeenCalledWith({ name: "San Diego Padres", fromYear: 2022 });
  });

  describe("knownTeamsOnly", () => {
    it("adds the saved team typed in full, carrying its id", () => {
      currentTeams = [PADRES, REDS];
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", knownTeamsOnly: true });
      typeKnown("San Diego Padres");
      fireEvent.change(fromBox(), { target: { value: "2022" } });
      fireEvent.change(screen.getByLabelText(`To year (optional)${suffix}`), { target: { value: "2024" } });
      fireEvent.click(addButton());
      expect(onAdd).toHaveBeenCalledWith({
        name: "San Diego Padres",
        fromYear: 2022,
        toYear: 2024,
        teamId: "t-padres",
      });
    });

    it("adds a team taken from the list, carrying its id", () => {
      currentTeams = [PADRES, REDS];
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", knownTeamsOnly: true });
      typeKnown("Cincin");
      fireEvent.click(screen.getByRole("option", { name: "Use Cincinnati Reds" }));
      expect(nameBox().value).toBe("Cincinnati Reds");
      fireEvent.change(fromBox(), { target: { value: "2019" } });
      fireEvent.click(addButton());
      expect(onAdd).toHaveBeenCalledWith({ name: "Cincinnati Reds", fromYear: 2019, teamId: "t-reds" });
    });

    it("adds a team the batch is creating by name, with no id", () => {
      currentTeams = [];
      const { onAdd } = renderEntry({
        label: "Luis Rodriguez",
        knownTeamsOnly: true,
        stagedNames: ["Memphis RiverKings"],
      });
      typeKnown("Memphis RiverKings");
      fireEvent.change(fromBox(), { target: { value: "2012" } });
      fireEvent.click(addButton());
      expect(onAdd).toHaveBeenCalledWith({ name: "Memphis RiverKings", fromYear: 2012 });
    });

    it("will not add a name that matches nothing, and says so once the search has answered", () => {
      currentTeams = [];
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", knownTeamsOnly: true });
      fireEvent.change(nameBox(), { target: { value: "Nowhere Nine" } });
      fireEvent.change(fromBox(), { target: { value: "2022" } });
      // Not before the search has answered: a name still being looked up is not yet unknown.
      expect(screen.queryByText(UNKNOWN_TEAM_TEXT)).toBeNull();
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });
      expect(screen.getByText(UNKNOWN_TEAM_TEXT)).toBeTruthy();
      expect((addButton() as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(addButton());
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("forgets a team taken from the list when the text changes after", () => {
      currentTeams = [PADRES];
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", knownTeamsOnly: true });
      typeKnown("San Di");
      fireEvent.click(screen.getByRole("option", { name: "Use San Diego Padres" }));
      fireEvent.change(nameBox(), { target: { value: "San Diego Padre" } });
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS);
      });
      fireEvent.change(fromBox(), { target: { value: "2022" } });
      expect((addButton() as HTMLButtonElement).disabled).toBe(true);
      expect(onAdd).not.toHaveBeenCalled();
    });

    it("does not guess between two saved teams with one name: the list stays up to pick one", () => {
      const first = makeTeam("Winnipeg Jets", "t-jets-old");
      const second = makeTeam("Winnipeg Jets", "t-jets-new");
      currentTeams = [first, second];
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", knownTeamsOnly: true });
      typeKnown("Winnipeg Jets");
      fireEvent.change(fromBox(), { target: { value: "2016" } });
      expect(screen.getByText(UNKNOWN_TEAM_AMBIGUOUS)).toBeTruthy();
      expect((addButton() as HTMLButtonElement).disabled).toBe(true);
      const rows = screen.getAllByRole("option", { name: "Use Winnipeg Jets" });
      expect(rows).toHaveLength(2);
      fireEvent.click(rows[1]);
      fireEvent.click(addButton());
      expect(onAdd).toHaveBeenCalledWith({ name: "Winnipeg Jets", fromYear: 2016, teamId: "t-jets-new" });
    });

    it("takes the prefilled team once the search has found it", () => {
      currentTeams = [PADRES];
      const { onAdd } = renderEntry({
        label: "Luis Rodriguez",
        knownTeamsOnly: true,
        initialTeam: "San Diego Padres",
        initialFromYear: 2022,
      });
      fireEvent.click(addButton());
      expect(onAdd).toHaveBeenCalledWith({ name: "San Diego Padres", fromYear: 2022, teamId: "t-padres" });
    });
  });

  describe("onDone", () => {
    it("Enter in an empty To year or From year box means done, once", () => {
      const onDone = vi.fn();
      renderEntry({ label: "Luis Rodriguez", onDone });
      const to = screen.getByLabelText(`To year (optional)${suffix}`);
      fireEvent.keyDown(to, { key: "Enter" });
      expect(onDone).toHaveBeenCalledTimes(1);
      fireEvent.keyDown(fromBox(), { key: "Enter" });
      expect(onDone).toHaveBeenCalledTimes(2);
      fireEvent.keyDown(fromBox(), { key: "Enter", repeat: true });
      expect(onDone).toHaveBeenCalledTimes(2);
    });

    it("Enter in the empty team box means done too", () => {
      const onDone = vi.fn();
      renderEntry({ label: "Luis Rodriguez", onDone });
      fireEvent.keyDown(nameBox(), { key: "Enter" });
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("is not done while anything is typed: Enter adds or does nothing, as before", () => {
      const onDone = vi.fn();
      const { onAdd } = renderEntry({ label: "Luis Rodriguez", onDone });
      typeKnown("Brand New Club");
      fireEvent.keyDown(nameBox(), { key: "Enter" });
      fireEvent.change(fromBox(), { target: { value: "2021" } });
      fireEvent.keyDown(fromBox(), { key: "Enter" });
      expect(onAdd).toHaveBeenCalledWith({ name: "Brand New Club", fromYear: 2021 });
      expect(onDone).not.toHaveBeenCalled();
      // The form is empty again: now Enter is done.
      fireEvent.keyDown(fromBox(), { key: "Enter" });
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    it("does nothing extra without onDone (the New Player step)", () => {
      renderEntry();
      fireEvent.keyDown(screen.getByLabelText("From year"), { key: "Enter" });
      fireEvent.keyDown(screen.getByLabelText("Career team name"), { key: "Enter" });
      expect(screen.getByLabelText("Career team name")).toBeTruthy();
    });
  });

  it("disabled turns the form off", () => {
    renderEntry({ label: "Luis Rodriguez", disabled: true, initialTeam: "San Diego Padres", initialFromYear: 2022 });
    expect(nameBox().disabled).toBe(true);
    expect(fromBox().disabled).toBe(true);
    expect((screen.getByLabelText(`To year (optional)${suffix}`) as HTMLInputElement).disabled).toBe(true);
    expect((addButton() as HTMLButtonElement).disabled).toBe(true);
  });
});
