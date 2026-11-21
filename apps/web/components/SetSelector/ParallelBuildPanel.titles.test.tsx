/**
 * NEO-535 — the build ticker's half of the parallel Card titles flow: the
 * built line's clause, the end-of-run sentence, and the "Fix N card titles"
 * door, which shows only once a run has ended with titles to fix and opens on
 * its own only for a run that ended while the operator was here.
 *
 * The dialog itself is covered in ParallelTitlesDialog.test.tsx; here the
 * fake `useConvex().query` only proves whether it was asked to load.
 */

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Id } from "../../convex/_generated/dataModel";

vi.mock("../../convex/_generated/api", () => ({
  api: {
    parallelChecklistBuild: {
      getParallelsForBuild: "getParallelsForBuild",
      buildParallelChecklist: "buildParallelChecklist",
    },
    parallelCopyTitles: {
      failingTitles: "failingTitles",
      saveTitleFixes: "saveTitleFixes",
    },
  },
}));

const mockQuery = vi.fn();
const mockMutation = vi.fn();
vi.mock("convex/react", () => ({
  useConvex: () => ({ query: mockQuery, mutation: mockMutation, action: vi.fn() }),
  useAction: () => vi.fn(),
}));

import ParallelBuildPanel, {
  builtText,
  fixRunTitlesLabel,
  panelHeading,
  runTitlesAnnouncement,
  runTitlesToFix,
  titlesToFixText,
  withLiveTitles,
  type ParallelBuildResult,
  type ParallelRun,
} from "./ParallelBuildPanel";
import { resetParallelTitlesAutoOpen } from "./ParallelTitlesDialog";
import { assessListingTitle, type ListingCardInputs } from "../../convex/features/generateListing";

const INSERT_ID = "insert-1" as unknown as Id<"selectorOptions">;
const A = "parallel-a" as unknown as Id<"selectorOptions">;
const B = "parallel-b" as unknown as Id<"selectorOptions">;
const C = "parallel-c" as unknown as Id<"selectorOptions">;

function built(titlesToFix?: number): ParallelBuildResult {
  return {
    status: "built",
    copied: 10,
    notCopied: 0,
    unlinked: { bsc: 0, sportlots: 0 },
    ambiguous: { bsc: 0, sportlots: 0 },
    sidesFetched: ["bsc"],
    sidesSkipped: ["sportlots"],
    earlierLinksMissing: { bsc: 0, sportlots: 0 },
    rebuilt: false,
    stillListedNotRelinked: { bsc: 0, sportlots: 0 },
    legacyLinksRemoved: { bsc: 0, sportlots: 0 },
    skippedChangedSource: 0,
    extraOnMarketplace: { bsc: { count: 0, cards: [] }, sportlots: { count: 0, cards: [] } },
    cards: {
      leftOff: [],
      unlinked: { bsc: [], sportlots: [] },
      ambiguous: { bsc: [], sportlots: [] },
    },
    ...(titlesToFix !== undefined ? { titlesToFix } : {}),
  };
}

function run(overrides: Partial<ParallelRun> = {}): ParallelRun {
  return {
    startedFrom: INSERT_ID,
    sourceId: INSERT_ID,
    sourceValue: "Anime",
    sourceKind: "insert",
    entries: [
      { id: A, value: "Anime Gold", line: { kind: "built", result: built(2) } },
      { id: B, value: "Anime Silver", line: { kind: "built", result: built() } },
      { id: C, value: "Anime Bronze", line: { kind: "built", result: built(1) } },
    ],
    truncated: false,
    phase: "finished",
    atIndex: null,
    announcement: "",
    ...overrides,
  };
}

const settle = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });

beforeEach(() => {
  mockQuery.mockReset();
  mockMutation.mockReset();
  // Nothing left to fix by the time it loads: no dialog, just the status line.
  mockQuery.mockResolvedValue({
    parallel: { _id: A, value: "Anime Gold" },
    boxPrefill: "",
    cards: [],
    failingInPage: 0,
    cursor: null,
  });
  resetParallelTitlesAutoOpen();
});

describe("the words", () => {
  test("the built line names the titles to fix", () => {
    expect(titlesToFixText(1)).toBe("1 title needs a fix");
    expect(titlesToFixText(3)).toBe("3 titles need a fix");
    expect(builtText(built(3))).toContain("3 titles need a fix");
    expect(builtText(built())).not.toContain("title");
    expect(builtText(built(0))).not.toContain("title");
  });

  test("the door and the end-of-run sentence count every parallel's", () => {
    expect(fixRunTitlesLabel(1)).toBe("Fix 1 card title");
    expect(fixRunTitlesLabel(3)).toBe("Fix 3 card titles");
    expect(runTitlesAnnouncement(1)).toBe("1 card title needs a fix.");
    expect(runTitlesAnnouncement(3)).toBe("3 card titles need a fix.");
  });

  test("runTitlesToFix lists only the built parallels with titles to fix", () => {
    expect(runTitlesToFix(run())).toEqual({
      parallels: [
        { id: A, value: "Anime Gold" },
        { id: C, value: "Anime Bronze" },
      ],
      total: 3,
    });
  });
});

describe("the Fix card titles door on the ticker", () => {
  test("shows once the run has finished with titles to fix, and opens on its own once", async () => {
    render(<ParallelBuildPanel run={run()} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Fix 3 card titles" })).toBeTruthy();
    // The door opened by itself: it read the cards (a call without
    // `wantCards: 0`) of exactly the parallels with titles to fix.
    await waitFor(() =>
      expect(
        new Set(
          mockQuery.mock.calls
            .filter((c) => c[1].wantCards === undefined)
            .map((c) => c[1].parallelId),
        ),
      ).toEqual(new Set([A, C])),
    );
    // Wait for the whole load so no query is still in flight when the next
    // test resets the mock.
    await screen.findByText("Every title fits now. Nothing to fix.", { selector: "span" });
  });

  test("is not there while the run is live", async () => {
    render(<ParallelBuildPanel run={run({ phase: "running", atIndex: 2 })} onStop={() => {}} />);
    expect(screen.queryByRole("button", { name: /card titles?$/ })).toBeNull();
    await settle();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  test("is not there when no title needs a fix", () => {
    const entries = run().entries.map((e) => ({ ...e, line: { kind: "built" as const, result: built() } }));
    render(<ParallelBuildPanel run={run({ entries })} onStop={() => {}} />);
    expect(screen.queryByRole("button", { name: /card titles?$/ })).toBeNull();
  });

  test("a run picked up after leaving gets the button but never opens on its own", async () => {
    render(<ParallelBuildPanel run={run({ phase: "left" })} onStop={() => {}} />);
    expect(screen.getByRole("button", { name: "Fix 3 card titles" })).toBeTruthy();
    await settle();
    // Never opened: the only reads are the counts-only recount on mount.
    expect(mockQuery).toHaveBeenCalled();
    for (const call of mockQuery.mock.calls) expect(call[1].wantCards).toBe(0);
  });
});

describe("the door's lines go through the ticker's one live line (a11y)", () => {
  test("no second live region in the banner; the live line says the door's line", async () => {
    const { container } = render(
      <ParallelBuildPanel run={run({ announcement: "Built 3 parallels." })} onStop={() => {}} />,
    );
    // Self-opens, finds nothing left to fix, says so. The live node's text is
    // written by an effect after the visible line renders, so wait on the live
    // node itself (a screen reader hears it a tick after the eye sees it).
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')!.textContent).toBe(
        "Every title fits now. Nothing to fix.",
      ),
    );
    const live = container.querySelectorAll('[role="status"]');
    expect(live).toHaveLength(1);
    expect(screen.getByText("Every title fits now. Nothing to fix.", { selector: "span" })).toBeTruthy();
    // The visible line is plain text, outside any live region.
    // It stays after the door has gone, so a sighted operator sees why.
    const shown = screen.getByText("Every title fits now. Nothing to fix.", { selector: "span" });
    expect(shown.closest('[role="status"]')).toBeNull();
    expect(screen.queryByRole("button", { name: /card titles?$/ })).toBeNull();
  });

  test("a new run's announcement takes the live line back", async () => {
    const { container, rerender } = render(
      <ParallelBuildPanel run={run({ announcement: "Built 3 parallels." })} onStop={() => {}} />,
    );
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')!.textContent).toBe(
        "Every title fits now. Nothing to fix.",
      ),
    );
    rerender(
      <ParallelBuildPanel
        run={run({ startedFrom: B, phase: "running", atIndex: 0, announcement: "Building 3 parallels." })}
        onStop={() => {}}
      />,
    );
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')!.textContent).toBe("Building 3 parallels."),
    );
  });
});


// ---------------------------------------------------------------------------
// NEO-581 — the button and the clause follow the cards, not the stored count
// ---------------------------------------------------------------------------

function inputs(cardNumber: string): ListingCardInputs & { playerNames: string[]; teamNames: string[] } {
  return {
    cardNumber,
    playerNames: ["Mike Trout"],
    teamNames: [],
    year: "2024",
    manufacturer: "Topps",
    setName: "Topps Chrome",
    insertName: "Anime",
    parallelName: "Anime Gold",
    parallelIsRole: true,
    sport: "Baseball",
  };
}

function storedCard(n: string) {
  return {
    cardId: `card-${n}` as unknown as Id<"cardChecklist">,
    cardNumber: n,
    cardName: "Mike Trout",
    title: assessListingTitle(inputs(n)).title,
    inputs: inputs(n),
  };
}

/** One built parallel whose stored count is `stored`. */
function oneParallel(stored: number, overrides: Partial<ParallelRun> = {}): ParallelRun {
  return run({
    entries: [{ id: A, value: "Anime Gold", line: { kind: "built", result: built(stored) } }],
    ...overrides,
  });
}

/**
 * The cards as they stand: `left` still fail. A counts-only read says how many;
 * a full read lists up to two of them. A save moves `left` to `afterSave`.
 */
function cardsStandAt(left: { n: number }, afterSave: number) {
  mockQuery.mockImplementation(async (_fn: string, args: { wantCards?: number }) => ({
    parallel: { _id: A, value: "Anime Gold" },
    boxPrefill: "2024 Topps Chrome Anime Anime Gold",
    cards: args.wantCards === 0 ? [] : [storedCard("3"), storedCard("4")].slice(0, left.n),
    failingInPage: left.n,
    cursor: null,
  }));
  mockMutation.mockImplementation(async () => {
    left.n = afterSave;
    return { saved: 2, rewritten: 0, kept: 0, skipped: 0, stillFailing: 0 };
  });
}

const doorButton = (name: RegExp | string) => screen.queryByRole("button", { name });
const clause = () => screen.queryByText(/titles? needs? a fix/);

describe("withLiveTitles", () => {
  test("replaces a built parallel's count, and rewrites the end-of-run sentence", () => {
    const stored = run({ announcement: "Built 3 parallels. 3 card titles need a fix." });
    const live = withLiveTitles(stored, { [A]: 0 });
    expect(runTitlesToFix(live)).toEqual({
      parallels: [{ id: C, value: "Anime Bronze" }],
      total: 1,
    });
    expect(live.announcement).toBe(`${panelHeading(live)}. 1 card title needs a fix.`);
    expect(builtText((live.entries[0].line as { result: ParallelBuildResult }).result)).not.toContain("title");
  });

  test("all clear drops the tail; no change returns the run as it came", () => {
    const clear = withLiveTitles(run(), { [A]: 0, [C]: 0 });
    expect(clear.announcement).toBe(`${panelHeading(clear)}.`);
    const same = run();
    expect(withLiveTitles(same, { [A]: 2, [C]: 1 })).toBe(same);
    expect(withLiveTitles(same, {})).toBe(same);
  });

  test("leaves a run that is still going alone in its announcement", () => {
    const going = run({ phase: "running", announcement: "Building 3 parallels." });
    expect(withLiveTitles(going, { [A]: 0 }).announcement).toBe("Building 3 parallels.");
  });
});

describe("NEO-581 — the button follows the cards", () => {
  test("saving every title drops the button, the clause and the sentence's tail", async () => {
    cardsStandAt({ n: 2 }, 0);
    const { container } = render(
      <ParallelBuildPanel run={oneParallel(2, { announcement: "Built 1 parallel." })} onStop={() => {}} />,
    );
    // Self-opens: the dialog is up, the button and clause are still there behind it.
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect(clause()).toBeTruthy();
    expect(doorButton("Fix 2 card titles")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save titles" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    expect(clause()).toBeNull();
    // One live line, saying the save; the door's text stays for the eye.
    // The live node is written by an effect a tick after the visible line.
    await waitFor(() =>
      expect(container.querySelector('[role="status"]')!.textContent).toBe("Saved 2 titles."),
    );
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(screen.getByText("Saved 2 titles.", { selector: "span" })).toBeTruthy();
    // Focus was on the door; it is parked on the panel, not dropped.
    expect(document.activeElement).not.toBe(document.body);
  });

  test("a partial fix lowers the count to what is left", async () => {
    cardsStandAt({ n: 2 }, 1);
    render(<ParallelBuildPanel run={oneParallel(2)} onStop={() => {}} />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Save titles" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(doorButton("Fix 1 card title")).toBeTruthy());
    expect(doorButton("Fix 2 card titles")).toBeNull();
    expect(screen.getByText(/1 title needs a fix/)).toBeTruthy();
    expect(clause()?.textContent).not.toMatch(/2 titles/);
  });

  test("pressing the button when nothing is left clears it", async () => {
    // Picked up after leaving: the stored count says 2, the cards say 2 ...
    const left = { n: 2 };
    cardsStandAt(left, 0);
    render(<ParallelBuildPanel run={oneParallel(2, { phase: "left" })} onStop={() => {}} />);
    await settle();
    expect(doorButton("Fix 2 card titles")).toBeTruthy();
    // ... until someone fixes them elsewhere.
    left.n = 0;
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 card titles" }));
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    expect(clause()).toBeNull();
    expect(screen.getByText("Every title fits now. Nothing to fix.", { selector: "span" })).toBeTruthy();
  });

  test("a run picked up after the titles were fixed never shows the stale button", async () => {
    cardsStandAt({ n: 0 }, 0);
    render(<ParallelBuildPanel run={oneParallel(4, { phase: "left" })} onStop={() => {}} />);
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    expect(clause()).toBeNull();
    // Counted only: no card's inputs were read, and nothing opened.
    for (const call of mockQuery.mock.calls) expect(call[1].wantCards).toBe(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a counts-only read that fails leaves the stored count until a press says better", async () => {
    mockQuery.mockRejectedValue(new Error("offline"));
    render(<ParallelBuildPanel run={oneParallel(2, { phase: "left" })} onStop={() => {}} />);
    await settle();
    expect(doorButton("Fix 2 card titles")).toBeTruthy();
    expect(clause()).toBeTruthy();
  });

  test("a silent recount on a reload takes nothing from focus", async () => {
    cardsStandAt({ n: 0 }, 0);
    render(<ParallelBuildPanel run={oneParallel(4, { phase: "left" })} onStop={() => {}} />);
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    // Nothing held focus, so nothing is parked on the panel.
    expect(document.activeElement).toBe(document.body);
  });

  test("focus that left the door earlier is not parked when a later recount removes it", async () => {
    // The mount recount is held; the operator focuses the door, then clicks
    // blank page (a blur with no relatedTarget); only then does it land at zero.
    let answer: (value: unknown) => void = () => {};
    mockQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<ParallelBuildPanel run={oneParallel(4, { phase: "left" })} onStop={() => {}} />);
    const button = screen.getByRole("button", { name: "Fix 4 card titles" });
    act(() => button.focus());
    expect(document.activeElement).toBe(button);
    act(() => button.blur());
    await settle();
    expect(document.activeElement).toBe(document.body);
    await act(async () =>
      answer({
        parallel: { _id: A, value: "Anime Gold" },
        boxPrefill: "",
        cards: [],
        failingInPage: 0,
        cursor: null,
      }),
    );
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    expect(document.activeElement).toBe(document.body);
  });

  test("a blur that hands focus straight back to the door still parks it when the door leaves", async () => {
    // Held recount, so the door can be focused and removed on our terms.
    let answer: (value: unknown) => void = () => {};
    mockQuery.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    render(<ParallelBuildPanel run={oneParallel(4, { phase: "left" })} onStop={() => {}} />);
    const button = screen.getByRole("button", { name: "Fix 4 card titles" });
    act(() => button.focus());
    // A blur with no relatedTarget, and focus back on the door before the
    // microtask that reads it runs (Chrome, when a dialog's button is removed).
    act(() => {
      button.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
      button.focus();
    });
    await settle();
    expect(document.activeElement).toBe(button);
    await act(async () =>
      answer({
        parallel: { _id: A, value: "Anime Gold" },
        boxPrefill: "",
        cards: [],
        failingInPage: 0,
        cursor: null,
      }),
    );
    await waitFor(() => expect(doorButton(/card titles?$/)).toBeNull());
    await waitFor(() => expect(document.activeElement?.tagName).toBe("SECTION"));
  });
});
