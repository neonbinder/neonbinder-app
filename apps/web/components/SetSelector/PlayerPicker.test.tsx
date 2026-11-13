/**
 * NEO-71-74 — coverage for `PlayerPicker`, a brand-new component with zero
 * prior test coverage. Mirrors `TeamPicker`'s chip/popover typeahead (see
 * `TeamPicker.test.tsx`, written alongside this file with the same
 * structure), plus the one behavior PlayerPicker adds on top: when the
 * typed query has no exact (case-insensitive) name match among the fetched
 * candidates, a "+ Create '<name>'" row appears; selecting it calls the
 * already-public `players.findOrCreate` mutation and adds the resulting id
 * as a chip. This is what lets a custom (non-marketplace-synced) card
 * attach players at all.
 *
 * --- Mocking strategy (identity-routed useQuery/useMutation, per
 * CardFeaturesEditor.test.tsx / BaseMappingForm.test.tsx conventions) ---
 * `convex/react`'s `useQuery`/`useMutation` are module-mocked, routed by the
 * (string-mocked) query/mutation reference, so `players.getManyByIds` and
 * `players.list` resolve independently, and `players.findOrCreate` resolves
 * to its own spy.
 */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// NEO-254: the ambiguity refusal is a ConvexError, and only a ConvexError's
// message survives production redaction — see `userFacingMessage`.
import { ConvexError } from "convex/values";

// ---------------------------------------------------------------------------
// Module mocks — declared before the component import
// ---------------------------------------------------------------------------

vi.mock("../../convex/_generated/api", () => ({
  api: {
    players: {
      getManyByIds: "players.getManyByIds",
      list: "players.list",
      findOrCreate: "players.findOrCreate",
      // NEO-313: the cross-sport (and set-sport top-up) typeahead search.
      search: "players.search",
      // NEO-313: PlayerGuestTag's "is this really a guest?" read.
      getByIdParam: "players.getByIdParam",
      // NEO-463: the one-word fragment pre-check behind "+ Create".
      nameFragmentCheck: "players.nameFragmentCheck",
    },
    // NEO-313: SportTagById and the popover's SportSwitch both read the sport
    // list to render (a tag's label, the switch's option list).
    selectorOptions: {
      getSelectorOptions: "selectorOptions.getSelectorOptions",
    },
  },
}));

let currentSelectedRows: unknown;
let currentCandidates: unknown;
// NEO-313: backs SportTagById and the popover's SportSwitch. Most tests never
// open the switch's list, so an empty pool by default is enough — the
// trigger button still renders (it does not depend on there being any
// options), which is what the Tab-order tests below need.
let currentSports: unknown = [];
/** NEO-313 — `players.search`'s answer. `undefined` until a test sets it,
 *  exactly like a query nothing has asked for yet. */
let currentSearchResults: unknown;
/** NEO-313 — `players.getByIdParam`, keyed by the id the guest tag asked for. */
let currentPlayerById: Map<string, { alsoSportIds?: unknown[] }>;
const mockFindOrCreate = vi.fn();
/** NEO-463 — `players.nameFragmentCheck`'s answer; undefined = not answered. */
let currentFragmentCheck: unknown;
let lastFragmentArgs: unknown;

vi.mock("convex/react", () => ({
  useQuery: (ref: string, args: unknown) => {
    if (ref === "players.getManyByIds") return currentSelectedRows;
    if (ref === "players.list") return currentCandidates;
    if (ref === "players.search") return args === "skip" ? undefined : currentSearchResults;
    if (ref === "players.getByIdParam") {
      if (args === "skip") return undefined;
      const id = (args as { id: string }).id;
      return currentPlayerById.get(id);
    }
    if (ref === "selectorOptions.getSelectorOptions") return currentSports;
    if (ref === "players.nameFragmentCheck") {
      if (args === "skip") return undefined;
      lastFragmentArgs = args;
      return currentFragmentCheck;
    }
    return undefined;
  },
  useMutation: (ref: string) =>
    ref === "players.findOrCreate" ? mockFindOrCreate : vi.fn(),
}));

// ---------------------------------------------------------------------------
// Component under test — imported after mocks
// ---------------------------------------------------------------------------

import PlayerPicker from "./PlayerPicker";
import {
  ALSO_PICTURED_PICKER_LABELS,
  EVERY_CARD_PLAYER_ACTION_LABELS,
  EVERY_CARD_PLAYER_PICKER_LABELS,
  PLAYER_ON_EVERY_CARD_HEADING,
  ALSO_ON_THIS_CARD_HEADING,
  DEFAULT_PLAYER_PICKER_LABELS,
  type ResolvedPlayerPickerLabels,
} from "./player-picker-labels";
import type { Id } from "../../convex/_generated/dataModel";

// NEO-96: pickers take the sport-level selectorOptions ROW ID now, not a
// display string. These stand in for a seeded sport row.
const SPORT_ID = "selopt-sport-1" as unknown as Id<"selectorOptions">;
const OTHER_SPORT_ID = "selopt-sport-2" as unknown as Id<"selectorOptions">;

// ---------------------------------------------------------------------------
// Fixtures / helpers
// ---------------------------------------------------------------------------

function pid(n: string): Id<"players"> {
  return n as unknown as Id<"players">;
}

function makePlayer(id: string, name: string) {
  return { _id: pid(id), name };
}

function renderPicker(
  props: Partial<Parameters<typeof PlayerPicker>[0]> = {},
) {
  const onChange = vi.fn();
  const utils = render(
    <PlayerPicker value={[]} onChange={onChange} sportId={SPORT_ID} {...props} />,
  );
  return { ...utils, onChange };
}

function openPopover() {
  fireEvent.click(screen.getByLabelText("Add player"));
}

/** NEO-313 — pick a sport off the popover's own SportSwitch ("Sport to search
 *  for players"), the same control the operator uses to search another sport. */
function switchSearchSport(fromLabel: string, toName: string) {
  fireEvent.click(
    screen.getByLabelText(`Sport to search for players: ${fromLabel}`),
  );
  fireEvent.click(
    within(screen.getByRole("listbox", { name: "Choose a sport" })).getByRole(
      "option",
      { name: toName },
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlayerPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSelectedRows = [];
    currentCandidates = [];
    currentSports = [];
    currentSearchResults = undefined;
    currentPlayerById = new Map();
    currentFragmentCheck = undefined;
    lastFragmentArgs = undefined;
    mockFindOrCreate.mockResolvedValue(pid("new-player-1"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Chip rendering (players.getManyByIds)
  // -------------------------------------------------------------------------

  it("renders a chip per selected id, labeled from players.getManyByIds", () => {
    currentSelectedRows = [makePlayer("p1", "Mike Trout")];
    renderPicker({ value: [pid("p1")] });

    expect(screen.getByLabelText("Player: Mike Trout")).toBeTruthy();
    expect(screen.getByLabelText("Remove player Mike Trout")).toBeTruthy();
  });

  it("shows a 'Loading…' placeholder label for a chip not yet resolved by getManyByIds", () => {
    currentSelectedRows = undefined;
    renderPicker({ value: [pid("p1")] });

    expect(screen.getByLabelText("Player: Loading…")).toBeTruthy();
  });

  it("clicking a chip's × button removes it via onChange", () => {
    currentSelectedRows = [makePlayer("p1", "Mike Trout"), makePlayer("p2", "Aaron Judge")];
    const { onChange } = renderPicker({ value: [pid("p1"), pid("p2")] });

    fireEvent.click(screen.getByLabelText("Remove player Mike Trout"));

    expect(onChange).toHaveBeenCalledWith([pid("p2")]);
  });

  // -------------------------------------------------------------------------
  // Candidate list (players.list), filtered/ranked by typed query
  // -------------------------------------------------------------------------

  it("lists candidates from players.list when the popover opens", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout"), makePlayer("p2", "Aaron Judge")];
    renderPicker();

    openPopover();

    expect(screen.getByLabelText("Add Mike Trout")).toBeTruthy();
    expect(screen.getByLabelText("Add Aaron Judge")).toBeTruthy();
  });

  it("excludes already-selected ids from the candidate list", () => {
    currentSelectedRows = [makePlayer("p1", "Mike Trout")];
    currentCandidates = [makePlayer("p1", "Mike Trout"), makePlayer("p2", "Aaron Judge")];
    renderPicker({ value: [pid("p1")] });

    openPopover();

    expect(screen.queryByLabelText("Add Mike Trout")).toBeNull();
    expect(screen.getByLabelText("Add Aaron Judge")).toBeTruthy();
  });

  it("ranks prefix matches above substring matches when a query is typed", () => {
    currentCandidates = [
      makePlayer("p1", "Brand Newington"), // "new" is a substring, not a prefix
      makePlayer("p2", "Newt Adamson"), // prefix match
      makePlayer("p3", "New York Slugger"), // prefix match, alphabetically first
    ];
    renderPicker();

    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "New" },
    });

    // Filter out the trailing "+ Create" row (also role="option") — a
    // non-exact-match query always shows it alongside real matches.
    const options = screen
      .getAllByRole("option")
      .filter((el) => el.getAttribute("aria-label")?.startsWith("Add "))
      .map((el) => el.textContent);
    expect(options).toEqual(["New York Slugger", "Newt Adamson", "Brand Newington"]);
  });

  it("filters out non-matching candidates once a query is typed", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout"), makePlayer("p2", "Aaron Judge")];
    renderPicker();

    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Trout" },
    });

    expect(screen.getByLabelText("Add Mike Trout")).toBeTruthy();
    expect(screen.queryByLabelText("Add Aaron Judge")).toBeNull();
  });

  it("clicking a candidate adds its id via onChange and clears the query", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout")];
    const { onChange } = renderPicker({ value: [] });

    openPopover();
    fireEvent.click(screen.getByLabelText("Add Mike Trout"));

    expect(onChange).toHaveBeenCalledWith([pid("p1")]);
  });

  // -------------------------------------------------------------------------
  // Keyboard contract (docstring: Enter/arrows/Escape/Backspace)
  // -------------------------------------------------------------------------

  it("ArrowDown/ArrowUp move the highlighted option", () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge"), makePlayer("p2", "Mike Trout")];
    renderPicker();
    openPopover();

    const input = screen.getByLabelText("Search players");
    // Default highlight is index 0.
    expect(screen.getByLabelText("Add Aaron Judge").getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByLabelText("Add Mike Trout").getAttribute("aria-selected")).toBe(
      "true",
    );

    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(screen.getByLabelText("Add Aaron Judge").getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("Enter selects the highlighted match", () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge"), makePlayer("p2", "Mike Trout")];
    const { onChange } = renderPicker();
    openPopover();

    const input = screen.getByLabelText("Search players");
    fireEvent.keyDown(input, { key: "ArrowDown" }); // highlight Mike Trout
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onChange).toHaveBeenCalledWith([pid("p2")]);
  });

  it("Escape closes the popover without selecting anything", () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    const { onChange } = renderPicker();
    openPopover();

    fireEvent.keyDown(screen.getByLabelText("Search players"), { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("Backspace on an empty query removes the last chip", () => {
    currentSelectedRows = [makePlayer("p1", "Aaron Judge"), makePlayer("p2", "Mike Trout")];
    const { onChange } = renderPicker({ value: [pid("p1"), pid("p2")] });
    openPopover();

    fireEvent.keyDown(screen.getByLabelText("Search players"), { key: "Backspace" });

    expect(onChange).toHaveBeenCalledWith([pid("p1")]);
  });

  it("Backspace does nothing when the query is non-empty (caret editing, not chip removal)", () => {
    currentSelectedRows = [makePlayer("p1", "Aaron Judge")];
    const { onChange } = renderPicker({ value: [pid("p1")] });
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "M" },
    });
    fireEvent.keyDown(screen.getByLabelText("Search players"), { key: "Backspace" });

    expect(onChange).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Create-new flow (PlayerPicker's one addition beyond TeamPicker's baseline)
  // -------------------------------------------------------------------------

  it("shows a '+ Create' row when the typed query has no exact match among candidates", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout")];
    renderPicker();
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });

    expect(screen.getByLabelText('Create player Bobby Witt Jr')).toBeTruthy();
  });

  it("does NOT show the '+ Create' row when an exact (case-insensitive) match exists", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout")];
    renderPicker();
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "mike trout" },
    });

    expect(screen.queryByLabelText(/^Create player/)).toBeNull();
  });

  it("does not show the '+ Create' row when the query is empty", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout")];
    renderPicker();
    openPopover();

    expect(screen.queryByLabelText(/^Create player/)).toBeNull();
  });

  it("clicking '+ Create' calls players.findOrCreate({ name, sport }) and adds the resulting id as a chip", async () => {
    currentCandidates = [];
    mockFindOrCreate.mockResolvedValue(pid("new-player-1"));
    const { onChange } = renderPicker({ sportId: SPORT_ID });
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });
    fireEvent.click(screen.getByLabelText('Create player Bobby Witt Jr'));

    await waitFor(() => {
      expect(mockFindOrCreate).toHaveBeenCalledWith({
        name: "Bobby Witt Jr",
        sportId: SPORT_ID,
      });
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([pid("new-player-1")]);
    });
  });

  it("pressing Enter with the create row highlighted (no matches) also creates and adds", async () => {
    currentCandidates = [];
    mockFindOrCreate.mockResolvedValue(pid("new-player-2"));
    const { onChange } = renderPicker({ sportId: SPORT_ID });
    openPopover();

    const input = screen.getByLabelText("Search players");
    fireEvent.change(input, { target: { value: "Bobby Witt Jr" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(mockFindOrCreate).toHaveBeenCalledWith({
        name: "Bobby Witt Jr",
        sportId: SPORT_ID,
      });
    });
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith([pid("new-player-2")]);
    });
  });

  // NEO-96: see the matching TeamPicker test — this used to assert that a
  // missing sport prop produced `sport: ""` on the created player.
  it("hides the create option entirely when no sportId is given", () => {
    currentCandidates = [];
    renderPicker({ sportId: undefined });
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });

    expect(screen.queryByLabelText("Create player Bobby Witt Jr")).toBeNull();
    expect(mockFindOrCreate).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // NEO-220 — dismissal and create-failure feedback, ported from TeamPicker
  //
  // This picker moved into `CardChecklist`'s quick-add form, where its
  // `absolute top-full z-10` popover is drawn over the Team row and the
  // Add/Cancel buttons. Its three prior gaps all became real defects there:
  // no outside-click close, no keyboard-out close (WCAG 2.4.11 Focus Not
  // Obscured), and a refused create that vanished silently.
  // -------------------------------------------------------------------------

  it("closes the popover on a pointerdown outside the picker", () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    renderPicker();
    openPopover();
    expect(screen.getByLabelText("Search players")).toBeTruthy();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByLabelText("Search players")).toBeNull();
  });

  it("leaves the popover open for a pointerdown INSIDE the picker", () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    renderPicker();
    openPopover();

    fireEvent.pointerDown(screen.getByLabelText("Search players"));

    expect(screen.getByLabelText("Search players")).toBeTruthy();
  });

  it("closes the popover once focus actually leaves the picker (2.4.11)", async () => {
    // The keyboard counterpart to the pointerdown handler: Tab out of the
    // popover, which has no focus trap, lands on whatever the caller rendered
    // next — in the quick-add form, controls this popover covers.
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    render(
      <div>
        <PlayerPicker value={[]} onChange={vi.fn()} sportId={SPORT_ID} />
        <button aria-label="Outside">Outside</button>
      </div>,
    );
    openPopover();
    const search = screen.getByLabelText("Search players");
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.blur(search);
    screen.getByLabelText("Outside").focus();
    await waitFor(() =>
      expect(screen.queryByLabelText("Search players")).toBeNull(),
    );
  });

  it("stays open when focus moves between controls inside the picker", async () => {
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    renderPicker();
    openPopover();
    const search = screen.getByLabelText("Search players");
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.blur(search);
    screen.getByLabelText("Add Aaron Judge").focus();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByLabelText("Search players")).toBeTruthy();
  });

  it("renders the reason a create was refused, in the SAME open popover", async () => {
    mockFindOrCreate.mockRejectedValue(new Error("boom"));
    currentCandidates = [];
    renderPicker();
    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });

    fireEvent.click(screen.getByLabelText("Create player Bobby Witt Jr"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // A plain Error is redacted in production, so only the generic fallback is
    // ever shown for one — never the raw message.
    expect(screen.getByRole("alert").textContent).toBe(
      "Could not create player.",
    );
    // Still the same open popover, query preserved, so the operator can edit
    // and retry rather than reopening and retyping.
    expect(
      (screen.getByLabelText("Search players") as HTMLInputElement).value,
    ).toBe("Bobby Witt Jr");
  });

  it("shows NEO-254's ambiguity refusal verbatim", async () => {
    /*
     * `findOrCreate` now refuses rather than returning the first of several
     * same-name rows, and after the bulk preload that refusal is a thing a
     * picker really hits — two Bob Allens pitched in the majors. The message
     * IS the instruction ("pick the right one"), so it has to survive: this
     * path is the only place the operator finds out, and the generic fallback
     * would tell them nothing they can act on.
     *
     * Safe to render verbatim by the rule this component already documents:
     * the message names a COUNT and the name the operator just typed, never
     * anything about the other rows.
     */
    mockFindOrCreate.mockRejectedValue(
      new ConvexError(
        "2 players are already filed under Bob Allen. Pick the right one instead of adding another.",
      ),
    );
    currentCandidates = [];
    const { onChange } = renderPicker();
    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bob Allen" },
    });

    fireEvent.click(screen.getByLabelText("Create player Bob Allen"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    expect(screen.getByRole("alert").textContent).toBe(
      "2 players are already filed under Bob Allen. Pick the right one instead of adding another.",
    );
    // No chip was added — the refusal is a refusal, not a silent no-op that
    // leaves the operator thinking it worked.
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the refusal on the next keystroke", async () => {
    mockFindOrCreate.mockRejectedValue(new Error("boom"));
    currentCandidates = [];
    renderPicker();
    openPopover();
    const search = screen.getByLabelText("Search players");
    fireEvent.change(search, { target: { value: "Bobby Witt Jr" } });
    fireEvent.click(screen.getByLabelText("Create player Bobby Witt Jr"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());

    // The message described the name that was in the box; the next keystroke
    // makes it stale, so it goes with the query it was about.
    fireEvent.change(search, { target: { value: "Bobby Witt Jr." } });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the Create row MOUNTED while creating, so the refusal survives", async () => {
    // The regression this guards: gating `showCreateOption` on `!creating`
    // unmounted the focused button the instant the request started, parking
    // focus on <body> — which `handleRootBlur` reads as "focus left the
    // picker" and closes the popover on, clearing the error state before the
    // awaited mutation had even rejected. The refusal then landed invisibly.
    let settle: (id: Id<"players">) => void = () => {};
    mockFindOrCreate.mockImplementation(
      () => new Promise<Id<"players">>((resolve) => { settle = resolve; }),
    );
    currentCandidates = [];
    renderPicker();
    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });
    fireEvent.click(screen.getByLabelText("Create player Bobby Witt Jr"));

    // Mid-flight: the row is still there, announcing itself rather than
    // vanishing — `aria-disabled`, never native `disabled`, which would
    // force-blur it and reproduce the same focus park.
    const createRow = screen.getByLabelText("Create player Bobby Witt Jr");
    expect(createRow.textContent).toBe("Creating…");
    expect(createRow.getAttribute("aria-disabled")).toBe("true");
    expect(createRow.hasAttribute("disabled")).toBe(false);
    expect(screen.getByLabelText("Search players")).toBeTruthy();

    await act(async () => {
      settle(pid("p-new"));
    });
  });

  it("refuses a second create while one is in flight", async () => {
    let settle: (id: Id<"players">) => void = () => {};
    mockFindOrCreate.mockImplementation(
      () => new Promise<Id<"players">>((resolve) => { settle = resolve; }),
    );
    currentCandidates = [];
    renderPicker();
    openPopover();
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bobby Witt Jr" },
    });

    fireEvent.click(screen.getByLabelText("Create player Bobby Witt Jr"));
    fireEvent.click(screen.getByLabelText("Create player Bobby Witt Jr"));

    // The `creating` guard inside `createAndAdd` is what blocks re-entry now
    // that the button stays clickable — `aria-disabled` only announces.
    expect(mockFindOrCreate).toHaveBeenCalledTimes(1);

    await act(async () => {
      settle(pid("p-new"));
    });
  });
});

/**
 * NEO-313 — `liveryColors`' per-theme contrast test is asserted through a
 * cross-sport search result's stint colour, the only place the wizard renders
 * it: the function itself is not exported, and a colour that clears 4.5:1 on
 * one theme's three popover surfaces (white, gray-100, the green-tinted
 * ArrowDown row) but not the other's (gray-800, gray-700, its own tinted row)
 * is exactly what "decided PER THEME" in the docstring means. Hex values below
 * were checked against `contrastRatio` directly (not guessed): navy clears
 * every light surface and fails every dark one, gold the reverse, and mid-gray
 * clears neither.
 */
describe("PlayerPicker — per-theme livery contrast (NEO-313)", () => {
  beforeEach(() => {
    currentSports = [
      { _id: SPORT_ID, value: "Baseball" },
      { _id: OTHER_SPORT_ID, value: "Football" },
    ];
  });

  /** Cross-sport search for one stint whose team carries `primaryColor`. */
  function renderCrossSportStint(primaryColor: string) {
    currentSearchResults = [
      {
        _id: pid("bo"),
        name: "Bo Jackson",
        sportId: OTHER_SPORT_ID,
        sportValue: "Football",
        stints: [{ label: "Raiders", primaryColor, fromYear: 1987, toYear: 1990 }],
      },
    ];
    renderPicker();
    openPopover();
    switchSearchSport("Baseball", "Football");
    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Bo Jackson" },
    });
  }

  // NEO-356: the decision is made for the mode the page is in. Outside a
  // ThemeProvider, `useTheme` reads `<html data-theme>`, so each test sets it.
  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  /** The same colour as the browser would normalise it, for comparing `style.color`. */
  const normalised = (hex: string) => {
    const probe = document.createElement("span");
    probe.style.color = hex;
    return probe.style.color;
  };

  it("uses the colour in light when it clears 4.5:1 on every light surface", () => {
    document.documentElement.dataset.theme = "light";
    renderCrossSportStint("#001B3D");

    const label = screen.getByText("Raiders");
    expect(label.style.color).toBe(normalised("#001b3d"));
    expect(label.className).not.toContain("text-ink-2");
  });

  it("falls back to the muted ink in light when the colour fails 4.5:1 there, even though it clears dark", () => {
    document.documentElement.dataset.theme = "light";
    renderCrossSportStint("#FFD700");

    const label = screen.getByText("Raiders");
    expect(label.className).toContain("text-ink-2");
    expect(label.style.color).toBe("");
  });

  it("uses the colour in dark when it clears 4.5:1 on every dark surface", () => {
    document.documentElement.dataset.theme = "dark";
    renderCrossSportStint("#FFD700");

    const label = screen.getByText("Raiders");
    expect(label.style.color).toBe(normalised("#ffd700"));
    expect(label.className).not.toContain("text-ink-2");
  });

  it.each(["light", "dark"] as const)(
    "drops the colour in %s for one that clears none of its surfaces",
    (mode) => {
      document.documentElement.dataset.theme = mode;
      renderCrossSportStint("#808080");

      const label = screen.getByText("Raiders");
      expect(label.className).toContain("text-ink-2");
      expect(label.style.color).toBe("");
    },
  );
});

/**
 * NEO-313 — the guest tag on a selected chip. A player's HOME sport differing
 * from the set's is necessary but not sufficient: `PlayerGuestTag` also reads
 * the player's own `alsoSportIds` (a fresher answer than the batch snapshot
 * `guestSportById` is built from) and hides the tag for a true multi-sport
 * member of the set's sport.
 */
describe("PlayerPicker — guest tag (NEO-313)", () => {
  beforeEach(() => {
    currentSports = [
      { _id: SPORT_ID, value: "Baseball" },
      { _id: OTHER_SPORT_ID, value: "Football" },
    ];
    // Selected chip whose HOME sport (players.getManyByIds) is Football, on a
    // Baseball-set picker — the shape `guestSportById` reads.
    currentSelectedRows = [
      { _id: pid("bo"), name: "Bo Jackson", sportId: OTHER_SPORT_ID },
    ];
  });

  it("shows the home-sport tag when alsoSportIds lacks the set's sport", () => {
    currentPlayerById.set("bo", { alsoSportIds: [] });
    renderPicker({ value: [pid("bo")] });

    expect(screen.getByText("Football")).toBeTruthy();
  });

  it("hides the tag once alsoSportIds includes the set's sport", () => {
    currentPlayerById.set("bo", { alsoSportIds: [SPORT_ID] });
    renderPicker({ value: [pid("bo")] });

    expect(screen.queryByText("Football")).toBeNull();
  });
});

/**
 * NEO-313 — on the SET'S sport, a typed query tops up the 500-row pool with
 * `players.search` rather than replacing it (see the docstring above
 * `candidates` in PlayerPicker.tsx). Two things must both stay true: a member
 * the pool missed (past row 500, or newly created) is reachable by search, and
 * the pool's own folded match — "Jose" finding "José" already in the pool —
 * keeps working independent of whatever search answers.
 */
describe("PlayerPicker — typed search merges with the set-sport pool (NEO-313)", () => {
  it("shows a player the pool does not carry but the server search does", () => {
    currentCandidates = [makePlayer("p1", "Mike Trout")];
    currentSearchResults = [makePlayer("p2", "Shohei Ohtani")];
    renderPicker();
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Ohtani" },
    });

    expect(screen.getByLabelText("Add Shohei Ohtani")).toBeTruthy();
  });

  it("still finds 'José' already in the pool by typing 'Jose', with no help from search", () => {
    currentCandidates = [makePlayer("p1", "José Ramírez")];
    // The server search answers nothing useful here — the fold match on the
    // pool is what must carry this, not a merge with search.
    currentSearchResults = [];
    renderPicker();
    openPopover();

    fireEvent.change(screen.getByLabelText("Search players"), {
      target: { value: "Jose" },
    });

    expect(screen.getByLabelText("Add José Ramírez")).toBeTruthy();
  });
});

/**
 * NEO-272 — the popover is portalled, so nothing can clip it.
 *
 * `overflow: auto` establishes a clip box whether or not a scrollbar is
 * showing, and two of this picker's hosts are exactly that: the attention
 * walker's body (`UnreviewedNameFixer`) and the card drawer's. An `absolute`
 * popover inside one was cut off at its edge.
 *
 * These tests say what happy-dom can say. It computes no layout, so "not
 * clipped" is not assertable and is not asserted — the structural property
 * that makes clipping impossible is, along with the coordinates the popover is
 * given, which are ordinary DOM state. `TeamPicker.test.tsx` carries the same
 * block for its twin.
 */
describe("PlayerPicker — the popover escapes its clip box (NEO-272)", () => {
  /** A host that clips: the shape of the walker's `overflow-y-auto` body. */
  function renderInScrollBox(
    props: Partial<Parameters<typeof PlayerPicker>[0]> = {},
  ) {
    const onChange = vi.fn();
    const utils = render(
      <div data-testid="scroll-box" style={{ overflowY: "auto", height: "120px" }}>
        <PlayerPicker value={[]} onChange={onChange} sportId={SPORT_ID} {...props} />
      </div>,
    );
    return { ...utils, onChange };
  }

  /**
   * The popover is the portalled container; since NEO-341 the listbox is the
   * options list INSIDE it (a direct child), not the container itself.
   */
  const results = () => screen.getByRole("listbox");
  const popover = () => results().parentElement as HTMLElement;

  function anchorAt(bottom: number, left: number) {
    return vi
      .spyOn(screen.getByLabelText("Add player"), "getBoundingClientRect")
      .mockReturnValue({
        top: bottom - 20,
        bottom,
        left,
        right: left + 96,
        width: 96,
        height: 20,
        x: left,
        y: bottom - 20,
        toJSON: () => ({}),
      } as DOMRect);
  }

  beforeEach(() => {
    currentSelectedRows = [];
    currentCandidates = [makePlayer("p1", "Aaron Judge")];
    // NEO-313: an earlier describe's fixture must not leak the sport list
    // here — this block's own tests rely on the "no sports yet" "…" label.
    currentSports = [];
  });

  it("renders outside the scrolling ancestor, while the trigger stays inside it", () => {
    renderInScrollBox();
    openPopover();

    const box = screen.getByTestId("scroll-box");
    // The fixture really does clip, so the escape below is the portal rather
    // than a broken setup.
    expect(box.contains(screen.getByLabelText("Add player"))).toBe(true);

    expect(box.contains(popover())).toBe(false);
    expect(document.body.contains(popover())).toBe(true);
    expect(popover().parentElement?.parentElement).toBe(document.body);
  });

  it("names its options list as the listbox, and keeps the role off the popover (NEO-341)", () => {
    // The portal moved the element, not its semantics. NEO-341: the listbox
    // is the options list inside the popover, still named by
    // `labels.results`. The popover also holds the search box and the sport
    // switch, which a listbox may not own (axe aria-required-children).
    renderInScrollBox({
      labels: {
        root: "Player picker",
        trigger: "Add player",
        search: "Search players",
        results: "Player typeahead results",
      },
    });
    openPopover();

    expect(results().getAttribute("aria-label")).toBe("Player typeahead results");
    expect(popover().getAttribute("role")).toBeNull();
    expect(popover().contains(screen.getByRole("textbox", { name: "Search players" }))).toBe(true);
    expect(results().contains(screen.getByRole("textbox", { name: "Search players" }))).toBe(false);
    for (const child of Array.from(results().children)) {
      expect(child.getAttribute("role")).toBe("option");
    }
    expect(popover().className).toContain("w-64");
    expect(popover().className).toContain("bg-raised");
    expect(popover().className).toContain("z-[55]");
    expect(popover().className).not.toContain("absolute");
  });

  it("anchors under the trigger and follows it on ancestor scroll and on resize", () => {
    renderInScrollBox();
    const rect = anchorAt(120, 40);
    openPopover();

    expect(popover().style.top).toBe("120px");
    expect(popover().style.left).toBe("40px");

    // Scroll events do not bubble; this only arrives because the listener is
    // registered in the capture phase.
    rect.mockReturnValue({ bottom: 60, left: 40, top: 40 } as DOMRect);
    fireEvent.scroll(screen.getByTestId("scroll-box"));
    expect(popover().style.top).toBe("60px");

    rect.mockReturnValue({ bottom: 300, left: 12, top: 280 } as DOMRect);
    fireEvent.resize(window);
    expect(popover().style.top).toBe("300px");
    expect(popover().style.left).toBe("12px");
  });

  it("does not re-measure when only the popover scrolls inside itself", () => {
    renderInScrollBox();
    const rect = anchorAt(120, 40);
    openPopover();
    expect(popover().style.top).toBe("120px");

    rect.mockReturnValue({ bottom: 60, left: 40, top: 40 } as DOMRect);
    fireEvent.scroll(popover());
    expect(popover().style.top).toBe("120px");
  });

  it("Tab from the trigger moves into the popover", () => {
    renderInScrollBox();
    openPopover();
    const trigger = screen.getByLabelText("Add player");
    trigger.focus();

    fireEvent.keyDown(trigger, { key: "Tab" });

    expect(document.activeElement).toBe(screen.getByLabelText("Search players"));
  });

  it("Shift+Tab off the search box returns to the trigger, popover still open", () => {
    renderInScrollBox();
    openPopover();
    const search = screen.getByLabelText("Search players");
    search.focus();

    fireEvent.keyDown(search, { key: "Tab", shiftKey: true });

    expect(document.activeElement).toBe(screen.getByLabelText("Add player"));
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("Tab off the last row closes the popover and hands focus back to the trigger", async () => {
    // WCAG 2.4.11 — in the quick-add form this popover covers the Team row and
    // Add/Cancel. Returning focus to the trigger also keeps Tab inside a host
    // dialog whose focus trap cannot see into the portal.
    //
    // NEO-313: the SportSwitch trigger is now the LAST focusable row in the
    // popover (it sits below the options and the create row), so it — not
    // the last player option — is where Tab actually leaves from.
    renderInScrollBox();
    openPopover();
    const lastRow = screen.getByLabelText("Sport to search for players: …");
    lastRow.focus();

    fireEvent.keyDown(lastRow, { key: "Tab" });

    expect(screen.queryByRole("listbox")).toBeNull();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(screen.getByLabelText("Add player"));
  });
  // -------------------------------------------------------------------------
  // NEO-463 — a one-word name that is a piece of a fuller one on file
  // -------------------------------------------------------------------------

  describe("NEO-463 name fragment", () => {
    const WALKER = {
      isFragment: true,
      matches: [{ _id: "p-devin", name: "Devin Walker" }],
    };

    function typeAndCreate(name: string) {
      openPopover();
      fireEvent.change(screen.getByLabelText("Search players"), {
        target: { value: name },
      });
      fireEvent.click(screen.getByLabelText(`Create player ${name}`));
    }

    it("asks the check about the name Create would add, in the searched sport", () => {
      currentFragmentCheck = WALKER;
      renderPicker();
      openPopover();
      fireEvent.change(screen.getByLabelText("Search players"), {
        target: { value: "Walker" },
      });
      expect(lastFragmentArgs).toEqual({ name: "Walker", sportId: SPORT_ID });
    });

    it("stops Create on a fragment and shows the panel, focused, without writing", async () => {
      currentFragmentCheck = WALKER;
      renderPicker();
      typeAndCreate("Walker");

      const panel = screen.getByRole("group", {
        name: "Just Walker? We've got Devin Walker. Pick one, or add Walker as a one-name player.",
      });
      expect(panel).toBeTruthy();
      expect(document.activeElement).toBe(panel);
      expect(mockFindOrCreate).not.toHaveBeenCalled();
      // The typeahead rows step aside while the panel answers.
      expect(screen.queryByLabelText("Create player Walker")).toBeNull();
    });

    it("does not show the panel for a name the check says is not a fragment", async () => {
      currentFragmentCheck = { isFragment: false, matches: [] };
      renderPicker();
      typeAndCreate("Ichiro");

      expect(screen.queryByRole("group", { name: /^Just Ichiro\?/ })).toBeNull();
      await waitFor(() => {
        expect(mockFindOrCreate).toHaveBeenCalledWith({
          name: "Ichiro",
          sportId: SPORT_ID,
        });
      });
    });

    it("a link choice adds the existing fuller-named player and creates nothing", async () => {
      currentFragmentCheck = WALKER;
      const { onChange } = renderPicker();
      typeAndCreate("Walker");

      fireEvent.click(screen.getByRole("button", { name: "Add Devin Walker" }));

      expect(onChange).toHaveBeenCalledWith([pid("p-devin")]);
      expect(mockFindOrCreate).not.toHaveBeenCalled();
    });

    it("'Add as a one-name player' creates with oneNamePlayer: true and adds the chip", async () => {
      currentFragmentCheck = WALKER;
      mockFindOrCreate.mockResolvedValue(pid("p-walker"));
      const { onChange } = renderPicker();
      typeAndCreate("Walker");

      fireEvent.click(screen.getByRole("button", { name: "Add as a one-name player" }));

      await waitFor(() => {
        expect(mockFindOrCreate).toHaveBeenCalledWith({
          name: "Walker",
          sportId: SPORT_ID,
          oneNamePlayer: true,
        });
      });
      await waitFor(() => {
        expect(onChange).toHaveBeenCalledWith([pid("p-walker")]);
      });
    });

    it("opens the panel from the server's PLAYER_NAME_FRAGMENT refusal when the check had not answered", async () => {
      currentFragmentCheck = undefined;
      mockFindOrCreate.mockRejectedValue(
        new ConvexError({
          code: "PLAYER_NAME_FRAGMENT",
          message: "Walker is part of a player NeonBinder already has.",
          matches: [{ _id: "p-devin", name: "Devin Walker" }],
        }),
      );
      renderPicker();
      typeAndCreate("Walker");

      expect(
        await screen.findByRole("group", { name: /^Just Walker\? We've got Devin Walker\./ }),
      ).toBeTruthy();
      // The refusal is the panel, not an error line.
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("Escape in the panel shuts it and hands focus back to the search box", async () => {
      currentFragmentCheck = WALKER;
      renderPicker();
      typeAndCreate("Walker");

      const panel = screen.getByRole("group", { name: /^Just Walker\?/ });
      fireEvent.keyDown(panel, { key: "Escape" });

      expect(screen.queryByRole("group", { name: /^Just Walker\?/ })).toBeNull();
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(document.activeElement).toBe(screen.getByLabelText("Search players"));
    });

    it("typing shuts the panel: it was about the old name", () => {
      currentFragmentCheck = WALKER;
      renderPicker();
      typeAndCreate("Walker");

      fireEvent.change(screen.getByLabelText("Search players"), {
        target: { value: "Walke" },
      });
      fireEvent.change(screen.getByLabelText("Search players"), {
        target: { value: "Walker" },
      });
      expect(screen.queryByRole("group", { name: /^Just Walker\?/ })).toBeNull();
    });

    it("a truncated read asks for the whole name, lists no choices, and keeps the one-name button", () => {
      currentFragmentCheck = { isFragment: true, truncated: true, matches: [] };
      renderPicker();
      typeAndCreate("Walker");

      const panel = screen.getByRole("group", {
        name: "Just Walker? That's part of a fuller name we've got. Type the whole name to find them, or add Walker as a one-name player.",
      });
      expect(panel).toBeTruthy();
      expect(screen.queryByRole("list", { name: "Fuller names for Walker" })).toBeNull();
      expect(screen.getByRole("button", { name: "Add as a one-name player" })).toBeTruthy();
      expect(mockFindOrCreate).not.toHaveBeenCalled();
    });

    it("tells two players with one name apart by birth year, beside each choice", () => {
      currentFragmentCheck = {
        isFragment: true,
        truncated: false,
        matches: [
          { _id: "p-devin-1", name: "Devin Walker", birthYear: 1975 },
          { _id: "p-devin-2", name: "Devin Walker", birthYear: 1991 },
          { _id: "p-larry", name: "Larry Walker", birthYear: 1966 },
        ],
      };
      const { onChange } = renderPicker();
      typeAndCreate("Walker");

      const older = screen.getByRole("button", { name: "Add Devin Walker, b. 1975" });
      expect(older.textContent).toContain("b. 1975");
      expect(screen.getByRole("button", { name: "Add Devin Walker, b. 1991" })).toBeTruthy();
      // A name that appears once keeps the bare contract label and no detail.
      const larry = screen.getByRole("button", { name: "Add Larry Walker" });
      expect(larry.textContent).toBe("Larry Walker");

      fireEvent.click(screen.getByRole("button", { name: "Add Devin Walker, b. 1991" }));
      expect(onChange).toHaveBeenCalledWith([pid("p-devin-2")]);
    });

    it("falls back to the choice's position when a repeated name has no birth year", () => {
      currentFragmentCheck = {
        isFragment: true,
        truncated: false,
        matches: [
          { _id: "p-devin-1", name: "Devin Walker" },
          { _id: "p-devin-2", name: "Devin Walker" },
        ],
      };
      renderPicker();
      typeAndCreate("Walker");

      expect(
        screen.getByRole("button", { name: "Add Devin Walker, option 1 of 2" }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Add Devin Walker, option 2 of 2" }),
      ).toBeTruthy();
    });

    it("an undated twin beside a dated one says it has no birth year", () => {
      currentFragmentCheck = {
        isFragment: true,
        truncated: false,
        matches: [
          { _id: "p-devin-1", name: "Devin Walker", birthYear: 1975 },
          { _id: "p-devin-2", name: "Devin Walker" },
        ],
      };
      renderPicker();
      typeAndCreate("Walker");

      expect(screen.getByRole("button", { name: "Add Devin Walker, b. 1975" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Add Devin Walker, no birth year" }),
      ).toBeTruthy();
    });
  });
});

// ---------------------------------------------------------------------------
// NEO-528 — every rendered name is overridable, and the sets never overlap
// ---------------------------------------------------------------------------

describe("PlayerPicker — label sets (NEO-528)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSelectedRows = [];
    currentCandidates = [];
    currentSports = [];
    currentSearchResults = undefined;
    currentPlayerById = new Map();
    currentFragmentCheck = undefined;
    mockFindOrCreate.mockResolvedValue(pid("new-player-1"));
  });

  /**
   * The quick-add form's container names (`QUICK_ADD_PLAYER_LABELS`, a
   * module constant in CardChecklist.tsx), restated: it is on the Set
   * Builder page with all three of the sets below.
   */
  const QUICK_ADD_CONTAINER = [
    "Players on the new card",
    "Add a player to the new card",
    "Find a player for the new card",
    "Player results for the new card",
  ];

  /**
   * NEO-528 — the headings the two reworded pickers sit under, and the card
   * drawer's other "Also …" section. A spec finds a heading by its text, so
   * no picker name may contain one (or sit inside one) either.
   */
  const HEADINGS = [ALSO_ON_THIS_CARD_HEADING, PLAYER_ON_EVERY_CARD_HEADING, "Also appears in"];

  /**
   * NEO-277 — the Attributes panel's Team picker (`SET_TEAM_PICKER_LABELS` in
   * SetAttributesPanel.tsx, pinned there), restated: it sits directly above
   * "Player on every card", so no name here may contain one of its names or
   * sit inside one. Restated rather than imported, as the quick-add set is:
   * importing the panel would pull its whole module graph into this file.
   */
  const SET_TEAM_PICKER = ["Whole-set team", "Add set team", "Find a team for the set", "Set team matches"];

  /**
   * NEO-528 — the "Player on every card" section's own names beside its
   * picker: the two actions and the × on each stored chip.
   */
  function everyCardActionNames(name: string): string[] {
    const A = EVERY_CARD_PLAYER_ACTION_LABELS;
    return [A.addPlayer, A.addCameo, A.stopPlayer(name), A.stopCameo(name)];
  }

  /** Every accessible name a set produces, for a sample name. */
  function namesOf(labels: ResolvedPlayerPickerLabels, name: string): string[] {
    return [
      labels.root,
      labels.trigger,
      labels.search,
      labels.results,
      labels.placeholder,
      labels.sportSwitch,
      labels.chip(name),
      labels.remove(name),
      labels.option(name),
      labels.create(name),
    ];
  }

  const SETS: Array<[string, ResolvedPlayerPickerLabels]> = [
    ["default", DEFAULT_PLAYER_PICKER_LABELS],
    ["also pictured", ALSO_PICTURED_PICKER_LABELS],
    ["every card", EVERY_CARD_PLAYER_PICKER_LABELS],
  ];

  // A chip always carries a name, or the "Loading…" stand-in.
  it.each(["Dan Marino", "Al", "Loading…"])(
    "no name in one set contains, or is contained by, a name in another (sample %j)",
    (sample) => {
      const all: Array<[string, string]> = [];
      for (const [set, labels] of SETS) {
        for (const n of namesOf(labels, sample)) all.push([set, n.toLowerCase()]);
      }
      for (const n of QUICK_ADD_CONTAINER) all.push(["quick add", n.toLowerCase()]);
      for (const n of SET_TEAM_PICKER) all.push(["set team", n.toLowerCase()]);
      for (const n of everyCardActionNames(sample)) all.push(["every card actions", n.toLowerCase()]);
      // Each heading is its own group: they must stay apart from each other too.
      for (const n of HEADINGS) all.push([`heading ${n}`, n.toLowerCase()]);
      for (const [setA, a] of all) {
        for (const [setB, b] of all) {
          if (setA === setB) continue;
          // A bare sample name inside both is fine; the FIXED words must differ.
          if (a.includes(b) || b.includes(a)) {
            throw new Error(`"${a}" (${setA}) and "${b}" (${setB}) overlap`);
          }
        }
      }
    },
  );

  it("the card drawer's set reads as the E2E specs target it (NEO-528)", () => {
    const L = ALSO_PICTURED_PICKER_LABELS;
    expect(ALSO_ON_THIS_CARD_HEADING).toBe("Also on this card");
    expect(PLAYER_ON_EVERY_CARD_HEADING).toBe("Player on every card");
    expect([L.root, L.trigger, L.triggerText, L.search, L.results, L.placeholder, L.emptyHint, L.sportSwitch]).toEqual([
      "Others on this card",
      "Add someone else to this card",
      "Add someone else",
      "Find someone else for this card",
      "Someone-else matches",
      "Who else is on this card?",
      "Type a name…",
      "Sport for finding someone else",
    ]);
    expect([L.chip("Dan Marino"), L.remove("Dan Marino"), L.option("Dan Marino"), L.create("Dan Marino")]).toEqual([
      "On this card too: Dan Marino",
      "Take Dan Marino off this card's cameos",
      "Include Dan Marino",
      "Create and include Dan Marino",
    ]);
  });

  it("the Player on every card names read as the E2E specs target them (NEO-528)", () => {
    const P = EVERY_CARD_PLAYER_PICKER_LABELS;
    const A = EVERY_CARD_PLAYER_ACTION_LABELS;
    expect([P.root, P.trigger, P.triggerText, P.search, P.results, P.placeholder, P.sportSwitch]).toEqual([
      "Whole-checklist pick",
      "Choose who goes on every card",
      "Choose who",
      "Find who goes on every card",
      "Whole-checklist choices",
      "Who's on every card?",
      "Sport for the whole-checklist search",
    ]);
    expect([P.chip("Al"), P.remove("Al"), P.option("Al"), P.create("Al")]).toEqual([
      "Chosen for every card: Al",
      "Clear Al as the choice",
      "Choose Al",
      "Create and choose Al",
    ]);
    expect([A.addPlayer, A.addCameo, A.stopPlayer("Al"), A.stopCameo("Al")]).toEqual([
      "Add to every card",
      "Add as cameo",
      "Stop putting Al on new cards",
      "Stop adding Al as a cameo on new cards",
    ]);
  });

  it("each override set keeps its visible trigger text inside the trigger's name (SC 2.5.3)", () => {
    for (const [, labels] of SETS) {
      expect(labels.trigger.toLowerCase()).toContain(labels.triggerText.toLowerCase());
    }
  });

  it("draws the + Add trigger as a 24px target for every caller (WCAG 2.5.8)", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: "Add player" });
    expect(trigger.className.split(/\s+/)).toEqual(expect.arrayContaining(["min-h-6", "inline-flex", "items-center"]));
    // Compact everywhere unless a caller asks for the phone size.
    expect(trigger.className).not.toContain("max-md:");
  });

  it("roomyTriggerOnPhones grows the trigger to a 32px, text-sm target below 768px only", () => {
    renderPicker({ roomyTriggerOnPhones: true });
    const classes = screen.getByRole("button", { name: "Add player" }).className.split(/\s+/);
    expect(classes).toEqual(
      expect.arrayContaining(["min-h-6", "text-xs", "max-md:min-h-8", "max-md:px-3", "max-md:text-sm"]),
    );
  });

  it("with no labels, renders exactly the names the existing specs target", () => {
    currentSelectedRows = [makePlayer("p1", "Mike Trout")];
    currentCandidates = [makePlayer("p2", "Mookie Betts")];
    renderPicker({ value: [pid("p1")] });

    expect(screen.getByLabelText("Player picker")).toBeTruthy();
    expect(screen.getByLabelText("Player: Mike Trout")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove player Mike Trout" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add player" }).textContent).toBe("+ Add player");

    fireEvent.click(screen.getByLabelText("Add player"));
    const search = screen.getByRole("textbox", { name: "Search players" });
    expect(search.getAttribute("placeholder")).toBe("Search or add a player...");
    fireEvent.change(search, { target: { value: "Moo" } });
    expect(screen.getByRole("option", { name: "Add Mookie Betts" })).toBeTruthy();
    fireEvent.change(search, { target: { value: "Zed Brandnew" } });
    expect(screen.getByRole("option", { name: "Create player Zed Brandnew" })).toBeTruthy();
  });

  it("with the also-pictured set, renders that set's names on every control and none of the defaults", () => {
    const L = ALSO_PICTURED_PICKER_LABELS;
    currentSelectedRows = [makePlayer("p1", "Mike Trout")];
    currentCandidates = [makePlayer("p2", "Mookie Betts")];
    currentSports = [{ _id: SPORT_ID, value: "Baseball" }];
    renderPicker({ value: [pid("p1")], labels: L, ariaDescribedBy: "hint-1" });

    expect(screen.getByLabelText(L.root)).toBeTruthy();
    expect(screen.getByLabelText(L.chip("Mike Trout"))).toBeTruthy();
    expect(screen.getByRole("button", { name: L.remove("Mike Trout") })).toBeTruthy();
    const trigger = screen.getByRole("button", { name: L.trigger });
    expect(trigger.textContent).toBe(`+ ${L.triggerText}`);
    expect(trigger.getAttribute("aria-describedby")).toBe("hint-1");

    fireEvent.click(trigger);
    const search = screen.getByRole("textbox", { name: L.search });
    expect(search.getAttribute("placeholder")).toBe(L.placeholder);
    expect(screen.getByRole("listbox", { name: L.results })).toBeTruthy();
    fireEvent.change(search, { target: { value: "Moo" } });
    expect(screen.getByRole("option", { name: L.option("Mookie Betts") })).toBeTruthy();
    fireEvent.change(search, { target: { value: "Zed Brandnew" } });
    expect(screen.getByRole("option", { name: L.create("Zed Brandnew") })).toBeTruthy();
    expect(screen.getByRole("button", { name: `${L.sportSwitch}: Baseball` })).toBeTruthy();

    // None of the default names is on screen.
    for (const name of [
      "Player picker",
      "Player: Mike Trout",
      "Remove player Mike Trout",
      "Add player",
      "Search players",
      "Player typeahead results",
      "Add Mookie Betts",
      "Create player Zed Brandnew",
    ]) {
      expect(screen.queryByLabelText(name)).toBeNull();
    }
    expect(screen.queryByText("+ Add player")).toBeNull();
  });

  it("shows the set's own hint under an empty search box", () => {
    const L = ALSO_PICTURED_PICKER_LABELS;
    renderPicker({ labels: L });
    fireEvent.click(screen.getByRole("button", { name: L.trigger }));
    expect(screen.getByText(L.emptyHint)).toBeTruthy();
    expect(screen.queryByText("Type a player name…")).toBeNull();
  });

  it("the fragment panel's pick uses the set's option wording", async () => {
    const L = ALSO_PICTURED_PICKER_LABELS;
    currentCandidates = [];
    currentFragmentCheck = {
      isFragment: true,
      truncated: false,
      matches: [{ _id: "p9", name: "Devin Walker" }],
    };
    renderPicker({ labels: L });
    fireEvent.click(screen.getByRole("button", { name: L.trigger }));
    fireEvent.change(screen.getByRole("textbox", { name: L.search }), {
      target: { value: "Walker" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: L.create("Walker") }));
    });
    expect(await screen.findByRole("button", { name: L.option("Devin Walker") })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add Devin Walker" })).toBeNull();
  });
});
